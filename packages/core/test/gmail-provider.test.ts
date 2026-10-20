import { createTestDb } from "@rightnow/db/test-db";
import { GmailProvider, createFixtureFetch } from "@rightnow/providers";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createProvider } from "../src/accounts/factory";
import { decryptCredentials, encryptCredentials } from "../src/accounts/credentials";
import { resetEnvCache } from "../src/env";
import { seedAccount, testEnv } from "./accounts-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  testEnv();
  process.env.GOOGLE_CLIENT_ID = "cid";
  process.env.GOOGLE_CLIENT_SECRET = "sec";
  resetEnvCache();
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

test("two providers on one real credential store refresh once and keep the refresh token", async () => {
  const stale = {
    kind: "oauth" as const,
    accessToken: "at-1",
    refreshToken: "rt-1",
    expiresAt: 1,
    scope: "s",
  };
  const a = await seedAccount(db.prisma, encryptCredentials(stale), "g@example.com");
  const fetch = createFixtureFetch([
    {
      method: "POST",
      url: "https://oauth2.googleapis.com/token",
      respond: async () => (
        await new Promise((r) => setTimeout(r, 50)),
        json(200, { access_token: "at-2", expires_in: 3600 })
      ),
    },
    {
      method: "POST",
      url: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      respond: async () => json(200, { id: "g1", threadId: "t1" }),
    },
  ]);
  const account = { id: a.id, provider: "GMAIL" as const, email: "g@example.com" };
  const p1 = createProvider(account, { prisma: db.prisma, fetch });
  const p2 = createProvider(account, { prisma: db.prisma, fetch });
  expect(p1).toBeInstanceOf(GmailProvider);
  const mime = (n: number) => ({
    from: { email: "g@example.com" },
    to: [{ email: "to@example.com" }],
    subject: "s",
    text: "t",
    messageId: `<m${n}@example.com>`,
  });
  await Promise.all([p1.send(mime(1)), p2.send(mime(2))]);
  expect(fetch.calls.filter((c) => c.url.includes("/token"))).toHaveLength(1);
  const sends = fetch.calls.filter((c) => c.url.endsWith("/send"));
  expect(sends).toHaveLength(2);
  expect(sends.every((c) => c.headers.authorization === "Bearer at-2")).toBe(true);
  const row = await db.prisma.emailAccount.findUniqueOrThrow({ where: { id: a.id } });
  expect(decryptCredentials(row.credentialsEnc!)).toMatchObject({
    accessToken: "at-2",
    refreshToken: "rt-1",
  });
});
