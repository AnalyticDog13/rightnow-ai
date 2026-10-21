import { createPrisma } from "@rightnow/db/create";
import { createTestDb } from "@rightnow/db/test-db";
import type { MessageStatus, ScheduledMessage } from "@rightnow/db/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { removeCampaignLead } from "../src/campaigns/enroll";
import { editHooks } from "../src/campaigns/hooks";
import { deleteStep, deleteVariant, updateStep, updateVariant } from "../src/campaigns/sequence";
import { archiveCampaign, deleteCampaign, pauseCampaign } from "../src/campaigns/service";
import { fixedClock } from "../src/clock";
import { addBlocklist } from "../src/leads/blocklist";
import { softDeleteLead } from "../src/leads/service";
import { unsubscribeLead } from "../src/unsubscribe";
import { testEnv } from "./accounts-fixture";
import { planRow, seedCampaign } from "./campaign-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
const T = new Date("2026-10-20T10:00:00Z");
const clock = fixedClock(T);
beforeAll(async () => {
  testEnv(); // re-rendering a row builds its unsubscribe link from APP_URL / ENCRYPTION_KEY
  db = await createTestDb();
});
afterAll(() => db.drop());

/** A seeded campaign whose lead i has one row on step 1 with statuses[i]. */
async function withRows(statuses: MessageStatus[], steps = 1) {
  const s = await seedCampaign(P(), { at: T, leads: statuses.length, steps });
  const rows: ScheduledMessage[] = [];
  for (const [i, status] of statuses.entries())
    rows.push(
      await planRow(P(), {
        workspaceId: s.ws,
        campaignId: s.campaign.id,
        campaignLeadId: s.leads[i]!.cl.id,
        stepId: s.steps[0]!.id,
        variantId: s.steps[0]!.variant.id,
        accountId: s.accounts[0]!.id,
        dueAt: T,
        status,
      }),
    );
  const statusOf = async () =>
    (
      await P().scheduledMessage.findMany({
        where: { id: { in: rows.map((r) => r.id) } },
      })
    )
      .sort((a, b) => rows.findIndex((r) => r.id === a.id) - rows.findIndex((r) => r.id === b.id))
      .map((r) => r.status);
  return { ...s, rows, statusOf };
}
const OPEN: MessageStatus[] = ["SCHEDULED", "SENDING", "UNCERTAIN", "HELD", "SENT"];

describe("archive and delete (P3-T05 carry-forward)", () => {
  test("archive cancels SCHEDULED and HELD rows and never touches SENDING or UNCERTAIN", async () => {
    const s = await withRows(OPEN);
    await archiveCampaign(P(), s.ws, null, s.campaign.id);
    expect(await s.statusOf()).toEqual(["CANCELLED", "SENDING", "UNCERTAIN", "CANCELLED", "SENT"]);
  });

  test("deleting an ACTIVE campaign is 409 and changes nothing; a paused one cancels like archive", async () => {
    const s = await withRows(OPEN);
    await expect(deleteCampaign(P(), s.ws, null, s.campaign.id)).rejects.toMatchObject({
      status: 409,
      message: "campaign_active",
    });
    expect(await s.statusOf()).toEqual(OPEN);
    await pauseCampaign(P(), s.ws, null, s.campaign.id);
    expect(await s.statusOf()).toEqual(OPEN); // pause leaves rows for resume; the claim skips them
    await deleteCampaign(P(), s.ws, null, s.campaign.id);
    expect(await s.statusOf()).toEqual(["CANCELLED", "SENDING", "UNCERTAIN", "CANCELLED", "SENT"]);
  });
});

describe("edit hooks (P3-T06 contract)", () => {
  test("variant edit re-renders its SCHEDULED rows in place (T10b); deleting the variant cancels them and keeps history with variantId null", async () => {
    const s = await withRows(["SCHEDULED", "SENT", "SENDING"]);
    const v = s.steps[0]!.variant;
    await P().stepVariant.create({
      data: { stepId: s.steps[0]!.id, label: "B", subject: "x", body: "y" },
    });
    await updateVariant(P(), s.ws, null, v.id, { weight: 3 }); // no text change: no hook
    expect(await s.statusOf()).toEqual(["SCHEDULED", "SENT", "SENDING"]);
    await updateVariant(P(), s.ws, null, v.id, { body: "changed" });
    expect(await s.statusOf()).toEqual(["SCHEDULED", "SENT", "SENDING"]);
    const texts = await Promise.all(
      s.rows.map(
        async (r) =>
          (await P().scheduledMessage.findUniqueOrThrow({ where: { id: r.id } })).renderedText,
      ),
    );
    expect(texts[0]).toContain("changed");
    expect(texts.slice(1)).toEqual(["Hello", "Hello"]); // SENT and claimed rows keep their text
    await deleteVariant(P(), s.ws, null, v.id);
    expect(await s.statusOf()).toEqual(["CANCELLED", "SENT", "SENDING"]);
    const rows = await P().scheduledMessage.findMany({ where: { campaignId: s.campaign.id } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.variantId === null)).toBe(true);
  });

  test("step delay change and step delete cancel the step's SCHEDULED rows; a referenced step is soft-deleted", async () => {
    const s = await withRows(["SCHEDULED", "SENT"], 2);
    const s2 = s.steps[1]!;
    const r2 = await planRow(P(), {
      workspaceId: s.ws,
      campaignId: s.campaign.id,
      campaignLeadId: s.leads[1]!.cl.id,
      stepId: s2.id,
      variantId: s2.variant.id,
      accountId: s.accounts[0]!.id,
      dueAt: T,
    });
    await updateStep(P(), s.ws, null, s2.id, { delayValue: 3 });
    expect((await P().scheduledMessage.findUniqueOrThrow({ where: { id: r2.id } })).status).toBe(
      "CANCELLED",
    );
    expect(await s.statusOf()).toEqual(["SCHEDULED", "SENT"]);
    expect(await editHooks.stepReferenced(P(), s.steps[0]!.id)).toBe(true);
    await deleteStep(P(), s.ws, null, s.steps[0]!.id);
    expect(await s.statusOf()).toEqual(["CANCELLED", "SENT"]);
    expect(
      (await P().sequenceStep.findUniqueOrThrow({ where: { id: s.steps[0]!.id } })).deletedAt,
    ).not.toBeNull();
  });

  test("campaignHasSends: false with only cancelled rows, true once any other row exists", async () => {
    const s = await withRows(["CANCELLED"]);
    expect(await editHooks.campaignHasSends(P(), s.campaign.id)).toBe(false);
    await P().scheduledMessage.updateMany({
      where: { campaignId: s.campaign.id },
      data: { status: "SENT" },
    });
    expect(await editHooks.campaignHasSends(P(), s.campaign.id)).toBe(true);
  });

  test("a row a claim holds is skipped without waiting (SKIP LOCKED); the claim re-checks it", async () => {
    const s = await withRows(["SCHEDULED"]);
    const other = createPrisma(db.url, 2);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const held = new Promise<void>((r) => (locked = r));
    const holder = other.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "ScheduledMessage" WHERE id = ${s.rows[0]!.id} FOR UPDATE`;
        locked();
        await gate;
      },
      { timeout: 60_000 },
    );
    await held;
    await P().$transaction((tx) => editHooks.cancelOpenRows(tx, [s.leads[0]!.cl.id]), {
      timeout: 5_000,
    });
    release();
    await holder;
    await other.$disconnect();
    expect(await s.statusOf()).toEqual(["SCHEDULED"]);
  });
});

describe("lead paths cancel open rows", () => {
  test("remove, blocklist, unsubscribe and soft delete cancel SCHEDULED rows and leave in-flight ones", async () => {
    const s = await withRows(["SCHEDULED", "SCHEDULED", "SCHEDULED", "SCHEDULED", "SENDING"]);
    await removeCampaignLead(P(), clock, s.ws, null, s.leads[0]!.cl.id);
    await addBlocklist(P(), s.ws, null, [s.leads[1]!.lead.email]);
    expect(
      await unsubscribeLead(
        P(),
        clock,
        { w: s.ws, l: s.leads[2]!.lead.id, c: s.campaign.id },
        "page",
      ),
    ).toBe("done");
    await softDeleteLead(P(), clock, s.ws, s.leads[3]!.lead.id);
    await softDeleteLead(P(), clock, s.ws, s.leads[4]!.lead.id);
    expect(await s.statusOf()).toEqual([
      "CANCELLED",
      "CANCELLED",
      "CANCELLED",
      "CANCELLED",
      "SENDING",
    ]);
  });
});
