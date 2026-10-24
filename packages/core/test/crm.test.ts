import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmailAccount, ReplyCategory } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import { getFakeProvider, newMessageId, type RemoteMessage } from "@rightnow/providers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { fixedClock } from "../src/clock";
import {
  createOpportunity,
  deleteOpportunity,
  listOpportunities,
  pipelineBoard,
  updateOpportunity,
} from "../src/crm/opportunities";
import { createStage, deleteStage, ensureStages, updateStage } from "../src/crm/stages";
import { withTxRetry } from "../src/dispatch";
import {
  bulkLeads,
  gdprDeleteLead,
  mergeLeads,
  softDeleteLead,
  updateLead,
} from "../src/leads/service";
import type { Classification } from "../src/mail/classify";
import { ingestMessage } from "../src/mail/ingest";
import { applyInbound } from "../src/mail/stoprules";
import { reconcileAccount } from "../src/mail/sync";
import { updateWorkspaceSettings } from "../src/settings";
import { planRow, seedCampaign } from "./campaign-fixture";

process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "crm-"));

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

const T = new Date("2026-10-20T10:00:00Z");
const DAY = 86_400_000;
const at = (ms: number) => new Date(T.getTime() + ms);
const clock = fixedClock(T);
const NAMES = [
  ...["Not Contacted", "Contacted", "Replied", "Interested", "Meeting Scheduled"],
  ...["Proposal Sent", "Negotiation", "Closed Won", "Closed Lost"],
];

type World = Awaited<ReturnType<typeof world>>;
/** A campaign C (2 steps, accounts X and Y) with the default stages; `st(name)` gives a stage id. */
async function world(o: { stopOnReply?: boolean } = {}) {
  const s = await seedCampaign(P(), { at: T, steps: 2, campaign: { ...o } });
  const stages = await ensureStages(P(), s.ws);
  const st = (name: string) => stages.find((x) => x.name === name)!.id;
  return { ...s, st };
}
let n = 0;
const newLead = (ws: string, o: Record<string, unknown> = {}) =>
  P().lead.create({ data: { workspaceId: ws, email: `l${++n}@co${n}.test`, ...o } });
/** An ACCEPTED Event, as the sender records it. */
const accepted = (
  w: World,
  leadId: string,
  o: { step?: number; at?: Date; campaignId?: string; account?: number } = {},
) =>
  P().event.create({
    data: {
      workspaceId: w.ws,
      type: "ACCEPTED",
      occurredAt: o.at ?? at(-DAY),
      leadId,
      campaignId: o.campaignId ?? w.campaign.id,
      stepId: w.steps[o.step ?? 0]!.id,
      variantId: w.steps[o.step ?? 0]!.variant.id,
      accountId: w.accounts[o.account ?? 0]!.id,
      dedupeKey: `acc:${++n}`,
    },
  });
async function member(ws: string) {
  const id = `u${++n}`;
  await P().user.create({ data: { id, name: id, email: `${id}@x.io` } });
  await P().member.create({ data: { id, workspaceId: ws, userId: id, role: "member" } });
  return id;
}
const deals = (ws: string) =>
  P().opportunity.findMany({ where: { workspaceId: ws }, orderBy: { createdAt: "asc" } });
const events = (ws: string, type: string) =>
  P().event.findMany({ where: { workspaceId: ws, type: type as never }, orderBy: { id: "asc" } });
const audits = (ws: string, action: string) =>
  P().auditLog.findMany({ where: { workspaceId: ws, action }, orderBy: { createdAt: "asc" } });
const err = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { status?: number; message?: string; body?: unknown }) => ({
      status: e.status,
      message: e.message,
      body: e.body,
    }),
  );

type TxC = Parameters<Parameters<ReturnType<typeof P>["$transaction"]>[0]>[0];
/** Runs `fn` in a transaction that stays open (its locks held) until `release()`; forces an interleaving. */
async function hold(fn: (tx: TxC) => Promise<unknown>) {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  let ready!: () => void;
  const started = new Promise<void>((r) => (ready = r));
  const done = P().$transaction(
    async (tx) => {
      await fn(tx);
      ready();
      await gate;
    },
    { timeout: 20_000 },
  );
  await started;
  return {
    release: async () => {
      await new Promise((r) => setTimeout(r, 300)); // let the contender reach the lock
      open();
      await done;
    },
  };
}

/** step 1 SENT from X two days ago (rfc), step 2 SENT from X yesterday; both ACCEPTED; enrolled 3 days ago. */
async function enrol(w: World, o: { plValue?: number; email?: string } = {}) {
  const lead = await newLead(w.ws, {
    ...(o.email && { email: o.email }),
    ...(o.plValue !== undefined && { plValue: o.plValue }),
  });
  const cl = await P().campaignLead.create({
    data: {
      workspaceId: w.ws,
      campaignId: w.campaign.id,
      leadId: lead.id,
      state: "ACTIVE",
      currentStepId: w.steps[1]!.id,
      accountId: w.accounts[0]!.id,
      enrolledAt: at(-3 * DAY),
    },
  });
  const base = {
    workspaceId: w.ws,
    campaignId: w.campaign.id,
    campaignLeadId: cl.id,
    accountId: w.accounts[0]!.id,
    status: "SENT" as const,
    renderedSubject: "Quick question",
  };
  const rfc = newMessageId("send.test");
  const sm1 = await planRow(P(), {
    ...base,
    stepId: w.steps[0]!.id,
    variantId: w.steps[0]!.variant.id,
    dueAt: at(-2 * DAY),
    sentAt: at(-2 * DAY),
    rfcMessageId: rfc,
  });
  await planRow(P(), {
    ...base,
    stepId: w.steps[1]!.id,
    variantId: w.steps[1]!.variant.id,
    dueAt: at(-DAY),
    sentAt: at(-DAY),
    rfcMessageId: newMessageId("send.test"),
  });
  await accepted(w, lead.id, { step: 0, at: at(-2 * DAY) });
  await accepted(w, lead.id, { step: 1, at: at(-DAY) });
  return { lead, cl, sm1, rfc };
}

let m = 0;
const msg = (o: Partial<RemoteMessage>): RemoteMessage => ({
  providerMessageId: `p${++m}`,
  rfcMessageId: `<r${m}-${n}@x.test>`,
  folder: "INBOX",
  inReplyTo: null,
  references: [],
  from: { email: "nobody@x.test" },
  to: [],
  cc: [],
  subject: "Re: Quick question",
  date: T,
  text: "Tell me more.",
  html: null,
  headers: {},
  attachments: [],
  ...o,
});
const REPLY = (category: ReplyCategory = "INTERESTED"): Classification => ({
  kind: "REPLY",
  category,
  source: "RULE",
});
/** ingest + applyInbound in one transaction with withTxRetry, as the sync does; counts the attempts. */
async function receive(a: EmailAccount, x: RemoteMessage, c = REPLY()) {
  let attempts = 0;
  await withTxRetry(() =>
    P().$transaction(async (tx) => {
      attempts++;
      const r = await ingestMessage(tx, a, x, c, { historical: false });
      if (r.created)
        await applyInbound(tx, clock, {
          workspaceId: a.workspaceId,
          message: await tx.message.findUniqueOrThrow({ where: { id: r.messageId } }),
          classification: c,
          match: r.match,
        });
    }),
  );
  return attempts;
}
const threaded = (lead: { email: string }, rfc: string, o: Partial<RemoteMessage> = {}) =>
  msg({ from: { email: lead.email }, inReplyTo: rfc, references: [rfc], ...o });

describe("stages", () => {
  test("default stages", async () => {
    const ws = (await P().workspace.create({ data: { name: "W", slug: `w${++n}` } })).id;
    const [a, b] = await Promise.all([ensureStages(P(), ws), ensureStages(P(), ws)]);
    expect(await P().pipelineStage.count({ where: { workspaceId: ws } })).toBe(9);
    for (const s of [a, b]) expect(s.map((x) => x.name)).toEqual(NAMES);
    expect(a.map((x) => [x.position, x.kind, x.interestCodes])).toEqual([
      [0, "OPEN", []],
      [1, "OPEN", []],
      [2, "OPEN", []],
      [3, "OPEN", [1]],
      [4, "OPEN", [2, 3]],
      [5, "OPEN", []],
      [6, "OPEN", []],
      [7, "WON", [4]],
      [8, "LOST", [-3, -1]],
    ]);
    await updateStage(P(), ws, null, a[2]!.id, { name: "Responded" });
    const c = await ensureStages(P(), ws);
    expect(c).toHaveLength(9);
    expect(c[2]!.name).toBe("Responded");
    expect(await audits(ws, "stage.update")).toHaveLength(1);
  });

  test("stage rules", async () => {
    const w = await world();
    const before = await ensureStages(P(), w.ws);
    const snapshot = () =>
      P().pipelineStage.findMany({ where: { workspaceId: w.ws }, orderBy: { id: "asc" } });
    const s0 = await snapshot();
    const l1 = await newLead(w.ws);
    const l2 = await newLead(w.ws);
    for (const l of [l1, l2])
      await createOpportunity(P(), clock, w.ws, null, { leadId: l.id, stageId: w.st("Contacted") });
    const deal = (await deals(w.ws))[0]!;

    expect(
      await err(createStage(P(), w.ws, null, { name: "X", kind: "OPEN", interestCodes: [1] })),
    ).toMatchObject({
      status: 400,
      message: "interest_code_taken",
    });
    expect(
      await err(updateStage(P(), w.ws, null, w.st("Proposal Sent"), { interestCodes: [4] })),
    ).toMatchObject({
      status: 400,
      message: "interest_code_taken",
    });
    expect(await err(deleteStage(P(), w.ws, null, w.st("Closed Won")))).toMatchObject({
      status: 409,
      message: "last_stage_of_kind",
    });
    expect(
      await err(updateStage(P(), w.ws, null, w.st("Closed Won"), { kind: "OPEN" })),
    ).toMatchObject({
      status: 409,
      message: "last_stage_of_kind",
    });
    expect(await err(deleteStage(P(), w.ws, null, w.st("Contacted")))).toMatchObject({
      status: 409,
      message: "stage_not_empty",
    });
    expect(
      await err(deleteStage(P(), w.ws, null, w.st("Contacted"), w.st("Closed Won"))),
    ).toMatchObject({ status: 400, message: "move_kind_mismatch" });
    expect(
      await err(updateStage(P(), w.ws, null, w.st("Contacted"), { kind: "LOST" })),
    ).toMatchObject({
      status: 409,
      message: "stage_not_empty",
    });
    expect(await snapshot()).toEqual(s0);
    expect((await deals(w.ws)).every((d) => d.stageId === w.st("Contacted"))).toBe(true);

    for (let i = 0; i < 11; i++)
      await createStage(P(), w.ws, null, { name: `S${i}`, kind: "OPEN" });
    expect(await err(createStage(P(), w.ws, null, { name: "S21", kind: "OPEN" }))).toMatchObject({
      status: 400,
      message: "too_many_stages",
    });
    expect(await P().pipelineStage.count({ where: { workspaceId: w.ws } })).toBe(20);

    // cross-workspace ids (Rev 2 M3)
    const o = await world();
    expect(
      await err(deleteStage(P(), w.ws, null, w.st("Contacted"), o.st("Replied"))),
    ).toMatchObject({ status: 404 });
    expect(await err(deleteStage(P(), w.ws, null, o.st("Replied")))).toMatchObject({ status: 404 });
    expect(
      await err(updateOpportunity(P(), clock, w.ws, null, deal.id, { stageId: o.st("Replied") })),
    ).toMatchObject({ status: 404 });
    expect(
      await err(
        createOpportunity(P(), clock, w.ws, null, { leadId: l1.id, campaignId: o.campaign.id }),
      ),
    ).toMatchObject({ status: 400 });
    expect(
      await err(
        createOpportunity(P(), clock, w.ws, null, { leadId: l1.id, stageId: o.st("Replied") }),
      ),
    ).toMatchObject({ status: 404 });

    // the valid calls
    expect(await deleteStage(P(), w.ws, null, w.st("Contacted"), w.st("Replied"))).toEqual({
      moved: 2,
    });
    expect((await deals(w.ws)).every((d) => d.stageId === w.st("Replied"))).toBe(true);
    expect(await audits(w.ws, "stage.delete")).toHaveLength(1);
    const last = (await ensureStages(P(), w.ws)).at(-1)!;
    const after = await updateStage(P(), w.ws, null, last.id, { position: 0 });
    expect(after[0]!.id).toBe(last.id);
    expect(after.map((s) => s.position)).toEqual([...Array(19).keys()]);
    expect(before).toHaveLength(9);
  });

  test("stage locks", async () => {
    const w = await world();
    const l = await newLead(w.ws);
    const d = await createOpportunity(P(), clock, w.ws, null, {
      leadId: l.id,
      stageId: w.st("Proposal Sent"),
    });
    // the move holds the deal while the delete starts: the delete's deal scan waits, then skips it
    const h = await hold(
      (tx) => tx.$queryRaw`SELECT id FROM "Opportunity" WHERE id = ${d.id} FOR UPDATE`,
    );
    const upd = err(
      updateOpportunity(P(), clock, w.ws, null, d.id, { stageId: w.st("Contacted") }),
    );
    const del = err(deleteStage(P(), w.ws, null, w.st("Proposal Sent"), w.st("Negotiation")));
    await h.release();
    expect([await del, await upd]).toEqual([null, null]);
    expect((await P().opportunity.findUniqueOrThrow({ where: { id: d.id } })).stageId).toBe(
      w.st("Contacted"),
    );

    // a deal inserted into S while its delete runs: the FK refuses the delete
    const l2 = await newLead(w.ws);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let ready!: () => void;
    const inserted = new Promise<void>((r) => (ready = r));
    const ins = P().$transaction(
      async (tx) => {
        await tx.opportunity.create({
          data: { workspaceId: w.ws, leadId: l2.id, stageId: w.st("Replied"), title: "t" },
        });
        ready();
        await gate;
      },
      { timeout: 20_000 },
    );
    await inserted;
    const del2 = err(deleteStage(P(), w.ws, null, w.st("Replied")));
    await new Promise((r) => setTimeout(r, 300));
    release();
    await ins;
    expect(await del2).toMatchObject({ status: 409, message: "stage_not_empty" });
    expect(await P().pipelineStage.count({ where: { id: w.st("Replied") } })).toBe(1);
  });

  test("stage moves are serialized", async () => {
    const w = await world();
    const l = await newLead(w.ws);
    const d = await createOpportunity(P(), clock, w.ws, null, {
      leadId: l.id,
      stageId: w.st("Negotiation"),
    });
    const won = { stageId: w.st("Closed Won") };
    // both PATCHes queue behind a held deal lock, so both start from Negotiation
    const h = await hold(
      (tx) => tx.$queryRaw`SELECT id FROM "Opportunity" WHERE id = ${d.id} FOR UPDATE`,
    );
    const both = Promise.all([
      updateOpportunity(P(), clock, w.ws, null, d.id, won),
      updateOpportunity(P(), clock, w.ws, null, d.id, won),
    ]);
    await h.release();
    await both;
    expect(await events(w.ws, "DEAL_WON")).toHaveLength(1);
    expect(await audits(w.ws, "opportunity.stage")).toHaveLength(1);
    expect((await P().opportunity.findUniqueOrThrow({ where: { id: d.id } })).closedAt).toEqual(T);
  });

  test("a kind change waits for a deal moving in (Rev 2 I3)", async () => {
    const w = await world();
    const l = await newLead(w.ws);
    const S = w.st("Proposal Sent");
    // a move into the empty stage, in flight: it holds KEY SHARE on S and saw it OPEN
    const h = await hold(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PipelineStage" WHERE id = ${S} FOR KEY SHARE`;
      await tx.opportunity.create({
        data: { workspaceId: w.ws, leadId: l.id, stageId: S, title: "t" },
      });
    });
    const edit = err(updateStage(P(), w.ws, null, S, { kind: "WON" }));
    await h.release();
    expect(await edit).toMatchObject({ status: 409, message: "stage_not_empty" });
    expect((await P().pipelineStage.findUniqueOrThrow({ where: { id: S } })).kind).toBe("OPEN");
  });
});

describe("interest hook", () => {
  test("interest creates and moves", async () => {
    const w = await world();
    const c = fixedClock(T);
    const lead = await newLead(w.ws, { plValue: 250 });
    await accepted(w, lead.id, { step: 0, account: 0 });
    const attr = {
      campaignId: w.campaign.id,
      stepId: w.steps[0]!.id,
      variantId: w.steps[0]!.variant.id,
      accountId: w.accounts[0]!.id,
    };
    await updateLead(P(), c, w.ws, lead.id, { interestStatus: 1 });
    const [d] = await deals(w.ws);
    expect(await deals(w.ws)).toHaveLength(1);
    expect(d).toMatchObject({ ...attr, stageId: w.st("Interested"), closedAt: null });
    expect(d!.value.toFixed(2)).toBe("250.00");
    expect(await events(w.ws, "OPPORTUNITY")).toMatchObject([{ ...attr, leadId: lead.id }]);
    expect((await events(w.ws, "INTEREST_CHANGED")).map((e) => e.meta)).toEqual([
      { from: null, to: 1, source: "manual" },
    ]);

    c.advance(1000);
    await updateLead(P(), c, w.ws, lead.id, { interestStatus: 2 });
    expect((await deals(w.ws))[0]!.stageId).toBe(w.st("Meeting Scheduled"));
    expect(await events(w.ws, "MEETING")).toMatchObject([{ ...attr, leadId: lead.id }]);
    const st = await audits(w.ws, "opportunity.stage");
    expect(st.map((a) => a.meta)).toEqual([
      { leadId: lead.id, from: w.st("Interested"), to: w.st("Meeting Scheduled") },
    ]);
    for (const a of await P().auditLog.findMany({
      where: { workspaceId: w.ws, action: { startsWith: "opportunity." } },
    }))
      expect(JSON.stringify(a.meta)).not.toMatch(/title|@/);

    c.advance(1000);
    await updateLead(P(), c, w.ws, lead.id, { interestStatus: 4 });
    expect((await deals(w.ws))[0]).toMatchObject({
      stageId: w.st("Closed Won"),
      closedAt: c.now(),
    });
    expect(await events(w.ws, "DEAL_WON")).toMatchObject([{ ...attr, leadId: lead.id }]);
    expect(
      (await events(w.ws, "INTEREST_CHANGED")).map((e) => (e.meta as { to: number }).to),
    ).toEqual([1, 2, 4]);

    // no automatic deal when switched off; unmapped codes and null touch no deal
    const x = await world();
    await P().workspace.update({ where: { id: x.ws }, data: { crmAutoOpportunity: false } });
    const nl = await newLead(x.ws);
    await updateLead(P(), c, x.ws, nl.id, { interestStatus: 1 });
    expect(await deals(x.ws)).toEqual([]);
    const y = await world();
    const yl = await newLead(y.ws);
    await updateLead(P(), c, y.ws, yl.id, { interestStatus: 1 });
    for (const v of [0, -2, null]) {
      c.advance(1000);
      await updateLead(P(), c, y.ws, yl.id, { interestStatus: v });
    }
    expect((await deals(y.ws)).map((d) => d.stageId)).toEqual([y.st("Interested")]);
    expect(await audits(y.ws, "opportunity.stage")).toEqual([]);
  });

  test("status targets the right deal", async () => {
    const w = await world();
    const b = await seedCampaign(P(), { at: T, workspaceId: w.ws, useAccounts: w.accounts });
    const lead = await newLead(w.ws);
    await accepted(w, lead.id, { at: at(-3 * DAY) });
    await updateLead(P(), clock, w.ws, lead.id, { interestStatus: 1 });
    await accepted(w, lead.id, { at: at(-DAY), campaignId: b.campaign.id });
    await updateLead(P(), fixedClock(at(1000)), w.ws, lead.id, { interestStatus: 2 });
    expect(await deals(w.ws)).toMatchObject([
      { campaignId: w.campaign.id, stageId: w.st("Meeting Scheduled") },
    ]);
  });

  test("status never un-wins", async () => {
    const w = await world();
    const lead = await newLead(w.ws);
    const d = await createOpportunity(P(), clock, w.ws, null, { leadId: lead.id });
    await updateOpportunity(P(), clock, w.ws, null, d.id, { stageId: w.st("Closed Won") });
    await updateLead(P(), fixedClock(at(1000)), w.ws, lead.id, { interestStatus: 2 });
    expect(await deals(w.ws)).toMatchObject([{ stageId: w.st("Closed Won"), closedAt: T }]);
    await updateLead(P(), fixedClock(at(2000)), w.ws, lead.id, { interestStatus: -3 });
    expect(await deals(w.ws)).toMatchObject([{ stageId: w.st("Closed Lost"), closedAt: at(2000) }]);
    expect(await events(w.ws, "DEAL_LOST")).toHaveLength(1);
  });

  test("a value that rounds up to 1e12 becomes 0", async () => {
    const w = await world();
    const lead = await newLead(w.ws, { plValue: "999999999999.996" });
    await updateLead(P(), clock, w.ws, lead.id, { interestStatus: 1 });
    expect((await deals(w.ws))[0]!.value.toFixed(2)).toBe("0.00");
    const l2 = await newLead(w.ws, { plValue: "999999999999.99" });
    await updateLead(P(), clock, w.ws, l2.id, { interestStatus: 1 });
    expect(
      (await P().opportunity.findFirstOrThrow({ where: { leadId: l2.id } })).value.toFixed(2),
    ).toBe("999999999999.99");
    const l3 = await newLead(w.ws);
    await expect(
      createOpportunity(P(), clock, w.ws, null, { leadId: l3.id, value: 999999999999.999 }),
    ).rejects.toThrow();
  });

  test("a reply never moves a closed deal", async () => {
    const w = await world({ stopOnReply: false });
    const e = await enrol(w);
    const d = await createOpportunity(P(), clock, w.ws, null, {
      leadId: e.lead.id,
      campaignId: w.campaign.id,
    });
    await updateOpportunity(P(), clock, w.ws, null, d.id, { stageId: w.st("Closed Won") });
    await receive(
      w.accounts[0]!,
      threaded(e.lead, e.rfc, { text: "Not interested." }),
      REPLY("NOT_INTERESTED"),
    );
    expect((await P().lead.findUniqueOrThrow({ where: { id: e.lead.id } })).interestStatus).toBe(
      -1,
    );
    expect(await deals(w.ws)).toMatchObject([{ stageId: w.st("Closed Won"), closedAt: T }]);
    expect(await events(w.ws, "DEAL_LOST")).toEqual([]);
  });

  test("a status change reads the old status under the Lead lock", async () => {
    const w = await world();
    const lead = await newLead(w.ws);
    await updateLead(P(), clock, w.ws, lead.id, { interestStatus: 1 });
    const [d] = await deals(w.ws);
    // another request has set 2 and moved the deal, not yet committed
    const h = await hold(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Lead" WHERE id = ${lead.id} FOR UPDATE`;
      await tx.lead.update({ where: { id: lead.id }, data: { interestStatus: 2 } });
      await tx.opportunity.update({
        where: { id: d!.id },
        data: { stageId: w.st("Meeting Scheduled") },
      });
    });
    const c = fixedClock(at(1000));
    const b = updateLead(P(), c, w.ws, lead.id, { interestStatus: 1 });
    await h.release();
    await b;
    expect((await P().lead.findUniqueOrThrow({ where: { id: lead.id } })).interestStatus).toBe(1);
    expect((await deals(w.ws))[0]!.stageId).toBe(w.st("Interested"));
    expect((await events(w.ws, "INTEREST_CHANGED")).map((e) => e.meta)).toEqual([
      { from: null, to: 1, source: "manual" },
      { from: 2, to: 1, source: "manual" },
    ]);
  });

  test("reply creates opportunity", async () => {
    const w = await world();
    const e = await enrol(w);
    await receive(w.accounts[0]!, threaded(e.lead, e.rfc));
    expect(await deals(w.ws)).toMatchObject([
      {
        leadId: e.lead.id,
        campaignId: w.campaign.id,
        stageId: w.st("Interested"),
        stepId: w.steps[0]!.id,
        variantId: w.steps[0]!.variant.id,
        accountId: w.accounts[0]!.id,
        ownerId: null,
      },
    ]);
    expect(await events(w.ws, "OPPORTUNITY")).toMatchObject([{ stepId: w.steps[0]!.id }]);

    // the interest is already set: the reply sets nothing, so it opens no deal
    const e2 = await enrol(w);
    await P().lead.update({ where: { id: e2.lead.id }, data: { interestStatus: 2 } });
    await receive(w.accounts[0]!, threaded(e2.lead, e2.rfc));
    expect(await deals(w.ws)).toHaveLength(1);
  });
});

describe("crm step never blocks ingest", () => {
  /** A live, never-synced account X with one enrolled lead; the reply arrives in the Fake mailbox. */
  async function synced(plValue?: number) {
    const s = await seedCampaign(P(), {
      at: T,
      leads: 1,
      accounts: [{ credentialsEnc: "x", lastSyncCompletedAt: null, email: `crm${++n}@send.test` }],
    });
    await P().campaignLead.updateMany({
      where: { campaignId: s.campaign.id },
      data: { enrolledAt: at(-DAY) },
    });
    const lead = s.leads[0]!.lead;
    if (plValue !== undefined) await P().lead.update({ where: { id: lead.id }, data: { plValue } });
    const A = s.accounts[0]!;
    await getFakeProvider(A.email).receiveInbound({
      from: { email: lead.email },
      subject: "Re: Hi",
      text: "Tell me more.",
    });
    const deps = {
      providerFor: async (a: { email: string }) => getFakeProvider(a.email),
      env: { SYNC_POLL_SEC: 120, SYNC_MAX_STALENESS_SEC: 300 },
    };
    const sync = () => reconcileAccount(P(), clock, A.id, deps);
    return { ...s, A, lead, sync };
  }
  const synced0 = async (ws: string, accountId: string, leadId: string) => {
    expect(await P().message.count({ where: { accountId, direction: "IN" } })).toBe(1);
    expect(await events(ws, "REPLY")).toHaveLength(1);
    expect(await P().campaignLead.findFirst({ where: { leadId } })).toMatchObject({
      state: "STOPPED",
      stopReason: "REPLIED",
    });
    expect(await P().emailAccount.findUniqueOrThrow({ where: { id: accountId } })).toMatchObject({
      lastSyncCompletedAt: T,
      syncErrors: 0,
    });
  };

  test("1: a plValue over the column range gives a deal worth 0", async () => {
    const s = await synced(1e13);
    expect(await s.sync()).toBe("caught_up");
    await synced0(s.ws, s.A.id, s.lead.id);
    const [d] = await deals(s.ws);
    expect(d!.value.toFixed(2)).toBe("0.00");
    await expect(updateLead(P(), clock, s.ws, s.lead.id, { plValue: 1e13 })).rejects.toThrow(
      /too_big|Too big/,
    );
  });

  test("2: a concurrent stage delete", async () => {
    const w = await world();
    const e = await enrol(w);
    // the delete of Interested is in flight (row locked FOR UPDATE, not committed) when the hook reads it
    const h = await hold((tx) => tx.pipelineStage.delete({ where: { id: w.st("Interested") } }));
    const ingest = receive(w.accounts[0]!, threaded(e.lead, e.rfc));
    await h.release();
    expect(await ingest).toBe(1); // one attempt: no retry loop
    expect(await P().message.count({ where: { workspaceId: w.ws } })).toBe(1);
    expect(await events(w.ws, "REPLY")).toHaveLength(1);
    expect(await deals(w.ws)).toEqual([]); // the stage is gone: the step is skipped
    expect(await audits(w.ws, "crm.hook_failed")).toEqual([]);
  });

  test("3: a concurrent manual create for the same lead and campaign", async () => {
    const w = await world();
    const e = await enrol(w);
    // the POST's insert is in flight when the hook inserts: ON CONFLICT DO NOTHING waits, skips, re-reads
    const h = await hold((tx) =>
      tx.opportunity.create({
        data: {
          workspaceId: w.ws,
          leadId: e.lead.id,
          campaignId: w.campaign.id,
          stageId: w.st("Not Contacted"),
          title: "t",
        },
      }),
    );
    const ingest = receive(w.accounts[0]!, threaded(e.lead, e.rfc));
    await h.release();
    expect(await ingest).toBe(1);
    expect(await deals(w.ws)).toMatchObject([{ stageId: w.st("Interested") }]);
    expect(await P().message.count({ where: { workspaceId: w.ws } })).toBe(1);
    expect(await audits(w.ws, "crm.hook_failed")).toEqual([]);
  });

  test("4: an error in the CRM step rolls back to the savepoint and is audited", async () => {
    const s = await synced();
    await P().$executeRawUnsafe(
      `CREATE FUNCTION crm_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$`,
    );
    await P().$executeRawUnsafe(
      `CREATE TRIGGER crm_boom BEFORE INSERT ON "Opportunity" FOR EACH ROW EXECUTE FUNCTION crm_boom()`,
    );
    try {
      expect(await s.sync()).toBe("caught_up");
    } finally {
      await P().$executeRawUnsafe(`DROP TRIGGER crm_boom ON "Opportunity"`);
      await P().$executeRawUnsafe(`DROP FUNCTION crm_boom()`);
    }
    await synced0(s.ws, s.A.id, s.lead.id);
    expect(await deals(s.ws)).toEqual([]);
    expect(await events(s.ws, "OPPORTUNITY")).toEqual([]);
    const f = await audits(s.ws, "crm.hook_failed");
    expect(f).toHaveLength(1);
    expect(f[0]!.meta).toMatchObject({ leadId: s.lead.id, code: expect.any(String) });
    expect((await P().lead.findUniqueOrThrow({ where: { id: s.lead.id } })).interestStatus).toBe(1);
  });

  test("5: a losing D26 twin never runs the step", async () => {
    const w = await world();
    const e = await enrol(w);
    const x = threaded(e.lead, e.rfc, { to: w.accounts.map((a) => ({ email: a.email })) });
    await receive(w.accounts[0]!, x);
    await P().opportunity.deleteMany({ where: { workspaceId: w.ws } });
    await receive(w.accounts[1]!, { ...x, providerMessageId: "other" });
    expect(await P().message.count({ where: { workspaceId: w.ws } })).toBe(2);
    expect(await deals(w.ws)).toEqual([]);
    expect(await events(w.ws, "OPPORTUNITY")).toHaveLength(1);
  });
});

describe("one opportunity under races", () => {
  test("the same reply in two mailboxes at once", async () => {
    const w = await world();
    const e = await enrol(w);
    const x = threaded(e.lead, e.rfc, { to: w.accounts.map((a) => ({ email: a.email })) });
    await Promise.all([
      receive(w.accounts[0]!, x),
      receive(w.accounts[1]!, { ...x, providerMessageId: "other" }),
    ]);
    expect(await deals(w.ws)).toHaveLength(1);
    expect(await events(w.ws, "OPPORTUNITY")).toHaveLength(1);
  });

  test("two status changes at once", async () => {
    const w = await world();
    const lead = await newLead(w.ws);
    await accepted(w, lead.id);
    await Promise.all([
      updateLead(P(), clock, w.ws, lead.id, { interestStatus: 2 }),
      updateLead(P(), clock, w.ws, lead.id, { interestStatus: 2 }),
    ]);
    expect(await events(w.ws, "MEETING")).toHaveLength(1);
    expect(await deals(w.ws)).toHaveLength(1);

    const bare = await newLead(w.ws);
    await Promise.all([
      updateLead(P(), clock, w.ws, bare.id, { interestStatus: 1 }),
      updateLead(P(), clock, w.ws, bare.id, { interestStatus: 1 }),
    ]);
    expect(await P().opportunity.findMany({ where: { leadId: bare.id } })).toMatchObject([
      { campaignId: null, stageId: w.st("Interested") },
    ]);
  });
});

describe("deal lifecycle", () => {
  test("reopen and merge", async () => {
    const w = await world();
    const lead = await newLead(w.ws);
    const d = await createOpportunity(P(), clock, w.ws, null, {
      leadId: lead.id,
      campaignId: w.campaign.id,
      value: 500,
    });
    await updateOpportunity(P(), clock, w.ws, null, d.id, { stageId: w.st("Closed Won") });
    await updateOpportunity(P(), fixedClock(at(1000)), w.ws, null, d.id, {
      stageId: w.st("Negotiation"),
    });
    expect((await P().opportunity.findUniqueOrThrow({ where: { id: d.id } })).closedAt).toBeNull();
    await updateOpportunity(P(), fixedClock(at(2000)), w.ws, null, d.id, {
      stageId: w.st("Closed Won"),
    });
    expect(await P().opportunity.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({
      closedAt: at(2000),
    });
    const won = await events(w.ws, "DEAL_WON");
    expect(won).toHaveLength(2);
    expect(new Set(won.map((e) => e.dedupeKey)).size).toBe(2);
    expect(await deals(w.ws)).toHaveLength(1);

    const u = await updateOpportunity(P(), clock, w.ws, null, d.id, { cashCollected: 450.5 });
    expect(u.cashCollected).toBe("450.50");
    const [a] = await audits(w.ws, "opportunity.update");
    expect(a!.meta).toEqual({ leadId: lead.id, value: "500.00", cashCollected: "450.50" });

    // merge: both leads have a deal in C → 409 and nothing changes
    const other = await newLead(w.ws);
    await createOpportunity(P(), clock, w.ws, null, {
      leadId: other.id,
      campaignId: w.campaign.id,
    });
    expect(await err(mergeLeads(P(), clock, w.ws, { keepId: lead.id, mergeId: other.id }))).toEqual(
      {
        status: 409,
        message: "opportunity_conflict",
        body: { campaignId: w.campaign.id },
      },
    );
    expect((await P().lead.findUniqueOrThrow({ where: { id: other.id } })).deletedAt).toBeNull();
    // no clash: the deal follows the kept lead
    const third = await newLead(w.ws);
    const d3 = await createOpportunity(P(), clock, w.ws, null, { leadId: third.id });
    await mergeLeads(P(), clock, w.ws, { keepId: lead.id, mergeId: third.id });
    expect((await P().opportunity.findUniqueOrThrow({ where: { id: d3.id } })).leadId).toBe(
      lead.id,
    );

    // currency is fixed while a deal carries money
    expect(
      await err(updateWorkspaceSettings(P(), clock, w.ws, null, { currency: "EUR" })),
    ).toMatchObject({
      status: 409,
      message: "currency_in_use",
    });
    // GDPR erasure removes the lead's deals
    await gdprDeleteLead(P(), clock, w.ws, lead.id);
    expect(await P().opportunity.count({ where: { leadId: lead.id } })).toBe(0);
    await deleteOpportunity(P(), w.ws, null, (await deals(w.ws))[0]!.id);
    expect(
      await updateWorkspaceSettings(P(), clock, w.ws, null, { currency: "EUR" }),
    ).toMatchObject({
      currency: "EUR",
    });
  });

  test("a deal created during a merge never stays on the merged-away lead", async () => {
    const w = await world();
    const keep = await newLead(w.ws);
    const gone = await newLead(w.ws);
    // the merge holds both Lead rows FOR UPDATE and soft-deletes the merged lead
    const h = await hold(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Lead" WHERE id = ANY(${[keep.id, gone.id]}) ORDER BY id FOR UPDATE`;
      await tx.lead.update({
        where: { id: gone.id },
        data: { deletedAt: T, mergedIntoId: keep.id },
      });
    });
    const post = err(createOpportunity(P(), clock, w.ws, null, { leadId: gone.id }));
    await h.release();
    expect(await post).toMatchObject({ status: 404 });
    expect(await P().opportunity.count({ where: { leadId: gone.id } })).toBe(0);
  });

  test("currency_in_use holds against a deal created meanwhile", async () => {
    const w = await world();
    const l = await newLead(w.ws);
    const h = await hold((tx) =>
      tx.opportunity.create({
        data: { workspaceId: w.ws, leadId: l.id, stageId: w.st("Replied"), title: "t", value: 100 },
      }),
    );
    const change = err(updateWorkspaceSettings(P(), clock, w.ws, null, { currency: "EUR" }));
    await h.release();
    expect(await change).toMatchObject({ status: 409, message: "currency_in_use" });
    expect((await P().workspace.findUniqueOrThrow({ where: { id: w.ws } })).currency).toBe("USD");
  });
});

describe("currency race on a deal edited from 0 (D51)", () => {
  test("a value edit waits for an in-flight currency change, so a valued deal never sits in a changed currency", async () => {
    const w = await world();
    const l = await newLead(w.ws);
    const deal = await createOpportunity(P(), clock, w.ws, null, { leadId: l.id });
    // the currency tx, mid-flight: it has locked the workspace and counted no money yet
    const h = await hold(
      (tx) => tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${w.ws} FOR UPDATE`,
    );
    let edited = false;
    const edit = updateOpportunity(P(), clock, w.ws, null, deal.id, { value: 100 }).then(
      () => (edited = true),
    );
    await new Promise((r) => setTimeout(r, 500));
    expect(edited).toBe(false);
    await h.release();
    await edit;
    expect(
      (await P().opportunity.findUniqueOrThrow({ where: { id: deal.id } })).value.toString(),
    ).toBe("100");
  });
});

describe("filters", () => {
  test("list, board and bulk", async () => {
    const w = await world();
    const d2c = await seedCampaign(P(), { at: T, workspaceId: w.ws, useAccounts: w.accounts });
    const owner = await member(w.ws);
    const list = await P().leadList.create({ data: { workspaceId: w.ws, name: "L" } });
    const a = await newLead(w.ws, { email: "a@acme.io" });
    const b = await newLead(w.ws, { email: "b@other.com", companyDomain: "acme.io" });
    const c = await newLead(w.ws, { email: "c@zzz.com" });
    await P().leadListMember.create({ data: { listId: list.id, leadId: a.id } });
    const da = await createOpportunity(P(), clock, w.ws, null, {
      leadId: a.id,
      campaignId: w.campaign.id,
      stageId: w.st("Interested"),
      ownerId: owner,
      value: 1000,
    });
    const db2 = await createOpportunity(P(), clock, w.ws, null, {
      leadId: b.id,
      campaignId: d2c.campaign.id,
      stageId: w.st("Interested"),
      value: 250,
    });
    const dc = await createOpportunity(P(), clock, w.ws, null, {
      leadId: c.id,
      stageId: w.st("Closed Won"),
    });
    await P().opportunity.update({ where: { id: dc.id }, data: { createdAt: at(-10 * DAY) } });
    const ids = async (q: Record<string, unknown>) =>
      (await listOpportunities(P(), w.ws, q)).opportunities.map((o) => o.id).sort();
    expect(await ids({ campaignId: w.campaign.id })).toEqual([da.id]);
    expect(await ids({ listId: list.id })).toEqual([da.id]);
    expect(await ids({ ownerId: owner })).toEqual([da.id]);
    expect(await ids({ stageId: w.st("Closed Won") })).toEqual([dc.id]);
    expect(
      await ids({ from: at(-11 * DAY).toISOString(), to: at(-9 * DAY).toISOString() }),
    ).toEqual([dc.id]);
    expect(await ids({ q: "acme.io" })).toEqual([da.id, db2.id].sort());
    const page = await listOpportunities(P(), w.ws, { take: 2 });
    expect(page.opportunities).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    expect(page.opportunities[0]).toMatchObject({
      lead: { id: expect.any(String), email: expect.any(String) },
      value: expect.stringMatching(/^\d+\.\d\d$/),
    });
    await expect(listOpportunities(P(), w.ws, { take: 201 })).rejects.toThrow();

    const board = await pipelineBoard(P(), w.ws, {});
    expect(board.currency).toBe("USD");
    const col = board.stages.find((s) => s.id === w.st("Interested"))!;
    expect(col).toMatchObject({ count: 2, value: "1250.00", more: false });
    expect(col.opportunities.map((o) => o.campaign?.id).sort()).toEqual(
      [w.campaign.id, d2c.campaign.id].sort(),
    );
    // a stage filter: only that column has cards, and every column's cards match its count
    const one = await pipelineBoard(P(), w.ws, { stageId: w.st("Closed Won") });
    for (const s of one.stages) expect(s.opportunities).toHaveLength(s.count);
    expect(one.stages.find((s) => s.id === w.st("Closed Won"))!.count).toBe(1);
    expect(one.stages.find((s) => s.id === w.st("Interested"))!.opportunities).toEqual([]);
    await softDeleteLead(P(), clock, w.ws, b.id);
    const col2 = (await pipelineBoard(P(), w.ws, {})).stages.find(
      (s) => s.id === w.st("Interested"),
    )!;
    expect(col2).toMatchObject({ count: 1, value: "1000.00" });

    // bulk set_interest on 200 leads: one batch, within the bulk transaction's budget
    const many = await P().lead.createManyAndReturn({
      data: Array.from({ length: 200 }, (_, i) => ({
        workspaceId: w.ws,
        email: `bulk${i}@b${n}.test`,
      })),
    });
    const t0 = Date.now();
    await bulkLeads(P(), clock, w.ws, {
      ids: many.map((l) => l.id),
      action: "set_interest",
      value: 1,
    });
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(15_000); // half the bulk transaction's timeout
    expect(await P().opportunity.count({ where: { leadId: { in: many.map((l) => l.id) } } })).toBe(
      200,
    );
    expect(await P().event.count({ where: { workspaceId: w.ws, type: "INTEREST_CHANGED" } })).toBe(
      200,
    );
  });
});
