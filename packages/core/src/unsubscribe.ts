const PRIVATE_V4 = /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;

/** "https" only for a public https host; local, private and IP-literal-in-private-range hosts get mailto-only unsubscribe. */
export function unsubscribeMode(appUrl: string): "https" | "mailto" {
  let u: URL;
  try {
    u = new URL(appUrl);
  } catch {
    return "mailto";
  }
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const local =
    h === "localhost" ||
    h === "host.docker.internal" ||
    h.endsWith(".local") ||
    h.endsWith(".localhost") ||
    PRIVATE_V4.test(h) ||
    h === "::" ||
    h === "::1" ||
    /^(f[cd]|fe[89ab])/.test(h.includes(":") ? h : "");
  return u.protocol === "https:" && !local ? "https" : "mailto";
}
