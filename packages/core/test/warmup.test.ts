import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmailAccount, WarmupSettings } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import { buildMime, getFakeProvider, newMessageId } from "@rightnow/providers";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { fixedClock } from "../src/clock";
import { updateWarmup } from "../src/deliverability/warmup-settings";
import { healthInputs } from "../src/deliverability/health";
import {
  warmupState,
  warmupStats,
  warmupTarget,
  warmupTick,
  warmupView,
} from "../src/deliverability/warmup";
import { reconcileAccount, type SyncDeps } from "../src/mail/sync";
import { seedCampaign } from "./campaign-fixture";

process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "warmup-"));

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

const fake = (a: { email: string }) => getFakeProvider(a.email);
const providerFor = async (a: EmailAccount) => fake(a);
const FAKE = { MAIL_PROVIDER_FAKE: "1" as const };
const MIN = 60_000;
const DAY = 86_400_000;
const TUE_8 = new Date("2026-10-20T08:00:00Z"); // a Tuesday
const syncDeps: SyncDeps = {
  providerFor,
  env: { SYNC_POLL_SEC: 120, SYNC_MAX_STALENESS_SEC: 300 },
};

let n = 0;
/** A workspace with an ACTIVE campaign (one lead) and `count` connected, warm-up-enabled mailboxes on different domains. */
async function world(
  count: number,
  o: {
    settings?: Omit<Partial<WarmupSettings>, "customCurve">[];
    domains?: string[];
    at?: Date;
    random?: () => number;
  } = {},
) {
  const tag = `${++n}`;
  const s = await seedCampaign(P(), {
    at: TUE_8,
    leads: 1,
    steps: 1,
    campaign: { stopOnAutoReply: true },
    accounts: Array.from({ length: count }, (_, i) => ({
      email: `w${i}-${tag}@${o.domains?.[i] ?? `d${i}-${tag}.test`}`,
      credentialsEnc: "x",
      providerCap: 500,
      lastSyncCompletedAt: null,
    })),
  });
  const accts = s.accounts as EmailAccount[];
  for (const [i, a] of accts.entries()) {
    await fake(a).enableDelivery();
    await P().warmupSettings.create({
      data: {
        accountId: a.id,
        workspaceId: s.ws,
        enabled: true,
        slowWarmup: false,
        dailyLimit: 10,
        replyRatePct: 0,
        filterTag: `rn-${tag}${i}ab`,
        startedAt: TUE_8,
        ...o.settings?.[i],
      },
    });
  }
  const clock = fixedClock(o.at ?? TUE_8);
  const tick = () => warmupTick(P(), clock, { providerFor, env: FAKE });
  const sync = async (...who: EmailAccount[]) => {
    for (const a of who)
      await reconcileAccount(P(), clock, a.id, { ...syncDeps, random: o.random });
  };
  await sync(...accts); // cursors first: later mail arrives as changes
  return {
    ...s,
    accts,
    clock,
    tick,
    sync,
    lead: s.leads[0]!,
    A: accts[0]!,
    B: accts[1]!,
    C: accts[2]!,
  };
}
const rows = (where: object) =>
  P().warmupMessage.findMany({ where, orderBy: { createdAt: "asc" } });
const set = (accountId: string) => P().warmupSettings.findUniqueOrThrow({ where: { accountId } });

type Args = { data?: { fromAccountId?: string }; where?: { toAccountId?: unknown } };
/** The test DB's client with one `warmupMessage` method replaced (`f` gets the real method). */
const hooked = (
  method: "create" | "count",
  f: (real: (a: Args) => Promise<unknown>, a: Args) => Promise<unknown>,
) => {
  const real = P();
  const m = real.warmupMessage as unknown as Record<string, (a: Args) => Promise<unknown>>;
  const wrapped = new Proxy(m, {
    get: (t, k) => (k === method ? (a: Args) => f(t[k]!.bind(t), a) : Reflect.get(t, k)),
  });
  return new Proxy(real, {
    get: (t, k) => {
      if (k === "warmupMessage") return wrapped;
      const v = Reflect.get(t, k);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
};

const base = (o: Partial<WarmupSettings> = {}) =>
  ({
    dailyLimit: 10,
    slowWarmup: true,
    startVolume: 1,
    increasePerDay: 1,
    customCurve: null,
    weekdaysOnly: false,
    startedAt: new Date("2026-10-01T00:00:00Z"),
    ...o,
  }) as WarmupSettings;
const acct = (o: Partial<EmailAccount> = {}) =>
  ({ providerCap: 500, timezone: "UTC", ...o }) as EmailAccount;
const day = (d: number) => new Date(Date.parse("2026-10-01T10:00:00Z") + d * DAY);

describe("warmupTarget", () => {
  test("slow curve, dailyLimit, custom curve, weekends, provider cap", () => {
    expect(warmupTarget(base(), acct(), day(0))).toBe(1);
    expect(warmupTarget(base(), acct(), day(5))).toBe(6);
    expect(warmupTarget(base(), acct(), day(20))).toBe(10);
    expect(warmupTarget(base({ slowWarmup: false }), acct(), day(0))).toBe(10);
    const customCurve = [
      { day: 0, volume: 2 },
      { day: 3, volume: 8 },
    ];
    expect(warmupTarget(base({ customCurve }), acct(), day(1))).toBe(2);
    expect(warmupTarget(base({ customCurve }), acct(), day(4))).toBe(8);
    expect(warmupTarget(base({ customCurve }), acct(), day(30))).toBe(8);
    // 2026-10-03 is a Saturday, 2026-10-02 a Friday
    expect(warmupTarget(base({ weekdaysOnly: true, slowWarmup: false }), acct(), day(2))).toBe(0);
    expect(warmupTarget(base({ weekdaysOnly: true, slowWarmup: false }), acct(), day(1))).toBe(10);
    // warm-up plus campaign mail stays within 60 % of the provider cap
    expect(
      warmupTarget(base({ dailyLimit: 30, slowWarmup: false }), acct({ providerCap: 100 }), day(0)),
    ).toBe(10);
    expect(
      warmupTarget(
        base({ dailyLimit: 50, slowWarmup: false }),
        acct({ providerCap: 5000 }),
        day(0),
      ),
    ).toBe(50);
  });
});

describe("warmupTick", () => {
  test("sends inside the window, spaced, never catching up", async () => {
    const w = await world(3, { domains: ["x.test", "x.test", "y.test"] });
    const { A, B, C } = w;
    w.clock.advance(-MIN); // 07:59
    expect(await w.tick()).toMatchObject({ sent: 0 });
    expect(await rows({ workspaceId: w.ws })).toHaveLength(0);

    w.clock.advance(MIN); // 08:00
    expect(await w.tick()).toMatchObject({ sent: 3 });
    const a1 = await rows({ fromAccountId: A.id });
    expect(a1).toHaveLength(1);
    expect(a1[0]).toMatchObject({ toAccountId: C.id, kind: "SEND", status: "SENT" }); // the other domain
    expect((await rows({ fromAccountId: B.id }))[0]!.toAccountId).toBe(C.id);
    expect((await set(A.id)).nextAt!.getTime() - w.clock.now().getTime()).toBeGreaterThanOrEqual(
      600_000,
    );
    expect(
      (await P().emailAccount.findUniqueOrThrow({ where: { id: A.id } })).lastWarmupAt,
    ).toEqual(w.clock.now());

    w.clock.advance(5 * MIN); // 600 s spacing
    expect((await w.tick()).sent).toBe(0);

    // the machine was off: 19:55 with 9 left. One more at most, then the window is over
    w.clock.advance(11 * 60 * MIN + 50 * MIN);
    expect((await w.tick()).sent).toBe(3);
    expect((await set(A.id)).nextAt!.getTime() - w.clock.now().getTime()).toBe(600_000);
    w.clock.advance(10 * MIN);
    expect((await w.tick()).sent).toBe(0);
    expect(await rows({ fromAccountId: A.id })).toHaveLength(2);

    // next day: the target is the plain target, the missed ones are not added
    w.clock.advance(12 * 60 * MIN); // Wednesday 08:05
    expect((await w.tick()).sent).toBe(3);
    expect(await rows({ fromAccountId: A.id })).toHaveLength(3);
  });

  test("warm-up never reaches the inbox, campaigns, stop rules or counters", async () => {
    const w = await world(2, { settings: [{ replyRatePct: 100 }, { replyRatePct: 100 }] });
    const { A, B } = w;
    await P().lead.update({ where: { id: w.lead.lead.id }, data: { email: B.email } });
    await w.tick();
    await w.sync(A, B);
    w.clock.advance(30 * MIN);
    expect((await w.tick()).replied).toBe(2);
    await w.sync(A, B);

    expect(await P().thread.count({ where: { workspaceId: w.ws } })).toBe(0);
    expect(await P().message.count({ where: { workspaceId: w.ws } })).toBe(0);
    expect(await P().event.count({ where: { workspaceId: w.ws } })).toBe(0);
    expect(await P().lead.findUniqueOrThrow({ where: { id: w.lead.lead.id } })).toMatchObject({
      replies: 0,
    });
    expect(await P().campaignLead.findUniqueOrThrow({ where: { id: w.lead.cl.id } })).toMatchObject(
      {
        state: "ACTIVE",
      },
    );
    for (const r of await rows({ kind: "SEND", workspaceId: w.ws })) {
      expect(r.receivedAt).not.toBeNull();
      expect(r.landedFolder).toBe("INBOX");
    }
    // a reply never gets a reply
    expect(await rows({ kind: "REPLY", workspaceId: w.ws })).toHaveLength(2);

    // a stranger carrying the header is an ordinary message: no header is trusted
    const raw = await buildMime({
      from: { email: "stranger@elsewhere.test" },
      to: [{ email: A.email }],
      subject: "Hello",
      text: "Hello there",
      messageId: newMessageId("elsewhere.test"),
      headers: { "X-RightNow-Warmup": "1" },
    });
    await fake(A).receiveRaw(raw);
    await w.sync(A);
    expect(await P().message.count({ where: { accountId: A.id, direction: "IN" } })).toBe(1);
  });

  test("I1a: an auto-reply to a warm-up message from a peer that is a lead stops nothing", async () => {
    const w = await world(2);
    const { A, B } = w;
    await P().lead.update({ where: { id: w.lead.lead.id }, data: { email: B.email } });
    await w.tick();
    const sent = (await rows({ fromAccountId: A.id }))[0]!;
    const raw = await buildMime({
      from: { email: B.email },
      to: [{ email: A.email }],
      subject: `Automatic reply: ${sent.subject}`,
      text: "I am out of the office until Monday.",
      messageId: newMessageId("b.test"),
      inReplyTo: sent.rfcMessageId,
      references: [sent.rfcMessageId],
      headers: { "Auto-Submitted": "auto-replied" },
    });
    await fake(A).receiveRaw(raw);
    await w.sync(A, B);
    expect(await P().thread.count({ where: { workspaceId: w.ws } })).toBe(0);
    expect(await P().message.count({ where: { workspaceId: w.ws } })).toBe(0);
    expect(await P().event.count({ where: { workspaceId: w.ws } })).toBe(0);
    expect(await P().campaignLead.findUniqueOrThrow({ where: { id: w.lead.cl.id } })).toMatchObject(
      {
        state: "ACTIVE",
      },
    );
  });

  test("I1b: a 5.1.1 DSN for a warm-up message touches nothing of the campaign", async () => {
    const w = await world(2);
    const { A, B } = w;
    await P().lead.update({ where: { id: w.lead.lead.id }, data: { email: B.email } });
    // the same mailbox mailed that address a campaign step 3 days ago
    const sm = await P().scheduledMessage.create({
      data: {
        workspaceId: w.ws,
        campaignId: w.campaign.id,
        campaignLeadId: w.lead.cl.id,
        stepId: w.steps[0]!.id,
        accountId: A.id,
        idempotencyKey: "x",
        renderedSubject: "Hi",
        renderedBody: "Hi",
        renderedText: "Hi",
        dueAt: new Date(TUE_8.getTime() - 3 * DAY),
        status: "SENT",
        sentAt: new Date(TUE_8.getTime() - 3 * DAY),
        rfcMessageId: "<campaign-step@a.test>",
      },
    });
    await w.tick();
    const warm = (await rows({ fromAccountId: A.id }))[0]!;
    const dsn = [
      "From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
      `To: ${A.email}`,
      "Subject: Delivery Status Notification (Failure)",
      `Date: ${TUE_8.toUTCString()}`,
      "Message-ID: <dsn-1@mx.test>",
      "MIME-Version: 1.0",
      'Content-Type: multipart/report; report-type=delivery-status; boundary="B1"',
      "",
      "--B1",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Your message could not be delivered.",
      "",
      "--B1",
      "Content-Type: message/delivery-status",
      "",
      "Reporting-MTA: dns; mx.test",
      "",
      `Final-Recipient: rfc822; ${B.email}`,
      "Action: failed",
      "Status: 5.1.1",
      "Diagnostic-Code: smtp; 550 5.1.1 user unknown",
      "",
      "--B1",
      "Content-Type: text/rfc822-headers",
      "",
      `From: ${A.email}`,
      `To: ${B.email}`,
      `Subject: ${warm.subject}`,
      `Message-ID: ${warm.rfcMessageId}`,
      "",
      "--B1--",
      "",
    ].join("\r\n");
    await fake(A).receiveRaw(Buffer.from(dsn));
    await w.sync(A);
    expect(await P().suppression.count({ where: { workspaceId: w.ws } })).toBe(0);
    expect(await P().event.count({ where: { workspaceId: w.ws } })).toBe(0);
    expect(await P().message.count({ where: { workspaceId: w.ws } })).toBe(0);
    expect(await P().campaignLead.findUniqueOrThrow({ where: { id: w.lead.cl.id } })).toMatchObject(
      {
        state: "ACTIVE",
      },
    );
    expect((await P().warmupMessage.findUniqueOrThrow({ where: { id: warm.id } })).error).toBe(
      "bounced",
    );
    expect(sm.id).toBeTruthy();
  });

  test("reply rate: one reply 30 min after receipt, with In-Reply-To; 0 % none; no reply to a reply", async () => {
    const w = await world(2, { settings: [{ replyRatePct: 100 }, { replyRatePct: 100 }] });
    const { A, B } = w;
    await w.tick();
    await w.sync(A, B);
    const replies = await rows({ kind: "REPLY", workspaceId: w.ws });
    expect(replies).toHaveLength(2);
    const toB = replies.find((r) => r.fromAccountId === B.id)!;
    const parent = await P().warmupMessage.findUniqueOrThrow({ where: { id: toB.parentId! } });
    expect(parent).toMatchObject({ fromAccountId: A.id, toAccountId: B.id, kind: "SEND" });
    expect(toB.dueAt).toEqual(new Date(TUE_8.getTime() + 30 * MIN));
    expect(toB.status).toBe("PLANNED");

    w.clock.advance(29 * MIN);
    expect((await w.tick()).replied).toBe(0);
    w.clock.advance(MIN);
    expect((await w.tick()).replied).toBe(2);
    const sent = await fake(B).findSent(toB.rfcMessageId);
    expect(sent).toMatchObject({ inReplyTo: parent.rfcMessageId });
    expect(sent!.references).toContain(parent.rfcMessageId);
    expect(sent!.to[0]!.email).toBe(A.email);
    expect(sent!.subject).toBe(`Re: ${parent.subject}`);
    await w.sync(A, B);
    expect(await rows({ kind: "REPLY", workspaceId: w.ws })).toHaveLength(2);
    expect(
      (await P().warmupMessage.findUniqueOrThrow({ where: { id: toB.id } })).receivedAt,
    ).not.toBeNull();

    const z = await world(2); // replyRatePct 0
    await z.tick();
    await z.sync(z.A, z.B);
    expect(await rows({ kind: "REPLY", workspaceId: z.ws })).toHaveLength(0);
  });

  test("replies wait their turn: three due Monday 08:00 all go out by 08:30; a stale PLANNED reply expires after 24 h", async () => {
    const mon = new Date("2026-10-26T08:00:00Z");
    const w = await world(2, { at: mon });
    const { A, B } = w;
    const mk = (i: number, extra: object) => ({
      workspaceId: w.ws,
      toAccountId: A.id,
      fromAccountId: B.id,
      kind: "REPLY" as const,
      subject: "Re: x",
      dueAt: mon,
      rfcMessageId: `<r${i}-${n}@x.test>`,
      ...extra,
    });
    for (let i = 0; i < 3; i++) {
      const parent = await P().warmupMessage.create({
        data: {
          workspaceId: w.ws,
          fromAccountId: A.id,
          toAccountId: B.id,
          kind: "SEND",
          status: "SENT",
          subject: "p",
          dueAt: mon,
          sentAt: new Date(mon.getTime() - 3 * 3600_000),
          receivedAt: new Date(mon.getTime() - 2 * 3600_000),
          rfcMessageId: `<p${i}-${n}@x.test>`,
        },
      });
      await P().warmupMessage.create({ data: mk(i, { parentId: parent.id }) });
    }
    for (let i = 0; i < 6; i++) {
      await w.tick();
      w.clock.advance(5 * MIN);
    }
    const replies = await rows({ kind: "REPLY", fromAccountId: B.id });
    expect(replies.map((r) => r.status)).toEqual(["SENT", "SENT", "SENT"]);

    const old = await P().warmupMessage.create({
      data: mk(9, {
        dueAt: new Date(w.clock.now().getTime() - 25 * 3600_000),
        parentId: replies[0]!.parentId,
      }),
    });
    await w.tick();
    expect(await P().warmupMessage.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({
      status: "FAILED",
      error: "expired",
    });
  });

  test("the reply decision uses the injected random against replyRatePct", async () => {
    const run = async (r: number) => {
      const w = await world(2, {
        settings: [{ replyRatePct: 30 }, { replyRatePct: 30 }],
        random: () => r,
      });
      await w.tick();
      await w.sync(w.A, w.B);
      return (await rows({ kind: "REPLY", workspaceId: w.ws })).length;
    };
    expect(await run(0.29)).toBe(2);
    expect(await run(0.3)).toBe(0);
  });

  test("a send with an unknown outcome counts toward today's total", async () => {
    const w = await world(2, { settings: [{ dailyLimit: 1 }, { enabled: false }] });
    const { A } = w;
    expect((await w.tick()).sent).toBe(0); // no enabled peer: nothing sent
    await P().warmupSettings.update({
      where: { accountId: w.B.id },
      data: { enabled: true, dailyLimit: 1 },
    });
    fake(A).failNext("api_5xx");
    await w.tick();
    expect(await rows({ fromAccountId: A.id })).toMatchObject([
      { status: "SENT", error: "ambiguous_send" },
    ]);
    w.clock.advance(30 * MIN);
    await w.tick();
    expect(await rows({ fromAccountId: A.id })).toHaveLength(1);
  });

  test("re-enabling warm-up restarts the ramp", async () => {
    const w = await world(2);
    const a = await P().emailAccount.findUniqueOrThrow({ where: { id: w.A.id } });
    const o = { clock: fixedClock(new Date("2026-11-20T08:00:00Z")) };
    await updateWarmup(P(), a, { enabled: false }, o);
    expect((await set(a.id)).startedAt).toEqual(TUE_8); // disabling keeps it
    await updateWarmup(P(), a, { enabled: true }, o);
    expect((await set(a.id)).startedAt).toEqual(o.clock.now());
  });

  test("the spam share counts only mail sent after a health reset", async () => {
    const w = await world(2);
    const { A, B } = w;
    const at = w.clock.now();
    const mkRow = (i: number, sentAt: Date) =>
      P().warmupMessage.create({
        data: {
          workspaceId: w.ws,
          fromAccountId: A.id,
          toAccountId: B.id,
          kind: "SEND",
          status: "SENT",
          subject: "s",
          dueAt: sentAt,
          sentAt,
          landedFolder: "SPAM",
          rfcMessageId: `<h${i}-${n}@x.test>`,
        },
      });
    await mkRow(1, new Date(at.getTime() - 2 * DAY));
    await mkRow(2, new Date(at.getTime() - DAY / 2));
    await P().emailAccount.update({
      where: { id: A.id },
      data: { healthResetAt: new Date(at.getTime() - DAY) },
    });
    expect((await healthInputs(P(), [A.id], at)).get(A.id)!.warmup).toEqual({ inbox: 0, spam: 1 });
  });

  test("M11: a reply waits for the replier's window and weekdays", async () => {
    const fri = new Date("2026-10-23T19:50:00Z");
    const w = await world(2, {
      at: fri,
      settings: [
        { replyRatePct: 100, weekdaysOnly: true },
        { replyRatePct: 100, weekdaysOnly: true },
      ],
    });
    await w.tick();
    await w.sync(w.A, w.B);
    const replies = await rows({ kind: "REPLY", workspaceId: w.ws });
    expect(replies).toHaveLength(2);
    for (const r of replies) expect(r.dueAt).toEqual(new Date("2026-10-26T08:00:00Z"));
  });

  test("spam is measured, never touched", async () => {
    const w = await world(2);
    const { A, B } = w;
    await fake(B).enableDelivery({ spamFrom: [A.email] });
    await w.tick();
    await w.sync(A, B);
    const toB = (await rows({ fromAccountId: A.id }))[0]!;
    expect(toB.landedFolder).toBeNull();
    w.clock.advance(59 * MIN);
    expect((await w.tick()).located).toBe(0);
    w.clock.advance(MIN);
    expect((await w.tick()).located).toBe(1);
    expect(await P().warmupMessage.findUniqueOrThrow({ where: { id: toB.id } })).toMatchObject({
      landedFolder: "SPAM",
      checkedAt: w.clock.now(),
    });
    expect(await fake(B).locate(toB.rfcMessageId)).toMatchObject({ folder: "SPAM" }); // not moved
    expect((await healthInputs(P(), [A.id], w.clock.now())).get(A.id)!.warmup).toEqual({
      inbox: 0,
      spam: 1,
    });
    // the peer's message to A landed in the inbox and was seen by sync
    expect((await healthInputs(P(), [B.id], w.clock.now())).get(B.id)!.warmup).toEqual({
      inbox: 1,
      spam: 0,
    });
    // the file for the located message is missing: MISSING
    await P().warmupMessage.update({
      where: { id: toB.id },
      data: { landedFolder: null, checkedAt: null, rfcMessageId: "<gone@x.test>" },
    });
    await w.tick();
    expect(
      (await P().warmupMessage.findUniqueOrThrow({ where: { id: toB.id } })).landedFolder,
    ).toBe("MISSING");
  });

  test("honest content", async () => {
    const w = await world(2);
    await w.tick();
    const row = (await rows({ fromAccountId: w.A.id }))[0]!;
    const tag = (await set(w.A.id)).filterTag;
    expect(row.subject).toMatch(new RegExp(`^\\[${tag}\\] Mailbox warm-up [0-9a-f]{8}$`));
    const m = (await fake(w.A).findSent(row.rfcMessageId))!;
    expect(m.subject).toBe(row.subject);
    expect(m.headers["auto-submitted"]).toEqual(["auto-generated"]);
    expect(m.headers["x-rightnow-warmup"]).toEqual(["1"]);
    expect(m.html).toBeNull();
    expect(m.attachments).toHaveLength(0);
    expect(String(m.headers["content-type"]?.[0])).toMatch(/^text\/plain/);
    expect(m.text!.trim()).toBe(
      "Automated warm-up message between two mailboxes of the same sender, sent by a self-hosted rightnow-ai installation. No action is needed.",
    );
    expect(row.rfcMessageId).toMatch(/^<[0-9a-f-]+@d0-\d+\.test>$/);
  });

  test("only opted-in peers of the same workspace", async () => {
    const w = await world(3, { settings: [{}, {}, { enabled: false }] });
    const other = await world(2);
    await w.tick();
    await other.tick();
    expect(await rows({ toAccountId: w.C.id })).toHaveLength(0);
    expect(await rows({ fromAccountId: w.C.id })).toHaveLength(0);
    for (const r of await rows({ workspaceId: w.ws })) {
      expect([w.A.id, w.B.id]).toContain(r.toAccountId);
      expect([w.A.id, w.B.id]).toContain(r.fromAccountId);
    }
    expect(await rows({ workspaceId: other.ws })).toHaveLength(2);

    const alone = await world(1);
    expect((await alone.tick()).sent).toBe(0);
    expect(warmupState(alone.A, await set(alone.A.id), 0, ["SMTP"])).toBe("PLACEMENT_UNKNOWN");
    expect(warmupState(alone.A, await set(alone.A.id), 1, ["SMTP"])).toBe("ACTIVE");
  });

  test("I7: nothing is sent from or to a provider that is not live-verified", async () => {
    const w = await world(2);
    const real = () => warmupTick(P(), w.clock, { providerFor, env: {} });
    expect((await real()).sent).toBe(0);
    expect(await rows({ workspaceId: w.ws })).toHaveLength(0);
    await P().providerVerification.upsert({
      where: { provider: "SMTP" },
      create: { provider: "SMTP", passedAt: w.clock.now(), accountId: w.A.id, report: {} },
      update: {},
    });
    expect((await real()).sent).toBe(2);
    expect(warmupState(w.A, await set(w.A.id), 1, [])).toBe("PROVIDER_BLOCKED");
  });

  test("failures: an auth error is not retried; a stuck row is abandoned", async () => {
    const w = await world(2);
    const { A, B } = w;
    fake(A).failNext("auth_revoked");
    expect((await w.tick()).sent).toBe(1);
    expect(await rows({ fromAccountId: A.id })).toMatchObject([{ status: "FAILED" }]);
    const a = await P().emailAccount.findUniqueOrThrow({ where: { id: A.id } });
    expect(a.lifecycle).toBe("NEEDS_ATTENTION");
    w.clock.advance(2 * 60 * MIN);
    await w.tick();
    expect(await rows({ fromAccountId: A.id })).toHaveLength(1);

    const stuck = await P().warmupMessage.create({
      data: {
        workspaceId: w.ws,
        fromAccountId: B.id,
        toAccountId: A.id,
        kind: "SEND",
        status: "SENDING",
        rfcMessageId: "<stuck@x.test>",
        subject: "s",
        dueAt: new Date(w.clock.now().getTime() - 11 * MIN),
        sentAt: new Date(w.clock.now().getTime() - 11 * MIN),
      },
    });
    await w.tick();
    expect(await P().warmupMessage.findUniqueOrThrow({ where: { id: stuck.id } })).toMatchObject({
      status: "FAILED",
      error: "abandoned",
    });
  });
});

describe("warmupTick: gate fixes", () => {
  test("G-I2: 100+ unlocatable old rows of any kind leave the queue; a newer row is still located", async () => {
    const w = await world(3);
    const { A, B, C } = w;
    await P().emailAccount.update({ where: { id: C.id }, data: { status: "DISCONNECTED" } });
    const at = (ms: number) => new Date(w.clock.now().getTime() - ms);
    const row = (to: string, sentAt: Date, i: number) => ({
      workspaceId: w.ws,
      fromAccountId: A.id,
      toAccountId: to,
      kind: "SEND" as const,
      status: "SENT" as const,
      rfcMessageId: `<old-${i}-${w.ws}@x.test>`,
      subject: "s",
      dueAt: sentAt,
      sentAt,
    });
    await P().warmupMessage.createMany({
      data: Array.from({ length: 100 }, (_, i) => row(C.id, at(2 * DAY + i * MIN), i)),
    });
    const fresh = await P().warmupMessage.create({ data: row(B.id, at(2 * 60 * MIN), 999) });
    await w.tick();
    expect(await P().warmupMessage.findUniqueOrThrow({ where: { id: fresh.id } })).toMatchObject({
      landedFolder: "MISSING", // located: the Fake has no such message
    });
    expect(
      await P().warmupMessage.count({
        where: { toAccountId: C.id, landedFolder: "MISSING", checkedAt: { not: null } },
      }),
    ).toBe(100);
  });

  test("G-M7: one mailbox's failure does not stop the others or the locate step", async () => {
    const w = await world(2);
    const { A, B } = w;
    const faulty = hooked("create", (create, a) =>
      a.data?.fromAccountId === A.id ? Promise.reject(new Error("boom")) : create(a),
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await warmupTick(faulty, w.clock, { providerFor, env: FAKE })).toMatchObject({
        sent: 1,
      });
      expect(err).toHaveBeenCalledWith(expect.stringContaining(A.id), expect.any(Error));
    } finally {
      err.mockRestore();
    }
    expect(await rows({ fromAccountId: B.id })).toHaveLength(1);
  });

  test("A-7: peer ranking is one grouped query per tick, not one count per sender and peer", async () => {
    const w = await world(5);
    let perPeer = 0;
    const counting = hooked("count", (count, a) => {
      if (a.where?.toAccountId) perPeer++;
      return count(a);
    });
    await warmupTick(counting, w.clock, { providerFor, env: FAKE });
    expect(perPeer).toBe(0);
    const got = await P().warmupMessage.groupBy({
      by: ["toAccountId"],
      where: { workspaceId: w.ws },
      _count: true,
    });
    expect(got.reduce((t, g) => t + g._count, 0)).toBe(5);
    expect(Math.max(...got.map((g) => g._count))).toBeLessThanOrEqual(2); // still spread over the peers
  });
});

describe("warm-up on a health-throttled account (D51)", () => {
  test("warmupTarget scales by healthSlowdownPct when healthCap is set, floor and at least 1", () => {
    const s = base({ dailyLimit: 20, slowWarmup: false });
    expect(warmupTarget(s, acct({ healthCap: 5 }), day(0), 50)).toBe(10);
    expect(warmupTarget(s, acct({ healthCap: null }), day(0), 50)).toBe(20);
    expect(
      warmupTarget(base({ dailyLimit: 1, slowWarmup: false }), acct({ healthCap: 5 }), day(0), 10),
    ).toBe(1);
    expect(warmupTarget(s, acct({ healthCap: 5 }), day(0), 33)).toBe(6);
    // a weekend stays 0
    const wk = base({ dailyLimit: 20, slowWarmup: false, weekdaysOnly: true });
    expect(warmupTarget(wk, acct({ healthCap: 5 }), day(2), 50)).toBe(0);
  });

  test("the tick and the view use it: target 2 at 50 % sends one message that day", async () => {
    const w = await world(2, { settings: [{ dailyLimit: 2 }] });
    await P().emailAccount.update({
      where: { id: w.A.id },
      data: { healthCap: 3, healthCapAt: TUE_8 },
    });
    await P().workspace.update({ where: { id: w.ws }, data: { healthSlowdownPct: 50 } });
    const a = await P().emailAccount.findUniqueOrThrow({ where: { id: w.A.id } });
    expect((await warmupView(P(), a, TUE_8, ["SMTP"])).todayTarget).toBe(1);
    await w.tick();
    w.clock.advance(20 * 60_000);
    await w.tick();
    expect(await rows({ fromAccountId: w.A.id, kind: "SEND" })).toHaveLength(1);
  });
});

describe("warmupState", () => {
  const S = { enabled: true } as WarmupSettings;
  const ok = ["SMTP" as const];
  test("mapping", () => {
    const a = (o: Partial<EmailAccount> = {}) =>
      ({
        provider: "SMTP",
        status: "CONNECTED",
        lifecycle: "ACTIVE",
        deletedAt: null,
        ...o,
      }) as EmailAccount;
    expect(warmupState(a(), null, 3, ok)).toBe("PAUSED");
    expect(warmupState(a(), { enabled: false } as WarmupSettings, 3, ok)).toBe("PAUSED");
    expect(warmupState(a({ lifecycle: "NEEDS_ATTENTION" }), S, 3, ok)).toBe("PROVIDER_BLOCKED");
    expect(warmupState(a({ status: "ERROR" }), S, 3, ok)).toBe("PROVIDER_BLOCKED");
    expect(warmupState(a({ deletedAt: new Date() }), S, 3, ok)).toBe("SUSPENDED");
    expect(warmupState(a({ status: "DISCONNECTED" }), S, 3, ok)).toBe("SUSPENDED");
    expect(warmupState(a(), S, 0, ok)).toBe("PLACEMENT_UNKNOWN");
    expect(warmupState(a(), S, 1, ok)).toBe("ACTIVE");
  });
});

describe("warmupStats", () => {
  test("30 days, zeros filled, counts per day", async () => {
    const w = await world(2, { settings: [{ replyRatePct: 100 }, { replyRatePct: 0 }] });
    await w.tick();
    await w.sync(w.A, w.B);
    w.clock.advance(30 * MIN);
    await w.tick();
    const st = await warmupStats(P(), w.ws, w.A.id, 30, w.clock.now());
    expect(st).toHaveLength(30);
    expect(st.at(-1)).toMatchObject({ day: "2026-10-20", sent: 2, replied: 1, received: 1 });
    expect(st[0]).toEqual({
      day: "2026-09-21",
      sent: 0,
      received: 0,
      replied: 0,
      inbox: 0,
      spam: 0,
      missing: 0,
    });
    await w.sync(w.A, w.B);
    const b = await warmupStats(P(), w.ws, w.B.id, 30, w.clock.now());
    expect(b.at(-1)).toMatchObject({ sent: 1, received: 2, replied: 0 });
  });
});
