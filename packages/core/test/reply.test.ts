import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmailAccount, Prisma } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import { getFakeProvider, parseRaw } from "@rightnow/providers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { dayKey } from "../src/accounts/daykey";
import { fixedClock } from "../src/clock";
import { AuthError } from "@rightnow/providers";
import { suppress } from "../src/leads/suppression";
import { sendReply, type ReplyInput } from "../src/mail/reply";

process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "reply-"));

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

const T = new Date("2026-10-20T10:00:00Z");
const clock = fixedClock(T);
const providerFor = async (a: EmailAccount) => getFakeProvider(a.email);
const deps = { providerFor };
let n = 0;

/** A mailbox with one thread: the lead wrote to us, cc'ing a colleague and our own address twice over. */
async function setup(acct: Partial<Prisma.EmailAccountUncheckedCreateInput> = {}) {
  const tag = randomBytes(4).toString("hex");
  const ws = (await P().workspace.create({ data: { name: "W", slug: `w-${tag}` } })).id;
  const a = await P().emailAccount.create({
    data: {
      workspaceId: ws,
      provider: "SMTP",
      email: `me-${tag}@send.test`,
      fromName: "Me",
      firstName: "Me",
      lastName: "Self",
      capTier: "SMTP",
      providerCap: 100,
      ...acct,
    },
  });
  const lead = await P().lead.create({ data: { workspaceId: ws, email: `lead-${tag}@lead.test` } });
  const t = await P().thread.create({
    data: {
      workspaceId: ws,
      accountId: a.id,
      subject: "Quick question",
      leadId: lead.id,
      lastMessageAt: T,
      lastInboundAt: T,
      lastInboundKind: "REPLY",
      isRead: false,
    },
  });
  const rfc = `<in${++n}-${tag}@lead.test>`;
  const m = await P().message.create({
    data: {
      workspaceId: ws,
      accountId: a.id,
      threadId: t.id,
      rfcMessageId: rfc,
      references: ["<first@send.test>"],
      direction: "IN",
      folder: "INBOX",
      fromEmail: lead.email,
      to: [a.email, "Boss@Lead.test"],
      cc: [a.email.toUpperCase(), `cc-${tag}@lead.test`],
      subject: "Re: Quick question",
      text: "Interested",
      sentAt: T,
      kind: "REPLY",
      leadId: lead.id,
      attachments: {
        create: [
          {
            filename: "deck.pdf",
            contentType: "application/pdf",
            size: 4,
            data: Buffer.from("%PDF"),
          },
        ],
      },
    },
  });
  return { ws, a, lead, t, m, rfc, tag };
}
const input = (s: { t: { id: string } }, o: Partial<ReplyInput> = {}): ReplyInput => ({
  threadId: s.t.id,
  mode: "reply",
  html: "<p>Thanks, talk soon.</p>",
  ...o,
});
const today = (a: EmailAccount) => new Date(`${dayKey(a.timezone, T)}T00:00:00Z`);
const usage = (a: EmailAccount) =>
  P().accountDailyUsage.findUnique({
    where: { accountId_day: { accountId: a.id, day: today(a) } },
  });
const sentRaw = async (a: EmailAccount) => {
  const raw = (await getFakeProvider(a.email).sentRaw()).at(-1)!;
  return parseRaw(raw, { providerMessageId: "x", folder: "SENT" });
};

describe("sendReply", () => {
  test("a reply is sent once, threaded, stored as an OUT message and counted", async () => {
    const s = await setup();
    const r = await sendReply(P(), clock, deps, s.ws, "u1", input(s));

    expect(await getFakeProvider(s.a.email).sentRaw()).toHaveLength(1);
    const sent = await sentRaw(s.a);
    expect(sent.inReplyTo).toBe(s.rfc);
    expect(sent.references).toEqual(["<first@send.test>", s.rfc]);
    expect(sent.subject).toBe("Re: Quick question");
    expect(sent.to.map((x) => x.email)).toEqual([s.lead.email]);
    expect(sent.cc).toEqual([]);

    const m = await P().message.findUniqueOrThrow({ where: { id: r.messageId } });
    expect(m).toMatchObject({
      threadId: s.t.id,
      direction: "OUT",
      kind: "OUTBOUND",
      folder: "SENT",
      fromEmail: s.a.email,
      leadId: s.lead.id,
      outsideApp: false,
      sentAt: T,
    });
    expect(m.rfcMessageId).toBe(sent.rfcMessageId);
    expect((await usage(s.a))?.sent).toBe(1);
    expect(await P().thread.findUniqueOrThrow({ where: { id: s.t.id } })).toMatchObject({
      isRead: true,
    });
    expect(
      (await P().lead.findUniqueOrThrow({ where: { id: s.lead.id } })).lastContactedAt,
    ).toEqual(T);
    expect(await P().auditLog.count({ where: { workspaceId: s.ws, action: "inbox.reply" } })).toBe(
      1,
    );
  });

  test("sent counts every recipient and adds to what campaigns already used", async () => {
    const s = await setup();
    await P().accountDailyUsage.create({
      data: { accountId: s.a.id, day: today(s.a), sent: 4, reserved: 1 },
    });
    await sendReply(P(), clock, deps, s.ws, "u1", input(s, { mode: "reply_all" }));
    expect((await usage(s.a))?.sent).toBe(4 + 3); // lead + boss + colleague
  });

  test("reply_all excludes our own address, in any case", async () => {
    const s = await setup();
    await sendReply(P(), clock, deps, s.ws, "u1", input(s, { mode: "reply_all" }));
    const sent = await sentRaw(s.a);
    expect(sent.to.map((x) => x.email)).toEqual([s.lead.email]);
    expect(sent.cc.map((x) => x.email).sort()).toEqual(["boss@lead.test", `cc-${s.tag}@lead.test`]);
  });

  test("forward needs a recipient, prefixes the subject and includes the original attachment", async () => {
    const s = await setup();
    await expect(
      sendReply(P(), clock, deps, s.ws, "u1", input(s, { mode: "forward" })),
    ).rejects.toMatchObject({
      status: 400,
      message: "to_required",
    });
    const r = await sendReply(
      P(),
      clock,
      deps,
      s.ws,
      "u1",
      input(s, { mode: "forward", to: ["Third@Party.test"] }),
    );
    const sent = await sentRaw(s.a);
    expect(sent.subject).toBe("Fwd: Quick question");
    expect(sent.to.map((x) => x.email)).toEqual(["third@party.test"]);
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0]).toMatchObject({ filename: "deck.pdf" });
    const stored = await P().attachment.findMany({ where: { messageId: r.messageId } });
    expect(stored.map((x) => [x.filename, x.size])).toEqual([["deck.pdf", 4]]);
    expect(await P().thread.findUniqueOrThrow({ where: { id: s.t.id } })).toMatchObject({
      hasAttachment: true,
    });
    expect(
      await P().auditLog.count({ where: { workspaceId: s.ws, action: "inbox.forward" } }),
    ).toBe(1);
  });

  test("an uploaded attachment travels with the reply", async () => {
    const s = await setup();
    await sendReply(
      P(),
      clock,
      deps,
      s.ws,
      "u1",
      input(s, {
        attachments: [{ filename: "a.txt", contentType: "text/plain", content: Buffer.from("hi") }],
      }),
    );
    expect((await sentRaw(s.a)).attachments.map((x) => x.filename)).toEqual(["a.txt"]);
  });

  test("an existing Re: subject is kept", async () => {
    const s = await setup();
    await P().thread.update({ where: { id: s.t.id }, data: { subject: "RE: Quick question" } });
    await sendReply(P(), clock, deps, s.ws, "u1", input(s));
    expect((await sentRaw(s.a)).subject).toBe("RE: Quick question");
  });

  test("at half the provider cap the reply is refused (409 provider_cap), below it the user limit does not apply", async () => {
    const s = await setup({ dailyLimit: 1 });
    await P().accountDailyUsage.create({
      data: { accountId: s.a.id, day: today(s.a), sent: 40, reserved: 9 },
    });
    // 49 + 1 = 50 = floor(100 / 2): allowed, although the daily limit of 1 is long spent
    await sendReply(P(), clock, deps, s.ws, "u1", input(s));
    expect((await usage(s.a))?.sent).toBe(41);
    await expect(sendReply(P(), clock, deps, s.ws, "u1", input(s))).rejects.toMatchObject({
      status: 409,
      message: "provider_cap",
    });
    expect(await getFakeProvider(s.a.email).sentRaw()).toHaveLength(1);
    // reply_all needs three units
    const t = await setup();
    await P().accountDailyUsage.create({
      data: { accountId: t.a.id, day: today(t.a), sent: 48, reserved: 0 },
    });
    await expect(
      sendReply(P(), clock, deps, t.ws, "u1", input(t, { mode: "reply_all" })),
    ).rejects.toMatchObject({
      message: "provider_cap",
    });
  });

  test("a suppressed recipient, to or cc, refuses the reply (409 recipient_suppressed)", async () => {
    const s = await setup();
    await P().$transaction((tx) =>
      suppress(tx, s.ws, [{ kind: "EMAIL", value: s.lead.email }], "MANUAL", "test"),
    );
    await expect(sendReply(P(), clock, deps, s.ws, "u1", input(s))).rejects.toMatchObject({
      status: 409,
      message: "recipient_suppressed",
    });
    const u = await setup();
    await P().$transaction((tx) =>
      suppress(tx, u.ws, [{ kind: "DOMAIN", value: "lead.test" }], "MANUAL", "test"),
    );
    await expect(
      sendReply(P(), clock, deps, u.ws, "u1", input(u, { to: ["x@ok.test"], cc: ["y@lead.test"] })),
    ).rejects.toMatchObject({ message: "recipient_suppressed" });
    expect(await getFakeProvider(s.a.email).sentRaw()).toHaveLength(0);
  });

  /** The Fake, with every send held for 200 ms so concurrent replies overlap. */
  const slow = {
    providerFor: async (a: EmailAccount) => {
      const p = getFakeProvider(a.email);
      return Object.assign(Object.create(p) as typeof p, {
        send: async (...args: Parameters<typeof p.send>) => {
          await new Promise((r) => setTimeout(r, 200));
          return p.send(...args);
        },
      });
    },
  };

  test("PA #5: two concurrent replies at cap - 1 on two threads: one is sent, one is 409 provider_cap", async () => {
    const s = await setup();
    const t2 = await P().thread.create({
      data: { workspaceId: s.ws, accountId: s.a.id, subject: "Other", lastMessageAt: T },
    });
    await P().message.create({
      data: {
        workspaceId: s.ws,
        accountId: s.a.id,
        threadId: t2.id,
        rfcMessageId: `<t2-${s.tag}@lead.test>`,
        direction: "IN",
        folder: "INBOX",
        fromEmail: `other-${s.tag}@lead.test`,
        to: [s.a.email],
        subject: "Other",
        sentAt: T,
        kind: "REPLY",
      },
    });
    await P().accountDailyUsage.create({
      data: { accountId: s.a.id, day: today(s.a), sent: 49, reserved: 0 },
    });
    const r = await Promise.allSettled([
      sendReply(P(), clock, slow, s.ws, "u1", input(s)),
      sendReply(P(), clock, slow, s.ws, "u1", input({ t: t2 })),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.find((x) => x.status === "rejected")).toMatchObject({
      reason: { status: 409, message: "provider_cap" },
    });
    expect(await getFakeProvider(s.a.email).sentRaw()).toHaveLength(1);
    expect(await usage(s.a)).toMatchObject({ sent: 50, reserved: 0 });
  });

  test("PA #5: two concurrent replies on one thread: one is sent, one is 409 reply_in_progress", async () => {
    const s = await setup();
    const r = await Promise.allSettled([
      sendReply(P(), clock, slow, s.ws, "u1", input(s)),
      sendReply(P(), clock, slow, s.ws, "u1", input(s)),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.find((x) => x.status === "rejected")).toMatchObject({
      reason: { status: 409, message: "reply_in_progress" },
    });
    expect(await getFakeProvider(s.a.email).sentRaw()).toHaveLength(1);
    // the thread is free again once the reply is done
    await sendReply(P(), clock, deps, s.ws, "u1", input(s));
    expect(await usage(s.a)).toMatchObject({ sent: 2, reserved: 0 });
  });

  test("an uncertain send is reported, nothing is stored and its units stay reserved", async () => {
    const s = await setup();
    getFakeProvider(s.a.email).failNext("timeout_after_write");
    await expect(sendReply(P(), clock, deps, s.ws, "u1", input(s))).rejects.toMatchObject({
      status: 502,
      message: "send_uncertain",
      body: {
        message:
          "The reply may have been sent. Check the mailbox's Sent folder before trying again.",
      },
    });
    expect(await P().message.count({ where: { threadId: s.t.id, direction: "OUT" } })).toBe(0);
    expect(await usage(s.a)).toMatchObject({ sent: 0, reserved: 1 }); // like an UNCERTAIN campaign send
    // sync imports what went out: the provider copy is a normal message the next ingest stores once
    expect(await getFakeProvider(s.a.email).sentRaw()).toHaveLength(1);
  });

  test("a storage failure after the provider accepted the mail is 502 sent_not_recorded", async () => {
    const s = await setup();
    // the reservation before the send works; every transaction after it fails
    let txs = 0;
    const broken = new Proxy(P(), {
      get: (t, k) =>
        k === "$transaction" && txs++ > 0
          ? async () => {
              throw Object.assign(new Error("db down"), { code: "P1001" });
            }
          : Reflect.get(t, k),
    });
    await expect(sendReply(broken, clock, deps, s.ws, "u1", input(s))).rejects.toMatchObject({
      status: 502,
      message: "sent_not_recorded",
      body: { message: expect.stringContaining("do not send it again") },
    });
    expect(await getFakeProvider(s.a.email).sentRaw()).toHaveLength(1);
    expect(await P().message.count({ where: { threadId: s.t.id, direction: "OUT" } })).toBe(0);
    expect(await usage(s.a)).toMatchObject({ sent: 0, reserved: 1 });
  });

  test("an AuthError from providerFor needs attention like one from send", async () => {
    const s = await setup();
    const auth = { providerFor: async () => Promise.reject(new AuthError("invalid_grant")) };
    await expect(sendReply(P(), clock, auth, s.ws, "u1", input(s))).rejects.toMatchObject({
      status: 409,
      message: "account_needs_attention",
    });
    expect(await P().emailAccount.findUniqueOrThrow({ where: { id: s.a.id } })).toMatchObject({
      lifecycle: "NEEDS_ATTENTION",
    });
  });

  test("a forward over the provider limit is refused from the attachment sizes alone", async () => {
    const s = await setup({ provider: "MICROSOFT", capTier: "MS365", providerCap: 5000 });
    await P().attachment.updateMany({
      where: { messageId: s.m.id },
      data: { size: 4 * 1024 * 1024 },
    });
    await expect(
      sendReply(P(), clock, deps, s.ws, "u1", input(s, { mode: "forward", to: ["x@y.test"] })),
    ).rejects.toMatchObject({ status: 413, message: "attachments_too_large_for_provider" });
    expect(await getFakeProvider(s.a.email).sentRaw()).toHaveLength(0);
  });

  test("provider failures: auth needs attention, others report the code only", async () => {
    const s = await setup();
    getFakeProvider(s.a.email).failNext("auth_revoked");
    await expect(sendReply(P(), clock, deps, s.ws, "u1", input(s))).rejects.toMatchObject({
      status: 409,
      message: "account_needs_attention",
    });
    expect(await P().emailAccount.findUniqueOrThrow({ where: { id: s.a.id } })).toMatchObject({
      lifecycle: "NEEDS_ATTENTION",
    });
    const u = await setup();
    getFakeProvider(u.a.email).failNext("smtp_5xx");
    await expect(sendReply(P(), clock, deps, u.ws, "u1", input(u))).rejects.toMatchObject({
      status: 502,
      message: "smtp_5xx",
    });
    getFakeProvider(u.a.email).failNext("rate_limit");
    await expect(sendReply(P(), clock, deps, u.ws, "u1", input(u))).rejects.toMatchObject({
      status: 502,
      message: "rate_limited",
    });
    expect(await P().message.count({ where: { threadId: u.t.id, direction: "OUT" } })).toBe(0);
    // nothing went out: the reservations were released
    expect(await usage(u.a)).toMatchObject({ sent: 0, reserved: 0 });
  });

  test("an account that is not connected, deleted or foreign refuses (409 / 404)", async () => {
    const s = await setup({ status: "ERROR" });
    await expect(sendReply(P(), clock, deps, s.ws, "u1", input(s))).rejects.toMatchObject({
      status: 409,
      message: "account_unavailable",
    });
    const u = await setup({ deletedAt: T });
    await expect(sendReply(P(), clock, deps, u.ws, "u1", input(u))).rejects.toMatchObject({
      status: 404,
    });
    const v = await setup();
    await expect(sendReply(P(), clock, deps, u.ws, "u1", input(v))).rejects.toMatchObject({
      status: 404,
    });
  });

  test("a Microsoft mailbox refuses 4 MB of attachments (413), a 2 MB one goes out", async () => {
    const s = await setup({ provider: "MICROSOFT", capTier: "MS365", providerCap: 5000 });
    const file = (mb: number) => ({
      filename: "big.bin",
      contentType: "application/octet-stream",
      content: Buffer.alloc(mb * 1024 * 1024, 1),
    });
    await expect(
      sendReply(P(), clock, deps, s.ws, "u1", input(s, { attachments: [file(4)] })),
    ).rejects.toMatchObject({
      status: 413,
      message: "attachments_too_large_for_provider",
    });
    await sendReply(P(), clock, deps, s.ws, "u1", input(s, { attachments: [file(2)] }));
    const g = await setup();
    await expect(
      sendReply(P(), clock, deps, g.ws, "u1", input(g, { attachments: [file(21)] })),
    ).rejects.toMatchObject({
      status: 413,
      message: "attachments_too_large",
    });
  });

  test("when sync stored the sent copy first, the reply reuses it (M16) and still counts", async () => {
    const s = await setup();
    const provider = getFakeProvider(s.a.email);
    const original = provider.send.bind(provider);
    provider.send = async (mime, o) => {
      const res = await original(mime, o);
      await P().message.create({
        data: {
          workspaceId: s.ws,
          accountId: s.a.id,
          threadId: s.t.id,
          rfcMessageId: res.rfcMessageId,
          references: [],
          direction: "OUT",
          folder: "SENT",
          fromEmail: s.a.email,
          to: [s.lead.email],
          cc: [],
          subject: "Re: Quick question",
          sentAt: T,
          kind: "OUTBOUND",
          outsideApp: true,
        },
      });
      return res;
    };
    try {
      const r = await sendReply(P(), clock, deps, s.ws, "u1", input(s));
      expect(await P().message.count({ where: { threadId: s.t.id, direction: "OUT" } })).toBe(1);
      expect(await P().message.findUniqueOrThrow({ where: { id: r.messageId } })).toMatchObject({
        outsideApp: true,
      });
      expect((await usage(s.a))?.sent).toBe(1);
    } finally {
      provider.send = original;
    }
  });
});

describe("sendReply sanitizes the editor html", () => {
  test("hostile markup is stripped before it is sent and stored; the text part is derived from the clean html", async () => {
    const s = await setup();
    const r = await sendReply(
      P(),
      clock,
      deps,
      s.ws,
      "u1",
      input(s, {
        html: '<p><b>Hi</b> <a href="https://x.test" onclick="x()">link</a> <a href="javascript:alert(1)">bad</a><img src=x onerror=alert(1)><script>alert(2)</script></p>',
      }),
    );
    const sent = await sentRaw(s.a);
    expect(sent.html).toContain("<b>Hi</b>");
    expect(sent.html).toContain('<a href="https://x.test">link</a>');
    expect(sent.html).not.toMatch(/javascript|onclick|onerror|<script|<img/i);
    expect(sent.text).toContain("https://x.test");
    const m = await P().message.findUniqueOrThrow({ where: { id: r.messageId } });
    expect(m.html).not.toMatch(/javascript|onerror|<script/i);
  });
});
