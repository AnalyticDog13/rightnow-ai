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
});

describe("linkTarget", () => {
  it("accepts http(s) only and returns the real host", () => {
    expect(linkTarget("https://evil.test:8443/p")).toEqual({
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
      "https://u:p@x.test",
    ])
      expect(linkTarget(bad)).toBeNull();
  });
});
