import { describe, expect, it } from "vitest";
import { linkCheckHref, linkTarget } from "../lib/link-check";

const O = "https://app.test";

describe("linkCheckHref", () => {
  it("routes a link whose visible URL has another host through /link-check", () => {
    const h = linkCheckHref("https://bank.test", "https://evil.test/x?a=1", O)!;
    const u = new URL(h);
    expect(u.origin + u.pathname).toBe("https://app.test/link-check");
    expect(u.searchParams.get("to")).toBe("https://evil.test/x?a=1");
    expect(u.searchParams.get("shown")).toBe("bank.test");
  });
  it("also catches a bare domain as the visible text", () => {
    expect(linkCheckHref("www.bank.test/login", "https://evil.test", O)).toContain("/link-check?");
  });
  it("leaves matching hosts (www or case aside), plain text and non-http links alone", () => {
    expect(linkCheckHref("https://bank.test/a", "https://BANK.test/b", O)).toBeNull();
    expect(linkCheckHref("https://www.bank.test", "https://bank.test", O)).toBeNull();
    expect(linkCheckHref("Click here", "https://evil.test", O)).toBeNull();
    expect(linkCheckHref("https://bank.test", "mailto:a@evil.test", O)).toBeNull();
    expect(linkCheckHref("https://bank.test", "javascript:alert(1)", O)).toBeNull();
  });
  it("flags credentials instead of refusing them", () => {
    expect(linkTarget("https://bank.test@evil.test/")).toEqual({
      url: "https://bank.test@evil.test/",
      host: "evil.test",
      credentialed: true,
    });
    expect(linkTarget("https://evil.test/")?.credentialed).toBe(false);
  });
});

describe("linkCheckHref heuristics", () => {
  it("always routes a credentialed href (userinfo spoof), whatever the text", () => {
    for (const text of ["https://bank.test", "Click here"]) {
      const h = linkCheckHref(text, "https://bank.test@evil.test/", O)!;
      expect(h).toContain("/link-check?");
    }
  });
  it("finds the domain in punctuation and sentences, and in IDN text", () => {
    for (const text of [
      "bank.test.",
      "(bank.test)",
      "Visit bank.test now",
      " https://bank.test/x, ",
      "bank.test!",
      "bäcker.test",
    ])
      expect(linkCheckHref(text, "https://evil.test/", O), text).toContain("/link-check?");
  });
  it("leaves words and a matching host alone", () => {
    expect(linkCheckHref("Visit our site.", "https://evil.test/", O)).toBeNull();
    expect(linkCheckHref("Visit bank.test now", "https://bank.test/a", O)).toBeNull();
  });
});

describe("linkTarget", () => {
  it("accepts http(s) only and returns the real host", () => {
    expect(linkTarget("https://evil.test:8443/p")).toMatchObject({
      url: "https://evil.test:8443/p",
      host: "evil.test:8443",
    });
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "mailto:a@b.test",
      "/rel",
      "",
      undefined,
    ])
      expect(linkTarget(bad)).toBeNull();
  });
});
