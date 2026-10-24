const bare = (h: string) => h.replace(/^www\./, "");
// shortcut: any word that looks like a domain counts (so "report.pdf" is treated as one), and only the first such
// token is compared; upgrade to a public-suffix list if the false positives annoy.
const DOMAINISH = /^(https?:\/\/)?([\p{L}\p{N}-]+\.)+\p{L}{2,}(:\d+)?([/?#]\S*)?$/u;

/** Host of the first URL- or domain-like word in a link's visible text (IDN allowed), punycoded like a URL host. */
function hostOfText(text: string): string | null {
  for (const word of text.split(/\s+/)) {
    const w = word.replace(/^[("'<]+/, "").replace(/[.,;:)!?"'>]+$/, "");
    if (!DOMAINISH.test(w)) continue;
    try {
      return new URL(/^https?:\/\//i.test(w) ? w : `https://${w}`).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The target of /link-check: http(s) only. `credentialed` (user:pass@ or user@ before the host) is the classic
 * "bank.test@evil.test" spoof: the page names the real host and offers no Continue.
 */
export function linkTarget(
  to: string | undefined,
): { url: string; host: string; credentialed: boolean } | null {
  try {
    const u = new URL(to ?? "");
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return { url: u.href, host: u.host, credentialed: !!(u.username || u.password) };
  } catch {
    return null;
  }
}

/**
 * A mismatched link (visible text is a URL on another host than its href) or any credentialed href becomes
 * `${origin}/link-check?...`, so the click lands on the warning page. Null: leave the link as it is.
 */
export function linkCheckHref(text: string, href: string, origin: string): string | null {
  const real = linkTarget(href);
  if (!real) return null;
  const shown = hostOfText(text);
  if (!real.credentialed && (!shown || bare(shown) === bare(new URL(real.url).hostname)))
    return null;
  return `${origin}/link-check?${new URLSearchParams({ to: real.url, shown: shown ?? "" })}`;
}
