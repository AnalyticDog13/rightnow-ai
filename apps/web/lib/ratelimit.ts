import { hit } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { HttpError } from "./api";

/**
 * D49 client IP. Only in vps mode, where web listens on 127.0.0.1 behind Caddy (`header_up X-Real-IP {remote_host}`
 * replaces whatever the client sent), is `X-Real-IP` trusted; without it the IP is `unknown`, which fails closed.
 * Local mode is one caller, `local`: a client-supplied header is never trusted there.
 */
export const clientIp = (req: Request, mode: "local" | "vps") =>
  mode === "vps" ? req.headers.get("x-real-ip")?.trim().slice(0, 64) || "unknown" : "local";

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
