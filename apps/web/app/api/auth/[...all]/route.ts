import { createHash } from "node:crypto";
import { release } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { toNextJsHandler } from "better-auth/next-js";
import { parseCookies } from "better-call";
import { HttpError, route } from "../../../../lib/api";
import { auth } from "../../../../lib/auth";
import { getWebEnv } from "../../../../lib/env";
import { clientIp, limitOrThrow } from "../../../../lib/ratelimit";

const handler = toNextJsHandler(auth);
export const { GET } = handler;

const VERIFY_2FA = new Set([
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/two-factor/verify-otp",
]);
const EMAIL_WINDOW = 900;

/**
 * The user a pending 2FA sign-in belongs to, read exactly as better-auth reads it: its own cookie name and better-call's
 * `parseCookies` (first value of that exact name, quotes stripped). `undefined` = no cookie, `null` = names no user.
 */
async function twoFactorUser(req: Request): Promise<string | null | undefined> {
  const ctx = await auth.$context;
  const signed = parseCookies(req.headers.get("cookie") ?? "").get(
    ctx.createAuthCookie("two_factor").name,
  );
  if (!signed) return undefined;
  const dot = signed.lastIndexOf("."); // `<identifier>.<signature>`; better-auth itself checks the signature
  if (dot < 1) return null;
  return (await ctx.internalAdapter.findVerificationValue(signed.slice(0, dot)))?.value ?? null;
}

// the parsing better-call applies for the media types `/sign-in/email` allows (JSON first, then urlencoded forms)
const JSON_TYPE = /^application\/([a-z0-9.+-]*\+)?json/i;
async function emailOf(req: Request): Promise<string> {
  const type = req.headers.get("content-type") ?? "";
  let body: unknown;
  if (JSON_TYPE.test(type))
    body = await req
      .clone()
      .json()
      .catch(() => undefined);
  else if (type.toLowerCase().includes("application/x-www-form-urlencoded"))
    body = Object.fromEntries(
      await req
        .clone()
        .formData()
        .catch(() => new FormData()),
    );
  else throw new HttpError(415, "unsupported_media_type");
  const email = (body as { email?: unknown } | undefined)?.email;
  // fail closed: no address we can count means no attempt reaches the password check
  if (typeof email !== "string" || !email.trim()) throw new HttpError(400, "Invalid request");
  return email.trim().toLowerCase();
}

/** D49 / R20: better-auth's own limiter is off, so every auth POST passes these Postgres buckets first. */
export const POST = route({ auth: "public" }, async ({ req }) => {
  const path = new URL(req.url).pathname.replace(/^\/api\/auth/, "");
  const ip = `ip:${clientIp(req, getWebEnv().MODE)}`;
  if (path === "/sign-in/email") {
    await limitOrThrow("signin", ip, 5, 60);
    const email = await emailOf(req);
    const subject = `email:${createHash("sha256").update(email).digest("hex")}`;
    const now = new Date();
    await limitOrThrow("signin", subject, 10, EMAIL_WINDOW, now);
    const res = await handler.POST(req);
    // only failed sign-ins count (this bucket can lock the owner out for 15 minutes under attack, docs/API.md)
    if (res.status !== 401) await release(prisma, `${subject}:signin`, EMAIL_WINDOW, now);
    return res;
  }
  if (VERIFY_2FA.has(path)) {
    await limitOrThrow("2fa", ip, 5, 60);
    const user = await twoFactorUser(req);
    if (user) await limitOrThrow("2fa", `user:${user}`, 10, 900);
    else if (user === null) await limitOrThrow("2fa-nouser", ip, 10, 900); // an unresolvable cookie fails closed
    return handler.POST(req);
  }
  await limitOrThrow("auth", ip, 100, 60);
  return handler.POST(req);
});
