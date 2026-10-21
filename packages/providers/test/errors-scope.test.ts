import { describe, expect, test } from "vitest";
import {
  FakeProvider,
  GraphProvider,
  MicrosoftOAuth,
  PermanentSendError,
  createFixtureFetch,
  mapSmtpError,
} from "../src";
import { memoryStore } from "./gmail-fake";
import { G, SCOPE } from "./graph-fake";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const smtp = (o: { responseCode: number; command?: string; response: string }) =>
  mapSmtpError(Object.assign(new Error("secret"), o)) as PermanentSendError;

describe("D18 scope (I6)", () => {
  test.each([
    [{ responseCode: 550, command: "RCPT TO", response: "550 5.1.1 user unknown" }, "recipient"],
    // round 1: sender-side wording or command is never recipient (Postfix smtpd_delay_reject reports at RCPT TO)
    [
      {
        responseCode: 550,
        command: "RCPT TO",
        response:
          "550 5.1.0 <me@x.test>: Sender address rejected: User unknown in virtual mailbox table",
      },
      "unknown",
    ],
    [
      { responseCode: 553, command: "MAIL FROM", response: "553 5.1.3 bad address syntax" },
      "account",
    ],
    [{ responseCode: 550, command: "AUTH PLAIN", response: "550 5.1.1 user unknown" }, "unknown"],
    [
      {
        responseCode: 550,
        command: "RCPT TO",
        response: "550 5.7.1 Service unavailable; client host blocked using Spamhaus",
      },
      "unknown",
    ],
    [
      {
        responseCode: 550,
        command: "RCPT TO",
        response: "550 Requested action not taken: mailbox unavailable",
      },
      "recipient",
    ],
    [{ responseCode: 550, command: "RCPT TO", response: "550 rejected due to policy" }, "unknown"],
    [{ responseCode: 552, response: "552 5.2.2 mailbox full" }, "unknown"],
    [{ responseCode: 554, response: "554 5.7.1 relay denied", command: "MAIL FROM" }, "account"],
    // Revision 3: sender-side 5.1.7/5.1.8 are never recipient
    [
      { responseCode: 553, command: "MAIL FROM", response: "553 5.1.8 bad sender domain" },
      "account",
    ],
    [
      { responseCode: 550, command: "RCPT TO", response: "550 5.1.7 bad sender mailbox" },
      "unknown",
    ],
    [
      { responseCode: 550, command: "RCPT TO", response: "550 5.2.1 mailbox disabled" },
      "recipient",
    ],
    [
      { responseCode: 550, command: "RCPT TO", response: "550 5.1.10 RecipientNotFound" },
      "recipient",
    ],
    [{ responseCode: 550, command: "DATA", response: "550 5.7.0 sending blocked" }, "account"],
  ])("%j -> %s", (r, scope) => {
    const e = smtp(r);
    expect(e).toBeInstanceOf(PermanentSendError);
    expect(e.scope).toBe(scope);
    expect(e.countsTowardPause).toBe(true);
    expect(e.message).not.toContain("secret");
  });

  test("Microsoft 365 5.4.1 Access denied: unknown, and not a strike toward the 3-in-a-row pause", () => {
    const e = smtp({
      responseCode: 550,
      command: "RCPT TO",
      response: "550 5.4.1 Recipient address rejected: Access denied. AS(201806281)",
    });
    expect(e.scope).toBe("unknown");
    expect(e.countsTowardPause).toBe(false);
  });

  test("default and from_mismatch", () => {
    expect(new PermanentSendError("x").scope).toBe("unknown");
    expect(new PermanentSendError("x").countsTowardPause).toBe(true);
    expect(new PermanentSendError("from_mismatch").scope).toBe("account");
    expect(new PermanentSendError("x", undefined, { scope: "recipient" }).scope).toBe("recipient");
  });

  test.each([
    ["ErrorInvalidRecipients", "recipient"],
    ["ErrorSendAsDenied", "account"],
    ["ErrorSomethingElse", "unknown"],
  ])("Graph 400 %s -> %s", async (code, scope) => {
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    const fetch = createFixtureFetch([
      {
        method: "POST",
        url: `${G}/me/messages`,
        respond: async () => json(201, { id: "d1", conversationId: "c" }),
      },
      {
        method: "POST",
        url: `${G}/me/messages/d1/send`,
        respond: async () => json(400, { error: { code } }),
      },
      {
        method: "GET",
        url: /\/me\/messages\/d1/,
        respond: async () => json(200, { id: "d1", isDraft: true }),
      },
      {
        method: "DELETE",
        url: `${G}/me/messages/d1`,
        respond: async () => new Response(null, { status: 204 }),
      },
    ]);
    const p = new GraphProvider({
      address: "me@rn.test",
      store: memoryStore({ scope: SCOPE }),
      oauth: new MicrosoftOAuth({ clientId: "c", clientSecret: "s", tenant: "common", fetch }),
      fetch,
    });
    const e = await p
      .send({
        from: { email: "me@rn.test" },
        to: [{ email: "to@rn.test" }],
        subject: "Hi",
        text: "t",
        messageId: "<c1@rn.test>",
      })
      .catch((x) => x);
    expect(e).toBeInstanceOf(PermanentSendError);
    expect(e.scope).toBe(scope);
  });

  test("Fake: permanent_rejected -> recipient, smtp_5xx -> unknown; rate_limit carries a chosen Retry-After", async () => {
    const f = new FakeProvider("me@fake.test", { dir: mkdtempSync(join(tmpdir(), "scope-")) });
    const m = {
      from: { email: "me@fake.test" },
      to: [{ email: "x@fake.test" }],
      subject: "s",
      text: "t",
      messageId: "<a@fake.test>",
    };
    f.failNext("permanent_rejected");
    expect((await f.send(m).catch((e) => e)).scope).toBe("recipient");
    f.failNext("smtp_5xx");
    expect((await f.send(m).catch((e) => e)).scope).toBe("unknown");
    f.failNext("rate_limit", 120);
    expect((await f.send(m).catch((e) => e)).retryAfterSec).toBe(120);
    f.failNext("rate_limit");
    expect((await f.send(m).catch((e) => e)).retryAfterSec).toBe(7);
  });
});
