import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildMime, parseRaw, type OutboundMime } from "../src";

const base: OutboundMime = {
  from: { email: "a@rn.test", name: "Ann" },
  to: [{ email: "b@rn.test" }],
  bcc: [{ email: "hidden@rn.test" }],
  subject: "Hello",
  text: "plain",
  html: "<p>html</p>",
  messageId: "<m1@rn.test>",
  inReplyTo: "<p0@rn.test>",
  references: ["<p-1@rn.test>", "<p0@rn.test>"],
  headers: {
    "List-Unsubscribe": "<https://x.test/u/abc>, <mailto:u@x.test?subject=unsub>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  },
};
const unfold = (b: Buffer) => b.toString("utf8").replace(/\r\n[ \t]+/g, " ");

describe("buildMime", () => {
  it("emits our Message-ID, CRLF, threading and unsubscribe headers verbatim", async () => {
    const raw = await buildMime(base);
    const s = unfold(raw);
    expect(s).toMatch(/^Message-ID: <m1@rn\.test>\r$/im);
    expect(s).toContain("In-Reply-To: <p0@rn.test>\r\n");
    expect(s).toContain("References: <p-1@rn.test> <p0@rn.test>\r\n");
    expect(s).toContain(
      "List-Unsubscribe: <https://x.test/u/abc>, <mailto:u@x.test?subject=unsub>\r\n",
    );
    expect(s).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n");
    expect(s).toMatch(/Content-Type: multipart\/alternative/i);
    expect(raw.toString().replace(/\r\n/g, "")).not.toMatch(/\n/);
  });

  it("omits Bcc by default and keeps it with keepBcc", async () => {
    expect(unfold(await buildMime(base))).not.toMatch(/^Bcc:/im);
    expect(unfold(await buildMime(base, { keepBcc: true }))).toMatch(/^Bcc: hidden@rn\.test/im);
  });

  it("round-trips UTF-8, a long folded subject and an attachment", async () => {
    const content = randomBytes(2048);
    const subject = "Grüße 日本語 🚀 " + "x".repeat(200);
    const m = await parseRaw(
      await buildMime({
        ...base,
        subject,
        text: "Grüße 日本語 🚀",
        attachments: [{ filename: "a.bin", contentType: "application/octet-stream", content }],
      }),
      { providerMessageId: "1", folder: "SENT" },
    );
    expect(m.subject).toBe(subject);
    expect(m.text?.trim()).toBe("Grüße 日本語 🚀");
    expect(m.rfcMessageId).toBe("<m1@rn.test>");
    expect(m.inReplyTo).toBe("<p0@rn.test>");
    expect(m.references).toEqual(["<p-1@rn.test>", "<p0@rn.test>"]);
    expect(m.headers["list-unsubscribe-post"]).toEqual(["List-Unsubscribe=One-Click"]);
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0]!.content?.equals(content)).toBe(true);
  });

  it("an attachment over 25 MB parses to content null, truncated true", async () => {
    const m = await parseRaw(
      await buildMime({
        ...base,
        attachments: [
          {
            filename: "big.bin",
            contentType: "application/octet-stream",
            content: Buffer.alloc(26 * 1024 * 1024, 1),
          },
        ],
      }),
      { providerMessageId: "1", folder: "INBOX" },
    );
    expect(m.attachments[0]).toMatchObject({ filename: "big.bin", content: null, truncated: true });
    expect(m.attachments[0]!.size).toBe(26 * 1024 * 1024);
  });

  it("rejects CR/LF injection anywhere", async () => {
    const bad = (o: Partial<OutboundMime>) =>
      expect(buildMime({ ...base, ...o })).rejects.toThrow(/CR\/LF/);
    await bad({ subject: "a\r\n" + "Bcc: x@y.z" });
    await bad({ from: { email: "a@rn.test", name: "A\nB" } });
    await bad({ to: [{ email: "b@rn.test\r\nX: 1" }] });
    await bad({ messageId: "<a@b>\r\nX: 1" });
    await bad({ headers: { "X-A": "v\r\nBcc: x" } });
    await bad({ headers: { "X-A\nB": "v" } });
  });

  it("custom headers cannot override reserved ones", async () => {
    for (const k of ["Message-ID", "from", "To", "Cc", "BCC", "Date", "In-Reply-To", "References"])
      await expect(buildMime({ ...base, headers: { [k]: "x" } })).rejects.toThrow(/reserved/);
    await expect(
      buildMime({ ...base, headers: { "X-RightNow-Test": "1" } }),
    ).resolves.toBeInstanceOf(Buffer);
  });
});
