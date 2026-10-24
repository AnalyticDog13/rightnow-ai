import { isIPv6 } from "node:net";
import { hit } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { HttpError } from "./api";

/**
 * D49 client IP. Only in vps mode, where web listens on 127.0.0.1 behind Caddy (`header_up X-Real-IP {remote_host}`
 * replaces whatever the client sent), is `X-Real-IP` trusted; without it the IP is `unknown`, which fails closed.
 * Local mode is one caller, `local`: a client-supplied header is never trusted there.
 */
export function clientIp(req: Request, mode: "local" | "vps") {
  if (mode !== "vps") return "local";
  const ip = req.headers.get("x-real-ip")?.trim().slice(0, 64) || "unknown";
  return isIPv6(ip) ? v6Bucket(ip) : ip;
}

/** One client per IPv6 /64 (a single host usually owns the whole /64); an IPv4-mapped address is its IPv4. */
function v6Bucket(ip: string) {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (v4) return v4;
  const [head, tail] = ip.split("::") as [string, string?];
  const groups = (part?: string) =>
    (part ? part.split(":") : []).flatMap((g) => (g.includes(".") ? ["0", "0"] : [g]));
  const h = groups(head);
  const t = groups(tail);
  const all = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  return `${all
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":")}::/64`;
}

/** One hit of `<subject>:<name>` (e.g. `ip:203.0.113.9:signin`); over `max` in the window → 429 `rate_limited` with `Retry-After`. */
export async function limitOrThrow(
  name: string,
  subject: string,
  max: number,
  windowSec: number,
  now = new Date(),
) {
  const r = await hit(prisma, `${subject}:${name}`, max, windowSec, now);
  if (!r.ok) throw new HttpError(429, "rate_limited", r.retryAfterSec);
}
