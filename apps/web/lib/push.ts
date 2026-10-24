import {
  getEnv,
  googleJwks,
  handleGmailPush,
  handleGraphPush,
  systemClock,
  verifyGoogleJwt,
} from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { route } from "./api";
import { clientIp, limitOrThrow } from "./ratelimit";

/** D48: a push body is small; 1 MB covers 100 Graph notifications with room to spare. */
const MAX_BODY = 1024 * 1024;
const MAX_VALIDATION_TOKEN = 1024;
/**
 * Per client IP, before any verification work. Generous for real Google / Microsoft bursts; past it the 429 makes
 * Pub/Sub and Graph redeliver later (nothing is dropped silently), and polling still covers every mailbox.
 */
const PUSH_PER_MIN = 600;
const limitPush = (req: Request, name: string) =>
  limitOrThrow(name, `ip:${clientIp(req, getEnv().MODE)}`, PUSH_PER_MIN, 60);

/** The body as text, or null past `max` bytes: Content-Length is checked when sent and the stream is counted anyway. */
async function readCapped(req: Request, max: number): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Parsed JSON body, or the 413 / 400 response to return. Never logs or echoes the body. */
async function jsonBody(req: Request): Promise<{ body: unknown } | Response> {
  const text = await readCapped(req, MAX_BODY);
  if (text === null) return new Response(null, { status: 413 });
  try {
    return { body: JSON.parse(text) };
  } catch {
    return new Response(null, { status: 400 });
  }
}

/**
 * Pub/Sub push (public: the OIDC JWT is the auth). Only sets the sync request flag; an unknown mailbox is a 204 too,
 * so the response says nothing about which addresses exist.
 */
export const gmailPush = (jwks = googleJwks) =>
  route({ auth: "public" }, async ({ req }) => {
    await limitPush(req, "push-gmail");
    const env = getEnv();
    const token = /^Bearer ([\w-]+\.[\w-]+\.[\w-]*)$/.exec(
      req.headers.get("authorization") ?? "",
    )?.[1];
    const audience = env.GMAIL_PUSH_AUDIENCE || `${env.APP_URL.replace(/\/$/, "")}/api/push/gmail`;
    const ok =
      !!token &&
      token.length <= 8192 &&
      !!env.GMAIL_PUSH_SA_EMAIL &&
      (await verifyGoogleJwt(token, {
        audience,
        email: env.GMAIL_PUSH_SA_EMAIL,
        now: systemClock.now(),
        jwks,
      }));
    if (!ok) return new Response(null, { status: 401 });
    const b = await jsonBody(req);
    if (b instanceof Response) return b.status === 400 ? new Response(null, { status: 204 }) : b; // M3: no redelivery
    await handleGmailPush(prisma, systemClock, b.body);
    return new Response(null, { status: 204 });
  });

/**
 * Graph change and lifecycle notifications (public: each notification's clientState is the auth). A validation
 * request echoes its token as text/plain; a notification only sets the sync request flag and always gets 202.
 */
export const graphPush = () =>
  route({ auth: "public" }, async ({ req }) => {
    await limitPush(req, "push-graph");
    const v = new URL(req.url).searchParams.get("validationToken");
    if (v !== null) {
      if (v.length > MAX_VALIDATION_TOKEN) return new Response(null, { status: 400 });
      return new Response(v, {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      });
    }
    const b = await jsonBody(req);
    if (b instanceof Response) return b;
    await handleGraphPush(prisma, systemClock, b.body);
    return new Response(null, { status: 202 });
  });
