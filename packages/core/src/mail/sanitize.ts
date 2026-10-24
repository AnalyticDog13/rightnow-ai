import sanitizeHtml from "sanitize-html";

const SAFE_HREF = /^(https?:|mailto:)/i;

/**
 * The reply composer's contentEditable output is untrusted. Allowlist only: formatting, lists, paragraphs and
 * http(s)/mailto links with nothing but `href`. Script/style contents are dropped, other unknown tags keep their text.
 */
export function sanitizeReplyHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["b", "strong", "i", "em", "u", "a", "ul", "ol", "li", "p", "br"],
    allowedAttributes: { a: ["href"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      // a link that is not absolute http(s)/mailto loses its tag (the text stays)
      a: (tag, attribs): sanitizeHtml.Tag => {
        const href = (attribs.href ?? "").trim();
        return SAFE_HREF.test(href)
          ? { tagName: tag, attribs: { href } }
          : { tagName: "span", attribs: {} };
      },
    },
  });
}
