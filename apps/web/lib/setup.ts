import { timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@rightnow/db";
import { hashPassword } from "better-auth/crypto";
import { generateId } from "better-auth";
import { z } from "zod";
import { HttpError } from "./api";

export const firstOwnerInput = z.strictObject({
  name: z.string().trim().min(1).max(100),
  email: z.email(),
  password: z.string().min(12).max(128),
  workspaceName: z.string().trim().min(1).max(100),
  token: z.string().max(256),
});
export type FirstOwnerInput = z.infer<typeof firstOwnerInput>;

const SETUP_LOCK = 726_001; // arbitrary pg advisory lock key

function sameToken(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Creates user + credential + workspace + OWNER membership iff no user exists. The advisory lock serialises concurrent calls. */
export async function createFirstOwner(
  prisma: PrismaClient,
  input: FirstOwnerInput,
  setupToken: string,
) {
  if (!sameToken(input.token, setupToken)) throw new HttpError(403, "Invalid setup token");
  const password = await hashPassword(input.password);
  const slug =
    input.workspaceName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "workspace";
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_LOCK})`;
    if ((await tx.user.count()) > 0)
      throw new HttpError(409, "Setup is already complete; ask the owner for an invite");
    const user = await tx.user.create({
      data: { id: generateId(), name: input.name, email: input.email.toLowerCase() },
    });
    await tx.account.create({
      data: {
        id: generateId(),
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password,
      },
    });
    const workspace = await tx.workspace.create({ data: { name: input.workspaceName, slug } });
    await tx.member.create({
      data: { id: generateId(), workspaceId: workspace.id, userId: user.id, role: "owner" },
    });
    return { userId: user.id, workspaceId: workspace.id };
  });
}
