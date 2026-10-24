const bare = (h: string) => h.replace(/^www\./, "");

/** Host of a URL-looking string: an http(s) URL, or a bare domain/path such as `www.bank.test/login`. */
function hostOfText(text: string): string | null {
  const t = text.trim();
  if (!/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i.test(t)) return null;
  try {
    return new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** The target of /link-check: http(s) without credentials; `host` is what the browser will connect to. */
export function linkTarget(to: string | undefined): { url: string; host: string } | null {
  try {
    const u = new URL(to ?? "");
    if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password)
      return null;
    return { url: u.href, host: u.host };
  } catch {
    return null;
  }
}

/**
 * A mismatched link (visible text is a URL on another host than its href) becomes `${origin}/link-check?...`,
 * so the click lands on the warning page. Null: leave the link as it is.
 */
export function linkCheckHref(text: string, href: string, origin: string): string | null {
  const shown = hostOfText(text);
  const real = linkTarget(href);
  if (!shown || !real || bare(shown) === bare(new URL(real.url).hostname)) return null;
  return `${origin}/link-check?${new URLSearchParams({ to: real.url, shown })}`;
}
