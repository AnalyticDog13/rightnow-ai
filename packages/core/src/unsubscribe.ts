import { isIP } from "node:net";
import { isPrivate } from "@rightnow/providers";

/** "https" only for a public https URL. Pure classification (no DNS): IPs go through the providers' private-range check; names must be dotted and not local. */
export function unsubscribeMode(appUrl: string): "https" | "mailto" {
  let u: URL;
  try {
    u = new URL(appUrl);
  } catch {
    return "mailto";
  }
  const h = u.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  const local = isIP(h)
    ? isPrivate(h)
    : !h.includes(".") ||
      h === "localhost" ||
      h === "host.docker.internal" ||
      /\.(local|localhost|internal)$/.test(h);
  return u.protocol === "https:" && !local ? "https" : "mailto";
}
