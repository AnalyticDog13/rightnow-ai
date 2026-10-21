import { createTestDb } from "@rightnow/db/test-db";
import { afterEach, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../src/clock";
import { updateLead } from "../src/leads/service";
import { hashValue } from "../src/leads/suppression";
import { leadTimeline } from "../src/leads/timeline";
import { seedCampaign } from "./campaign-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(() => db.drop());

test("imported, enrolled, sent, interest change: 4 entries, newest first; workspace scoped", async () => {
  const p = db.prisma;
  const s = await seedCampaign(p, { at: new Date("2026-10-20T10:00:00Z"), rows: 1 });
  const { lead, cl } = s.leads[0]!;
  const job = await p.importJob.create({
    data: {
      workspaceId: s.ws,
      createdById: "u",
      fileName: "x.csv",
      mapping: {},
      options: {},
      confirmedAuthorized: true,
      source: "s",
      lawfulBasis: "b",
      createdAt: new Date("2026-10-01T00:00:00Z"),
    },
  });
  await p.lead.update({ where: { id: lead.id }, data: { importJobId: job.id } });
  await p.campaignLead.update({
    where: { id: cl.id },
    data: { enrolledAt: new Date("2026-10-02T00:00:00Z") },
  });
  await p.scheduledMessage.update({
    where: { id: s.rows[0]!.id },
    data: { status: "SENT", sentAt: new Date("2026-10-03T00:00:00Z") },
  });
  await updateLead(
    p,
    fixedClock(new Date("2026-10-04T00:00:00Z")),
    s.ws,
    lead.id,
    { interestStatus: 1 },
    null,
  );

  const t = await leadTimeline(p, s.ws, lead.id);
  expect(t.map((e) => e.kind)).toEqual(["status_changed", "sent", "enrolled", "imported"]);
  expect(t[1]!.detail).toMatchObject({ step: 1, variant: "A", account: s.accounts[0]!.email });
  expect(t[0]!.detail).toMatchObject({ interestStatus: 1 });

  await p.suppression.create({
    data: {
      workspaceId: s.ws,
      kind: "EMAIL",
      value: lead.email,
      valueHash: hashValue(lead.email),
      reason: "UNSUBSCRIBE",
    },
  });
  expect((await leadTimeline(p, s.ws, lead.id))[0]!.kind).toBe("unsubscribed");
  expect(await leadTimeline(p, "other-ws", lead.id)).toEqual([]);
});
