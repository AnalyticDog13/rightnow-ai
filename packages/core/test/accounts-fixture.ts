import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@rightnow/db/client";
import { resetEnvCache } from "../src/env";

/** encrypt() without a key reads ENCRYPTION_KEY from env; give tests a valid one. */
export function testEnv() {
  process.env.MODE = "local"; // vitest sets MODE=test
  process.env.DATABASE_URL ??= "postgresql://unused";
  process.env.APP_URL ??= "http://localhost:3000";
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  resetEnvCache();
}

export async function seedAccount(
  prisma: PrismaClient,
  credentialsEnc: string | null,
  email = "a@example.com",
) {
  const ws = await prisma.workspace.create({
    data: { name: "W", slug: `w-${randomBytes(4).toString("hex")}` },
  });
  return prisma.emailAccount.create({
    data: {
      workspaceId: ws.id,
      provider: "MICROSOFT",
      email,
      fromName: "A",
      firstName: "A",
      lastName: "B",
      capTier: "MS365",
      providerCap: 5000,
      credentialsEnc,
    },
  });
}
