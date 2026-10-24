import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, expect, test } from "vitest";
import { fixedClock } from "../src/clock";
import { exportLeadData } from "../src/leads/export";
import { gdprDeleteLead } from "../src/leads/service";
import { seedAccount } from "./accounts-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

const T = new Date("2026-10-20T10:00:00Z");
let n = 0;

async function world() {
  const acct = await seedAccount(P(), null, `a${n++}@mine.test`);
  const ws = acct.workspaceId;
  const mk = (email: string) =>
    P().lead.create({ data: { workspaceId: ws, email, companyName: "Acme" } });
  const lead = await mk("jane@acme.test");
  const twin = await mk("john@acme.test"); // same company, another person
  const thread = (subject: string, leadId?: string) =>
    P().thread.create({
      data: { workspaceId: ws, accountId: acct.id, subject, leadId, lastMessageAt: T },
    });
  const msg = (threadId: string, o: Record<string, unknown>) =>
    P().message.create({
      data: {
        workspaceId: ws,
        accountId: acct.id,
        threadId,
        rfcMessageId: `<m${n++}@x>`,
        folder: "INBOX",
        sentAt: T,
        kind: "REPLY",
        direction: "IN",
        fromEmail: "jane@acme.test",
        to: [acct.email],
        cc: [],
        subject: "Re: hi",
        text: "plain",
        html: "<p>rich</p>",
        ...o,
      } as never,
    });
  await msg((await thread("Re: hi", lead.id)).id, {});
  // a sent step: the thread is not linked to the lead, so it is matched by the recipient address
  await msg((await thread("hi")).id, {
    direction: "OUT",
    folder: "SENT",
    kind: "OUTBOUND",
    fromEmail: acct.email,
    to: ["jane@acme.test"],
    subject: "hi",
  });
  await msg((await thread("other", twin.id)).id, { fromEmail: "john@acme.test", subject: "other" });
  await P().note.create({ data: { workspaceId: ws, leadId: lead.id, body: "jane note" } });
  await P().note.create({ data: { workspaceId: ws, leadId: twin.id, body: "john note" } });
  await P().task.create({ data: { workspaceId: ws, leadId: lead.id, title: "call jane" } });
  await P().task.create({ data: { workspaceId: ws, leadId: twin.id, title: "call john" } });
  const stage = await P().pipelineStage.create({
    data: { workspaceId: ws, name: "New", position: 0, kind: "OPEN", interestCodes: [] },
  });
  const opp = (leadId: string, title: string) =>
    P().opportunity.create({ data: { workspaceId: ws, leadId, stageId: stage.id, title } });
  await opp(lead.id, "Jane deal");
  await opp(twin.id, "John deal");
  for (const [i, leadId] of [lead.id, lead.id, lead.id, twin.id].entries())
    await P().event.create({
      data: { workspaceId: ws, type: "OPEN", occurredAt: T, leadId, dedupeKey: `ex:${ws}:${i}` },
    });
  return { ws, lead };
}

test("exports exactly the lead's threads (text and html), note, task, deal and 3 events; nothing of the twin", async () => {
  const { ws, lead } = await world();
  const out = await exportLeadData(P(), ws, lead.id, "u1");
  expect(out.lead).toMatchObject({ id: lead.id, email: "jane@acme.test" });
  expect(out.threads!.map((t) => t.subject).sort()).toEqual(["Re: hi", "hi"]);
  const inbound = out.threads!.find((t) => t.subject === "Re: hi")!;
  expect(inbound.messages).toHaveLength(1);
  expect(inbound.messages[0]).toMatchObject({
    direction: "IN",
    from: "jane@acme.test",
    text: "plain",
    html: "<p>rich</p>",
  });
  expect(out.threads!.find((t) => t.subject === "hi")!.messages[0]).toMatchObject({
    direction: "OUT",
    to: ["jane@acme.test"],
  });
  expect(out.notes).toMatchObject([{ body: "jane note" }]);
  expect(out.tasks).toMatchObject([{ title: "call jane" }]);
  expect(out.opportunities).toMatchObject([{ title: "Jane deal" }]);
  expect(out.events).toHaveLength(3);
  expect(JSON.stringify(out)).not.toMatch(/john/i);
  const where = { workspaceId: ws, action: "lead.export", target: lead.id, actorId: "u1" };
  expect(await P().auditLog.count({ where })).toBe(1);
});

test("another workspace's lead is a 404; after gdprDeleteLead the export is a 404", async () => {
  const { ws, lead } = await world();
  const other = await world();
  await expect(exportLeadData(P(), other.ws, lead.id)).rejects.toMatchObject({ status: 404 });
  await gdprDeleteLead(P(), fixedClock(T), ws, lead.id, "u1");
  await expect(exportLeadData(P(), ws, lead.id)).rejects.toMatchObject({ status: 404 });
});

test("a foreign lead's thread that cc'd this lead once exposes only that message and none of the foreign notes", async () => {
  const acct = await seedAccount(P(), null, `cc${n++}@mine.test`);
  const ws = acct.workspaceId;
  const a = await P().lead.create({ data: { workspaceId: ws, email: "a@acme.test" } });
  const b = await P().lead.create({ data: { workspaceId: ws, email: "b@acme.test" } });
  const thread = await P().thread.create({
    data: {
      workspaceId: ws,
      accountId: acct.id,
      subject: "B deal",
      leadId: b.id,
      lastMessageAt: T,
    },
  });
  const msg = (text: string, cc: string[]) =>
    P().message.create({
      data: {
        workspaceId: ws,
        accountId: acct.id,
        threadId: thread.id,
        rfcMessageId: `<cc${n++}@x>`,
        folder: "INBOX",
        sentAt: T,
        kind: "REPLY",
        direction: "IN",
        fromEmail: "b@acme.test",
        to: [acct.email],
        cc,
        subject: "B deal",
        text,
      },
    });
  await msg("b private pricing", []);
  await msg("looping in a", ["a@acme.test"]);
  await P().note.create({
    data: { workspaceId: ws, threadId: thread.id, body: "b internal note" },
  });
  await P().note.create({ data: { workspaceId: ws, leadId: b.id, body: "b lead note" } });
  const out = await exportLeadData(P(), ws, a.id);
  expect(out.threads!.map((t) => t.messages.map((m) => m.text))).toEqual([["looping in a"]]);
  expect(out.notes).toEqual([]);
  expect(JSON.stringify(out)).not.toMatch(/private pricing|internal note|lead note/);
  // the thread's own lead still gets everything
  const own = await exportLeadData(P(), ws, b.id);
  expect(own.threads![0]!.messages).toHaveLength(2);
  expect(own.notes).toHaveLength(2);
});

test("an API key without inbox:read / crm:read gets no threads / CRM sections, and is told so (I2)", async () => {
  const { ws, lead } = await world();
  const bare = await exportLeadData(P(), ws, lead.id, null, { scopes: ["leads:read"] });
  expect(bare).not.toHaveProperty("threads");
  for (const k of ["notes", "tasks", "opportunities"]) expect(bare).not.toHaveProperty(k);
  expect(bare.omitted).toEqual(["threads", "crm"]);
  expect(bare.events).toHaveLength(3);
  expect(JSON.stringify(bare)).not.toMatch(/plain|jane note|call jane|Jane deal/);
  const inbox = await exportLeadData(P(), ws, lead.id, null, {
    scopes: ["leads:read", "inbox:read"],
  });
  expect(inbox.threads).toHaveLength(2);
  expect(inbox.omitted).toEqual(["crm"]);
  const all = await exportLeadData(P(), ws, lead.id, null, { scopes: ["all:all"] });
  expect(all.omitted).toBeUndefined();
  expect(all.notes).toHaveLength(1);
  expect((await exportLeadData(P(), ws, lead.id)).omitted).toBeUndefined(); // a session
});
