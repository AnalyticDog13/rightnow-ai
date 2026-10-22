import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseRaw } from "@rightnow/providers";
import { describe, expect, it } from "vitest";
import { classify, INTEREST_OF, stripQuoted } from "../src/mail/classify";

const dir = join(__dirname, "fixtures", "mail");
const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as Record<
  string,
  { _now?: string; _direction?: "IN" | "OUT" } & Record<string, unknown>
>;
const files = readdirSync(dir).filter((f) => f.endsWith(".eml"));

describe("rule classifier corpus", () => {
  it("has at least 30 emails and an expectation for each", () => {
    expect(files.length).toBeGreaterThanOrEqual(30);
    expect(Object.keys(expected).sort()).toEqual([...files].sort());
  });

  it.each(files)("%s", async (file) => {
    const { _now, _direction, ...want } = expected[file]!;
    const m = await parseRaw(readFileSync(join(dir, file)), {
      providerMessageId: "",
      folder: "INBOX",
    });
    const got = classify(m, {
      now: new Date(_now ?? "2026-06-15T12:00:00Z"),
      direction: _direction ?? "IN",
    });
    expect(JSON.parse(JSON.stringify(got))).toEqual(want);
  });
});

describe("stripQuoted", () => {
  it("cuts a Gmail 'On … wrote:' block, including a wrapped header", () => {
    expect(
      stripQuoted("Yes please.\n\nOn Mon, 15 Jun 2026 at 09:00, Me <me@rn.test>\nwrote:\n> hi"),
    ).toBe("Yes please.");
    expect(stripQuoted("Yes.\nOn Mon, Me <me@rn.test> wrote:\n> hi")).toBe("Yes.");
  });
  it("cuts Outlook blocks", () => {
    expect(stripQuoted("Thanks\n\n-----Original Message-----\nFrom: a\nSent: b")).toBe("Thanks");
    expect(
      stripQuoted(
        "Thanks\n\n________________________________\nFrom: Me\nSent: Monday\nTo: Pat\nSubject: x",
      ),
    ).toBe("Thanks\n\n________________________________");
  });
  it("drops > lines", () => {
    expect(stripQuoted("a\n> quoted\n>> deeper\nb")).toBe("a\nb");
  });
  it("keeps plain text and a 'From:' that is not a header block", () => {
    expect(stripQuoted("From: my side, we are fine")).toBe("From: my side, we are fine");
  });
});

describe("hostile input (FR C1)", () => {
  const MB2 = 2 * 1024 * 1024;
  const msg = (from: string, subject: string, text: string) => ({
    from: { email: from },
    subject,
    text,
    html: null,
    headers: {},
    attachments: [],
  });
  it.each([
    ["mailer-daemon, a@ + word chars", msg("mailer-daemon@x.test", "Undeliverable", `a@${"a".repeat(MB2)}`)],
    ["mailer-daemon, dotted labels", msg("postmaster@x.test", "failure notice", `x@${"a.".repeat(MB2 / 2)}`)],
    ["reply, whitespace run before unsubscribe", msg("p@x.test", "Re: hi", `${" ".repeat(MB2)}unsubscribe`)],
    ["reply, header-like lines", msg("p@x.test", "Re: hi", "From: a\n".repeat(MB2 / 8))],
    ["ooo, keyword run", msg("p@x.test", "Out of office", "back ".repeat(MB2 / 5))],
  ])("a 2 MB body classifies in < 100 ms: %s", (_, m) => {
    const t = performance.now();
    classify(m, { now: new Date("2026-06-15T12:00:00Z"), direction: "IN" });
    expect(performance.now() - t).toBeLessThan(100);
  });
});

it("INTEREST_OF follows PS-INBOX-19", () => {
  expect(INTEREST_OF).toEqual({
    INTERESTED: 1,
    MEETING_REQUESTED: 1,
    OUT_OF_OFFICE: 0,
    NOT_INTERESTED: -1,
    WRONG_PERSON: -2,
  });
});
