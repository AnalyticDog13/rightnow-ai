import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  AmbiguousSendError,
  AuthError,
  PermanentSendError,
  RateLimitedError,
  TransientBeforeSendError,
} from "../errors";
import type { MailProvider, OutboundMime, SendResult } from "../types";
import type { FailKind, ProviderHarness } from "./harness";

export type { FailKind, ProviderHarness, Scenario } from "./harness";

/** Reusable provider contract: every provider (Fake, Gmail, Graph, IMAP/SMTP) runs this unchanged against its own harness. */
export function runProviderContract(h: ProviderHarness): void {
  describe(`MailProvider contract: ${h.name}`, () => {
    const open: { close(): Promise<void> }[] = [];
    afterEach(async () => {
      await Promise.all(open.splice(0).map((c) => c.close()));
    });
    const setup = async () => {
      const s = await h.setup();
      open.push(s);
      return s;
    };
    const mime = (p: MailProvider, o: Partial<OutboundMime> = {}): OutboundMime => ({
      from: { email: p.address },
      to: [{ email: "to@rn.test" }],
      subject: "Hello",
      text: "Hi there",
      messageId: "<c1@rn.test>",
      ...o,
    });
    const rawText = (b: Buffer) => b.toString("utf8").replace(/\r\n[ \t]+/g, " ");
    const when = (need: "removed" | "locate" | "expire") => it.skipIf(!h.supports.has(need));
    const fromX = { email: "x@rn.test" };

    it("send preserves Message-ID and findSent finds it", async () => {
      const { provider: p } = await setup();
      const r = await p.send(mime(p));
      expect(r.rfcMessageId).toBe("<c1@rn.test>");
      const m = await p.findSent(
        "<c1@rn.test>",
        r.providerMessageId ? { providerMessageId: r.providerMessageId } : undefined,
      );
      expect(m?.rfcMessageId).toBe("<c1@rn.test>");
      expect(m?.folder).toBe("SENT");
      if (r.providerMessageId) expect(m?.providerMessageId).toBe(r.providerMessageId);
      expect(await p.findSent("<none@rn.test>")).toBeNull();
    });

    it("reply carries threading headers", async () => {
      const { provider: p, scenario } = await setup();
      const first = await p.send(mime(p));
      const reply = await p.send(
        mime(p, {
          messageId: "<c2@rn.test>",
          inReplyTo: "<c1@rn.test>",
          references: ["<c1@rn.test>"],
          threadId: first.providerThreadId,
        }),
      );
      const raw = rawText((await scenario.sentRaw()).find((b) => b.includes("c2@rn.test"))!);
      expect(raw).toMatch(/^in-reply-to: <c1@rn\.test>\s*$/im);
      expect(raw).toMatch(/^references: <c1@rn\.test>\s*$/im);
      if (first.providerThreadId) expect(reply.providerThreadId).toBe(first.providerThreadId);
    });

    it("campaign headers pass through verbatim", async () => {
      const { provider: p, scenario } = await setup();
      await p.send(
        mime(p, {
          headers: {
            "List-Unsubscribe": "<https://x.test/u/abc>, <mailto:u@x.test?subject=unsub>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }),
      );
      const raw = rawText((await scenario.sentRaw())[0]!);
      expect(raw).toContain(
        "List-Unsubscribe: <https://x.test/u/abc>, <mailto:u@x.test?subject=unsub>",
      );
      expect(raw).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    });

    it("UTF-8 survives", async () => {
      const { provider: p } = await setup();
      const s = "Grüße 日本語 🚀";
      await p.send(mime(p, { subject: s, text: s }));
      const m = await p.findSent("<c1@rn.test>");
      expect(m?.subject).toBe(s);
      expect(m?.text?.trim()).toBe(s);
    });

    it("attachments are delivered", async () => {
      const { provider: p } = await setup();
      const content = randomBytes(10 * 1024);
      await p.send(
        mime(p, {
          attachments: [{ filename: "a.bin", contentType: "application/octet-stream", content }],
        }),
      );
      const att = (await p.findSent("<c1@rn.test>"))?.attachments.find(
        (a) => a.filename === "a.bin",
      );
      expect(att?.content?.equals(content)).toBe(true);
    });

    it("rejects a foreign From", async () => {
      const { provider: p, scenario } = await setup();
      const e = await p.send(mime(p, { from: { email: "other@rn.test" } })).catch((x) => x);
      expect(e).toBeInstanceOf(PermanentSendError);
      expect(e.code).toBe("from_mismatch");
      expect(await scenario.sentRaw()).toHaveLength(0);
    });

    it("error mapping", async () => {
      const cases: [FailKind, (e: unknown) => void, number][] = [
        [
          "rate_limit",
          (e) => (
            expect(e).toBeInstanceOf(RateLimitedError),
            expect((e as RateLimitedError).retryAfterSec).toBe(7)
          ),
          0,
        ],
        ["auth_revoked", (e) => expect(e).toBeInstanceOf(AuthError), 0],
        [
          "token_5xx",
          (e) => (
            expect(e).toBeInstanceOf(TransientBeforeSendError),
            expect(e).not.toBeInstanceOf(AuthError)
          ),
          0,
        ],
        ["api_5xx", (e) => expect(e).toBeInstanceOf(AmbiguousSendError), 1],
        ["timeout_after_write", (e) => expect(e).toBeInstanceOf(AmbiguousSendError), 1],
        ["smtp_4xx", (e) => expect(e).toBeInstanceOf(TransientBeforeSendError), 0],
        ["connect_refused", (e) => expect(e).toBeInstanceOf(TransientBeforeSendError), 0],
        ["smtp_5xx", (e) => expect(e).toBeInstanceOf(PermanentSendError), 0],
        ["permanent_rejected", (e) => expect(e).toBeInstanceOf(PermanentSendError), 0],
      ];
      for (const [kind, check, sent] of cases) {
        if (!h.supports.has(kind)) continue;
        const { provider: p, scenario } = await setup();
        scenario.failNext(kind);
        const e = await p.send(mime(p)).then(
          () => new Error(`${kind}: send resolved`),
          (x) => x,
        );
        check(e);
        expect(await scenario.sentRaw(), kind).toHaveLength(sent);
      }
    });

    it("listChangesSince returns each new message once", async () => {
      const { provider: p, scenario } = await setup();
      const cursor = await p.currentCursor();
      await scenario.receiveInbound({
        from: fromX,
        subject: "re",
        text: "t",
        inReplyTo: "<c1@rn.test>",
      });
      const c = await p.listChangesSince(cursor);
      if (c.expired) throw new Error("expired");
      expect(c.messages).toHaveLength(1);
      expect(c.messages[0]).toMatchObject({ folder: "INBOX", inReplyTo: "<c1@rn.test>" });
      const c2 = await p.listChangesSince(c.cursor);
      if (c2.expired) throw new Error("expired");
      expect(c2.messages).toHaveLength(0);
      expect(c2.hasMore).toBe(false);
    });

    it("listChangesSince pages without loss", async () => {
      const { provider: p, scenario } = await setup();
      let cursor = await p.currentCursor();
      for (let i = 0; i < 5; i++)
        await scenario.receiveInbound({ from: fromX, subject: `m${i}`, text: "t" });
      const counts: number[] = [];
      const more: boolean[] = [];
      const ids = new Set<string>();
      for (let i = 0; i < 3; i++) {
        const c = await p.listChangesSince(cursor, { limit: 2 });
        if (c.expired) throw new Error("expired");
        counts.push(c.messages.length);
        more.push(c.hasMore);
        c.messages.forEach((m) => ids.add(m.providerMessageId));
        cursor = c.cursor;
      }
      expect(counts).toEqual([2, 2, 1]);
      expect(more).toEqual([true, true, false]);
      expect(ids.size).toBe(5);
      await scenario.receiveInbound({ from: fromX, subject: "sixth", text: "t" });
      const last = await p.listChangesSince(cursor);
      if (last.expired) throw new Error("expired");
      expect(last.messages.map((m) => m.subject)).toEqual(["sixth"]);
    });

    it("own and outside-app sent mail appears as SENT", async () => {
      const { provider: p, scenario } = await setup();
      const cursor = await p.currentCursor();
      await p.send(mime(p));
      await scenario.sendExternal({ subject: "from phone", messageId: "<ext@x.test>" });
      const c = await p.listChangesSince(cursor);
      if (c.expired) throw new Error("expired");
      const sent = c.messages.filter((m) => m.folder === "SENT").map((m) => m.rfcMessageId);
      expect(sent).toEqual(expect.arrayContaining(["<c1@rn.test>", "<ext@x.test>"]));
    });

    it("drafts and spam are not reported", async () => {
      const { provider: p, scenario } = await setup();
      const cursor = await p.currentCursor();
      await scenario.saveDraft();
      await scenario.receiveSpam();
      const c = await p.listChangesSince(cursor);
      if (c.expired) throw new Error("expired");
      expect(c.messages).toHaveLength(0);
    });

    when("removed")("deletions are reported", async () => {
      const { provider: p, scenario } = await setup();
      const cursor = await p.currentCursor();
      await scenario.receiveInbound({ from: fromX, subject: "gone", text: "t" });
      const c = await p.listChangesSince(cursor);
      if (c.expired) throw new Error("expired");
      const id = c.messages[0]!.providerMessageId;
      await scenario.deleteMessage(id);
      const c2 = await p.listChangesSince(c.cursor);
      if (c2.expired) throw new Error("expired");
      expect(c2.removed).toContain(id);
    });

    when("locate")("locate", async () => {
      const { provider: p, scenario } = await setup();
      const cursor = await p.currentCursor();
      await scenario.receiveInbound({ from: fromX, subject: "in", text: "t" });
      await scenario.receiveSpam();
      const sent: SendResult = await p.send(mime(p));
      const c = await p.listChangesSince(cursor);
      if (c.expired) throw new Error("expired");
      const inbound = c.messages.find((m) => m.folder === "INBOX")!;
      expect((await p.locate(inbound.rfcMessageId!))?.folder).toBe("INBOX");
      expect((await p.locate("<spam@rn.test>"))?.folder).toBe("SPAM");
      expect((await p.locate(sent.rfcMessageId))?.folder).toBe("SENT");
      expect(await p.locate("<unknown@rn.test>")).toBeNull();
    });

    when("expire")("expired cursor", async () => {
      const { provider: p, scenario } = await setup();
      const old = await p.currentCursor();
      await scenario.expireCursors();
      expect(await p.listChangesSince(old)).toEqual({ expired: true });
      const fresh = await p.listChangesSince(await p.currentCursor());
      expect(fresh.expired).toBe(false);
    });

    it("listMessages pages and resumes", { timeout: 120_000 }, async () => {
      const { provider: p, scenario } = await setup();
      await scenario.seedInbound(1203);
      const since = new Date(0);
      const ids = new Set<string>();
      let token: string | undefined;
      let page5: string | undefined;
      let pages = 0;
      do {
        const r = await p.listMessages({ since, folder: "INBOX", pageToken: token, limit: 100 });
        expect(r.messages.length).toBeLessThanOrEqual(100);
        r.messages.forEach((m) => ids.add(m.providerMessageId));
        token = r.nextPageToken;
        if (++pages === 5) page5 = token;
      } while (token);
      expect(pages).toBe(13);
      expect(ids.size).toBe(1203);
      // resume from the token alone: no state is kept between calls
      let resumed = 0;
      token = page5;
      do {
        const r = await p.listMessages({ since, folder: "INBOX", pageToken: token, limit: 100 });
        resumed += r.messages.length;
        token = r.nextPageToken;
      } while (token);
      expect(resumed).toBe(703);
    });

    it("diagnostics", async () => {
      const { provider: p, scenario } = await setup();
      expect((await p.diagnostics()).ok).toBe(true);
      if (!h.supports.has("auth_revoked")) return;
      scenario.failNext("auth_revoked");
      await p.send(mime(p)).catch(() => {});
      const d = await p.diagnostics();
      const names = p.kind === "SMTP" ? ["imap_login", "smtp_auth"] : ["token"];
      const bad = d.checks.filter((c) => names.includes(c.name));
      expect(d.ok).toBe(false);
      expect(bad.length).toBeGreaterThan(0);
      for (const c of bad) {
        expect(c.ok).toBe(false);
        expect(c.code).toBeTruthy();
      }
    });

    it("revoke resolves", async () => {
      const { provider: p } = await setup();
      await expect(p.revoke()).resolves.toBeUndefined();
      await expect(p.revoke()).resolves.toBeUndefined();
    });
  });
}
