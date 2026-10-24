import { createHash } from "node:crypto";
import { release } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { toNextJsHandler } from "better-auth/next-js";
import { route } from "../../../../lib/api";
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

/** The user a pending 2FA sign-in belongs to: the two-factor cookie names a verification row whose value is the user id. */
async function twoFactorUser(req: Request): Promise<string | null> {
  const raw = /(?:^|;\s*)(?:__Secure-)?better-auth\.two_factor=([^;]+)/.exec(
    req.headers.get("cookie") ?? "",
  )?.[1];
  if (!raw) return null;
  let signed: string;
  try {
    signed = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const dot = signed.lastIndexOf("."); // `<identifier>.<signature>`; better-auth itself checks the signature
  const identifier = dot > 0 ? signed.slice(0, dot) : signed;
  const row = await (await auth.$context).internalAdapter.findVerificationValue(identifier);
  return row?.value ?? null;
}

const emailOf = (req: Request) =>
  req
    .clone()
    .json()
    .then(
      (b: { email?: unknown }) =>
        typeof b?.email === "string" ? b.email.trim().toLowerCase() : "",
      () => "",
    );

/** D49 / R20: better-auth's own limiter is off, so every auth POST passes these Postgres buckets first. */
export const POST = route({ auth: "public" }, async ({ req }) => {
  const path = new URL(req.url).pathname.replace(/^\/api\/auth/, "");
  const ip = `ip:${clientIp(req, getWebEnv().MODE)}`;
  if (path === "/sign-in/email") {
    await limitOrThrow("signin", ip, 5, 60);
    const email = await emailOf(req);
    if (!email) return handler.POST(req);
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
    return handler.POST(req);
  }
  await limitOrThrow("auth", ip, 100, 60);
  return handler.POST(req);
});
