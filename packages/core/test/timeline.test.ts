import { createTestDb } from "@rightnow/db/test-db";
import { afterEach, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../src/clock";
import { createOpportunity } from "../src/crm/opportunities";
import { createTask } from "../src/crm/tasks";
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
  await p.workspace.update({ where: { id: s.ws }, data: { crmAutoOpportunity: false } }); // keep this list to the P3 kinds
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

test("replies, bounces and unsubscribes come from Event; an unsubscribe is listed once", async () => {
  const p = db.prisma;
  const s = await seedCampaign(p, { at: new Date("2026-10-20T10:00:00Z"), leads: 1 });
  const { lead } = s.leads[0]!;
  const ev = (
    type: "REPLY" | "AUTO_REPLY" | "BOUNCE_SOFT" | "UNSUBSCRIBE",
    day: number,
    meta = {},
  ) =>
    p.event.create({
      data: {
        workspaceId: s.ws,
        type,
        occurredAt: new Date(`2026-10-0${day}T00:00:00Z`),
        leadId: lead.id,
        campaignId: s.campaign.id,
        meta,
        dedupeKey: `${type}:${day}`,
      },
    });
  await ev("REPLY", 4, { category: "INTERESTED" });
  await ev("AUTO_REPLY", 5, { category: "OUT_OF_OFFICE" });
  await ev("BOUNCE_SOFT", 6, { recipient: lead.email });
  await ev("UNSUBSCRIBE", 7);
  await p.suppression.create({
    data: {
      workspaceId: s.ws,
      kind: "EMAIL",
      value: lead.email,
      valueHash: hashValue(lead.email),
      reason: "UNSUBSCRIBE",
    },
  });
  const t = (await leadTimeline(p, s.ws, lead.id)).filter((e) => e.kind !== "enrolled");
  expect(t).toMatchObject([
    { kind: "unsubscribed", detail: { campaignId: s.campaign.id } },
    { kind: "bounced", detail: { type: "SOFT", recipient: lead.email } },
    { kind: "replied", detail: { auto: true, category: "OUT_OF_OFFICE" } },
    { kind: "replied", detail: { auto: false, category: "INTERESTED" } },
  ]);
});

test("notes, tasks and deals", async () => {
  const p = db.prisma;
  const s = await seedCampaign(p, { at: new Date("2026-10-20T10:00:00Z"), rows: 1 });
  const { lead } = s.leads[0]!;
  const clock = fixedClock(new Date("2026-10-21T10:00:00Z"));
  await p.note.create({ data: { workspaceId: s.ws, leadId: lead.id, body: "rang", kind: "call" } });
  await createTask(p, clock, s.ws, "u1", { leadId: lead.id, title: "follow up" });
  await createOpportunity(p, clock, s.ws, "u1", { leadId: lead.id });
  const other = await p.lead.create({ data: { workspaceId: s.ws, email: "o@x.test" } });
  await p.note.create({ data: { workspaceId: s.ws, leadId: other.id, body: "not mine" } });
  const t = await leadTimeline(p, s.ws, lead.id);
  expect(t.map((e) => e.kind)).toEqual(expect.arrayContaining(["note", "task", "opportunity"]));
  expect(t.find((e) => e.kind === "note")!.detail).toMatchObject({
    body: "rang",
    noteKind: "call",
  });
  expect(t.find((e) => e.kind === "task")!.detail).toMatchObject({
    title: "follow up",
    action: "task.create",
  });
  expect(t.filter((e) => e.kind === "note")).toHaveLength(1);
});
