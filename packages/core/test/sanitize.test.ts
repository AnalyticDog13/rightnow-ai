import { describe, expect, test } from "vitest";
import { sanitizeReplyHtml } from "../src/mail/sanitize";

describe("sanitizeReplyHtml", () => {
  test("keeps the allowlisted formatting and http(s)/mailto links", () => {
    const html =
      '<p><b>a</b> <strong>b</strong> <i>c</i> <em>d</em> <u>e</u><br><a href="https://x.test/p?q=1">l</a> <a href="mailto:a@b.test">m</a></p><ul><li>1</li></ul><ol><li>2</li></ol>';
    expect(sanitizeReplyHtml(html)).toBe(html.replace("<br>", "<br />")); // serialised self-closing
  });

  test("strips scripts, event handlers, styles and unknown tags", () => {
    const out = sanitizeReplyHtml(
      '<p onclick="x()" style="color:red" class="c">hi</p><script>alert(1)</script><img src=x onerror="alert(1)"><iframe src="https://e.test"></iframe><div><span style="a:b">t</span></div><style>p{}</style>',
    );
    expect(out).toBe("<p>hi</p>t");
  });

  test("drops javascript:, data: and other schemes but keeps the link text", () => {
    for (const href of [
      "javascript:alert(1)",
      " JaVaScRiPt:alert(1)",
      "data:text/html,x",
      "ftp://x.test",
      "//x.test",
      "/rel",
    ]) {
      const out = sanitizeReplyHtml(`<a href="${href}" onclick="x()">go</a>`);
      expect(out).not.toMatch(/href|javascript|onclick/i);
      expect(out).toContain("go");
    }
  });

  test("link attributes are limited to href", () => {
    const out = sanitizeReplyHtml(
      '<a href="https://x.test" target="_self" style="x:y" rel="opener">l</a>',
    );
    expect(out).toBe('<a href="https://x.test">l</a>');
  });

  test("keeps merge tags and escapes text", () => {
    expect(sanitizeReplyHtml("<p>Hi {{firstName}} &lt;b&gt;</p>")).toBe(
      "<p>Hi {{firstName}} &lt;b&gt;</p>",
    );
  });
});
