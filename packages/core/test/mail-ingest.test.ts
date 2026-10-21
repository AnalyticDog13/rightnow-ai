import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDb } from "@rightnow/db/test-db";
import { buildMime, getFakeProvider, newMessageId, type RemoteMessage } from "@rightnow/providers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { fixedClock } from "../src/clock";
import { gdprDeleteLead, mergeLeads } from "../src/leads/service";
import { classify } from "../src/mail/classify";
import { recordEvent } from "../src/mail/events";
import { ingestMessage, recordOutboundMessage } from "../src/mail/ingest";
import { listThreads } from "../src/mail/inbox";
import { normalizeSubject } from "../src/mail/match";
import { seedCampaign } from "./campaign-fixture";

process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "mail-ingest-"));

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

const T = new Date("2026-10-20T10:00:00Z");
let n = 0;
const msg = (o: Partial<RemoteMessage> = {}): RemoteMessage => ({
  providerMessageId: `p${++n}`,
  rfcMessageId: `<m${n}@x.test>`,
  folder: "INBOX",
  inReplyTo: null,
  references: [],
  from: { email: "nobody@x.test" },
  to: [],
  cc: [],
  subject: "Hello",
  date: new Date(T.getTime() + n * 1000),
  text: "body",
  html: null,
  headers: {},
  attachments: [],
  ...o,
});
const ingest = (
  a: { id: string; workspaceId: string; email: string },
  m: RemoteMessage,
  o: { historical?: boolean } = {},
) =>
  P().$transaction((tx) =>
    ingestMessage(
      tx,
      a,
      m,
      classify(m, { now: T, direction: m.from.email === a.email ? "OUT" : "IN" }),
      { historical: o.historical ?? false },
    ),
  );

/** A campaign with one lead whose step-1 row is SENT from the first account. */
async function sent(o: { subject?: string; rfc?: string } = {}) {
  const s = await seedCampaign(P(), { at: T, rows: 1, steps: 2, accounts: [{}] });
  const rfc = o.rfc ?? newMessageId("send.test");
  const row = await P().scheduledMessage.update({
    where: { id: s.rows[0]!.id },
    data: {
      status: "SENT",
      sentAt: T,
      rfcMessageId: rfc,
      renderedSubject: o.subject ?? "Quick question",
    },
  });
  return { ...s, a: s.accounts[0]!, lead: s.leads[0]!.lead, cl: s.leads[0]!.cl, row, rfc };
}

describe("matching and threading", () => {
  test("reply threads to the campaign send", async () => {
    const s = await sent();
    const r = await ingest(
      s.a,
      msg({ from: { email: s.lead.email }, to: [{ email: s.a.email }], inReplyTo: s.rfc }),
    );
    expect(r.created).toBe(true);
    expect(r.match).toMatchObject({
      leadId: s.lead.id,
      campaignId: s.campaign.id,
      campaignLeadId: s.cl.id,
      scheduledMessageId: s.row.id,
    });
    const threads = await P().thread.findMany({ where: { workspaceId: s.ws } });
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      id: r.threadId,
      leadId: s.lead.id,
      campaignId: s.campaign.id,
      campaignLeadId: s.cl.id,
      isRead: false,
      lastInboundKind: "REPLY",
    });
    expect(await P().message.findUniqueOrThrow({ where: { id: r.messageId } })).toMatchObject({
      direction: "IN",
      kind: "REPLY",
      leadId: s.lead.id,
      campaignId: s.campaign.id,
    });
  });

  test("a later reply joins the thread through the stored message", async () => {
    const s = await sent();
    const first = msg({ from: { email: s.lead.email }, inReplyTo: s.rfc });
    const r1 = await ingest(s.a, first);
    const r2 = await ingest(
      s.a,
      msg({ from: { email: s.lead.email }, inReplyTo: first.rfcMessageId }),
    );
    expect(r2.threadId).toBe(r1.threadId);
    expect(await P().thread.count({ where: { workspaceId: s.ws } })).toBe(1);
  });

  test("a thread of another mailbox is never joined; lead and campaign carry over", async () => {
    const s = await sent();
    const other = await P().emailAccount.create({
      data: {
        workspaceId: s.ws,
        provider: "SMTP",
        email: `o-${n}@send.test`,
        fromName: "O",
        firstName: "O",
        lastName: "O",
        capTier: "SMTP",
        providerCap: 100,
      },
    });
    const first = msg({ from: { email: s.lead.email }, inReplyTo: s.rfc });
    const r1 = await ingest(s.a, first);
    const r2 = await ingest(
      other,
      msg({ from: { email: s.lead.email }, inReplyTo: first.rfcMessageId }),
    );
    expect(r2.threadId).not.toBe(r1.threadId);
    expect(r2.match).toMatchObject({ leadId: s.lead.id, campaignId: s.campaign.id });
  });

  test("reply without In-Reply-To falls back to lead + subject", async () => {
    const s = await sent({ subject: "Quick question" });
    const hit = await ingest(
      s.a,
      msg({ from: { email: s.lead.email }, subject: "Re: RE: Quick question" }),
    );
    expect(hit.match).toMatchObject({ leadId: s.lead.id, scheduledMessageId: s.row.id });
    const miss = await ingest(
      s.a,
      msg({ from: { email: s.lead.email }, subject: "Something else" }),
    );
    expect(miss.match).toMatchObject({
      leadId: s.lead.id,
      campaignId: s.campaign.id,
      scheduledMessageId: null,
    });
    expect(miss.threadId).not.toBeNull();
    expect(new Set([hit.threadId, miss.threadId]).size).toBe(2);
  });

  test("a stranger's message has no lead", async () => {
    const s = await sent();
    const r = await ingest(s.a, msg({ from: { email: "stranger@x.test" } }));
    expect(r.match).toMatchObject({ leadId: null, campaignId: null, scheduledMessageId: null });
  });

  test("normalizeSubject", () => {
    expect(normalizeSubject(" Re: RE: Fwd: AW: Hi There ")).toBe("hi there");
  });
});

describe("ingest", () => {
  test("same message twice is one row", async () => {
    const s = await sent();
    const m = msg({ from: { email: s.lead.email }, providerMessageId: "p1" });
    const a = await ingest(s.a, m);
    const b = await ingest(s.a, { ...m, providerMessageId: "p2" });
    expect(b).toMatchObject({ created: false, messageId: a.messageId, threadId: a.threadId });
    const rows = await P().message.findMany({ where: { accountId: s.a.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.providerMessageId).toBe("p2");
    expect(await P().thread.count({ where: { workspaceId: s.ws } })).toBe(1);
  });

  test("missing Message-ID gets a stable synthetic id", async () => {
    const s = await sent();
    const m = msg({ from: { email: s.lead.email }, rfcMessageId: null });
    await ingest(s.a, m);
    await ingest(s.a, { ...m, providerMessageId: "again" });
    const rows = await P().message.findMany({ where: { accountId: s.a.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.synthetic).toBe(true);
    expect(rows[0]!.rfcMessageId).toMatch(/^<[0-9a-f]{64}@rightnow\.synthetic>$/);
  });

  test("outside-app send is recorded", async () => {
    const s = await sent();
    const when = new Date(T.getTime() + 3_600_000);
    const r = await ingest(
      s.a,
      msg({
        folder: "SENT",
        from: { email: s.a.email },
        to: [{ email: s.lead.email }],
        subject: "Manual note",
        date: when,
      }),
    );
    const m = await P().message.findUniqueOrThrow({ where: { id: r.messageId } });
    expect(m).toMatchObject({ direction: "OUT", outsideApp: true, scheduledMessageId: null });
    expect(
      (await P().lead.findUniqueOrThrow({ where: { id: s.lead.id } })).lastContactedAt,
    ).toEqual(when);
    expect(await P().thread.findUniqueOrThrow({ where: { id: r.threadId } })).toMatchObject({
      isRead: true,
      lastInboundAt: null,
    });
  });

  test("deleted thread revives on new inbound", async () => {
    const s = await sent();
    const first = msg({ from: { email: s.lead.email }, inReplyTo: s.rfc });
    const r1 = await ingest(s.a, first);
    await P().thread.update({ where: { id: r1.threadId }, data: { deletedAt: T, isRead: true } });
    await ingest(s.a, msg({ from: { email: s.lead.email }, inReplyTo: first.rfcMessageId }));
    expect(await P().thread.findUniqueOrThrow({ where: { id: r1.threadId } })).toMatchObject({
      deletedAt: null,
      isRead: false,
    });
  });

  test("historical import is read and never rewinds a newer message", async () => {
    const s = await sent();
    const newer = msg({ from: { email: s.lead.email }, inReplyTo: s.rfc });
    const r = await ingest(s.a, newer);
    await ingest(
      s.a,
      msg({
        from: { email: s.lead.email },
        inReplyTo: s.rfc,
        date: new Date(T.getTime() - 86_400_000),
      }),
      { historical: true },
    );
    const t = await P().thread.findUniqueOrThrow({ where: { id: r.threadId } });
    expect(t.isRead).toBe(false);
    expect(t.lastInboundAt).toEqual(newer.date);
  });

  test("attachment data is never listed", async () => {
    const s = await sent();
    const big = Buffer.alloc(3 * 1024 * 1024, 7);
    const r = await ingest(
      s.a,
      msg({
        from: { email: s.lead.email },
        attachments: [
          {
            filename: "a.bin",
            contentType: "application/octet-stream",
            size: big.length,
            content: big,
          },
        ],
      }),
    );
    const stored = await P().attachment.findFirstOrThrow({ where: { messageId: r.messageId } });
    expect(stored.data?.length).toBe(big.length);
    const threads = await listThreads(P(), s.ws);
    const att = threads[0]!.messages[0]!.attachments;
    expect(att).toHaveLength(1);
    expect(att[0]).toMatchObject({ filename: "a.bin", size: big.length, truncated: false });
    expect("data" in att[0]!).toBe(false);
    expect(threads[0]!.hasAttachment).toBe(true);
  });

  test("an oversized attachment keeps metadata only", async () => {
    const s = await sent();
    const r = await ingest(
      s.a,
      msg({
        from: { email: s.lead.email },
        attachments: [
          { filename: "huge", contentType: "x/y", size: 30e6, content: null, truncated: true },
        ],
      }),
    );
    expect(
      await P().attachment.findFirstOrThrow({ where: { messageId: r.messageId } }),
    ).toMatchObject({
      data: null,
      truncated: true,
    });
  });
});

describe("events", () => {
  test("recordEvent dedupes", async () => {
    const s = await sent();
    const e = {
      workspaceId: s.ws,
      type: "REPLY" as const,
      occurredAt: T,
      dedupeKey: `REPLY:${s.ws}:<dup@x>`,
    };
    expect(await P().$transaction((tx) => recordEvent(tx, e))).toBe(true);
    expect(await P().$transaction((tx) => recordEvent(tx, e))).toBe(false);
    expect(await P().event.count({ where: { dedupeKey: e.dedupeKey } })).toBe(1);
  });

  test("migration backfill gives a SENT row one ACCEPTED event", async () => {
    const s = await sent();
    const sql = readFileSync(
      fileURLToPath(
        new URL(
          "../../db/prisma/migrations/20261022000000_mail_inbox/migration.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    const backfill = sql.slice(sql.indexOf('INSERT INTO "Event"'));
    expect(await P().event.count({ where: { scheduledMessageId: s.row.id } })).toBe(0);
    await P().$executeRawUnsafe(backfill);
    await P().$executeRawUnsafe(backfill); // idempotent
    const ev = await P().event.findMany({ where: { scheduledMessageId: s.row.id } });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      type: "ACCEPTED",
      dedupeKey: `acc:${s.row.id}`,
      leadId: s.lead.id,
      campaignId: s.campaign.id,
      occurredAt: T,
    });
  });
});

describe("outbound messages", () => {
  test("recordOutboundMessage links the row, is idempotent, and a step-2 send joins the thread", async () => {
    const s = await sent();
    await recordOutboundMessage(P(), s.row.id);
    await recordOutboundMessage(P(), s.row.id);
    const out = await P().message.findMany({ where: { accountId: s.a.id } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      direction: "OUT",
      kind: "OUTBOUND",
      scheduledMessageId: s.row.id,
      outsideApp: false,
      leadId: s.lead.id,
    });
    const step2 = await P().scheduledMessage.create({
      data: {
        workspaceId: s.ws,
        campaignId: s.campaign.id,
        campaignLeadId: s.cl.id,
        stepId: s.steps[1]!.id,
        accountId: s.a.id,
        dueAt: T,
        idempotencyKey: `${s.cl.id}:${s.steps[1]!.id}`,
        renderedSubject: "Re: Quick question",
        renderedBody: "<p>Again</p>",
        renderedText: "Again",
        status: "SENT",
        sentAt: new Date(T.getTime() + 86_400_000),
        rfcMessageId: newMessageId("send.test"),
      },
    });
    await recordOutboundMessage(P(), step2.id);
    const all = await P().message.findMany({
      where: { accountId: s.a.id },
      orderBy: { sentAt: "asc" },
    });
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ scheduledMessageId: step2.id, inReplyTo: s.rfc });
    expect(all[1]!.threadId).toBe(all[0]!.threadId);
  });

  test("syncing the Fake's SENT copy links the row even when the outbound Message was deleted", async () => {
    const s = await sent({ rfc: newMessageId("send.test") });
    const raw = await buildMime({
      from: { email: s.a.email },
      to: [{ email: s.lead.email }],
      subject: "Quick question",
      text: "hello",
      messageId: s.rfc,
    });
    await getFakeProvider(s.a.email).receiveRaw(raw, "SENT");
    const cur = await getFakeProvider(s.a.email).listMessages({
      since: new Date(0),
      folder: "SENT",
    });
    const remote = cur.messages.find((x) => x.rfcMessageId === s.rfc)!;
    const r = await ingest(s.a, remote);
    expect(await P().message.findUniqueOrThrow({ where: { id: r.messageId } })).toMatchObject({
      direction: "OUT",
      scheduledMessageId: s.row.id,
      outsideApp: false,
    });
  });
});

describe("lead erasure and merge keep mail consistent (I11)", () => {
  test("gdprDeleteLead removes the lead's threads, messages, attachments and event links", async () => {
    const s = await sent();
    const keepLead = await P().lead.create({
      data: { workspaceId: s.ws, email: "keeper@other.test" },
    });
    const r = await ingest(
      s.a,
      msg({
        from: { email: s.lead.email },
        inReplyTo: s.rfc,
        attachments: [{ filename: "f", contentType: "x/y", size: 1, content: Buffer.from("x") }],
      }),
    );
    await ingest(s.a, msg({ from: { email: keepLead.email } }));
    await P().$transaction((tx) =>
      recordEvent(tx, {
        workspaceId: s.ws,
        type: "REPLY",
        occurredAt: T,
        leadId: s.lead.id,
        dedupeKey: `gdpr-${s.lead.id}`,
      }),
    );
    // gdprDeleteLead refuses while a send is in flight; the seeded row is SENT
    await gdprDeleteLead(P(), fixedClock(T), s.ws, s.lead.id);
    expect(await P().message.count({ where: { id: r.messageId } })).toBe(0);
    expect(await P().attachment.count({ where: { messageId: r.messageId } })).toBe(0);
    expect(await P().thread.count({ where: { id: r.threadId } })).toBe(0);
    expect(await P().message.count({ where: { fromEmail: s.lead.email } })).toBe(0);
    expect(await P().message.count({ where: { fromEmail: keepLead.email } })).toBe(1);
    expect(
      await P().event.findUniqueOrThrow({ where: { dedupeKey: `gdpr-${s.lead.id}` } }),
    ).toMatchObject({ leadId: null });
  });

  test("mergeLeads re-points threads, messages and events", async () => {
    const s = await sent();
    const keep = await P().lead.create({ data: { workspaceId: s.ws, email: "keep@merge.test" } });
    const r = await ingest(s.a, msg({ from: { email: s.lead.email }, inReplyTo: s.rfc }));
    await P().$transaction((tx) =>
      recordEvent(tx, {
        workspaceId: s.ws,
        type: "REPLY",
        occurredAt: T,
        leadId: s.lead.id,
        dedupeKey: `merge-${s.lead.id}`,
      }),
    );
    await mergeLeads(P(), fixedClock(T), s.ws, { keepId: keep.id, mergeId: s.lead.id });
    expect((await P().thread.findUniqueOrThrow({ where: { id: r.threadId } })).leadId).toBe(
      keep.id,
    );
    expect((await P().message.findUniqueOrThrow({ where: { id: r.messageId } })).leadId).toBe(
      keep.id,
    );
    expect(
      (await P().event.findUniqueOrThrow({ where: { dedupeKey: `merge-${s.lead.id}` } })).leadId,
    ).toBe(keep.id);
  });
});
