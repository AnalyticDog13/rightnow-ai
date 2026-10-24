"use client";

import { useMemo, useState } from "react";
import { Button } from "../../../components/ui/button";
import { linkCheckHref } from "../../../lib/link-check";

// D30 + M4: no scripts, forms or same-origin (sandbox); the CSP meta blocks every fetch except data: images, and
// https: images only after "Show images" for this message. The parsed copy drops <meta>/<base>/<script>/<link>
// (meta refresh and a hostile <base> are not covered by CSP). A link whose text is a URL on another host than its href
// is rewritten to the /link-check warning page (I7: no scripts in the frame, so the rewrite is the mechanism).
function srcDoc(html: string, images: boolean) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("meta,base,script,link,form,iframe,object,embed").forEach((e) => e.remove());
  const origin = window.location.origin;
  doc.querySelectorAll("a[href]").forEach((a) => {
    const to = linkCheckHref(a.textContent ?? "", a.getAttribute("href") ?? "", origin);
    if (to) a.setAttribute("href", to);
  });
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src data:${images ? " https:" : ""}`;
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><base target="_blank">${doc.documentElement.outerHTML}`;
}

export function MessageFrame({ html, text }: { html: string | null; text: string | null }) {
  const [plain, setPlain] = useState(!html);
  const [images, setImages] = useState(false);
  const doc = useMemo(() => (html && !plain ? srcDoc(html, images) : ""), [html, plain, images]);
  return (
    <div className="flex flex-col gap-2">
      {html && (
        <div className="flex gap-2">
          <Button variant="outline" className="h-8 px-2" onClick={() => setPlain(!plain)}>
            {plain ? "Show formatted" : "Plain text"}
          </Button>
          {!plain && !images && (
            <Button variant="outline" className="h-8 px-2" onClick={() => setImages(true)}>
              Show images
            </Button>
          )}
        </div>
      )}
      {plain ? (
        <pre className="whitespace-pre-wrap break-words font-sans text-sm">{text ?? ""}</pre>
      ) : (
        <iframe
          title="Message body"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={doc}
          className="h-80 w-full rounded-md border border-border bg-white"
        />
      )}
    </div>
  );
}
