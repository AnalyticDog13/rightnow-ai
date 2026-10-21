import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@rightnow/db/client";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const alnum = (n: number) => randomBytes(n).toString("base64url").replace(/[-_]/g, "x").slice(0, n);

/** Token `rn_<prefix8>_<secret32>`; only sha256(token) is stored. The token is returned once. */
export async function createApiKey(
  prisma: Pick<PrismaClient, "apiKey">,
  workspaceId: string,
  name: string,
  scopes: string[],
): Promise<{ id: string; token: string }> {
  const prefix = alnum(8);
  const token = `rn_${prefix}_${alnum(32)}`;
  const key = await prisma.apiKey.create({
    data: { workspaceId, name, prefix, hash: sha256(token), scopes },
  });
  return { id: key.id, token };
}

/** Lookup by hash of the presented token (no secret comparison happens in JS). Null if unknown or revoked. */
export async function verifyApiKey(
  prisma: PrismaClient,
  token: string,
): Promise<{ workspaceId: string; keyId: string; scopes: string[] } | null> {
  if (!/^rn_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$/.test(token)) return null;
  const key = await prisma.apiKey.findUnique({ where: { hash: sha256(token) } });
  if (!key || key.revokedAt) return null;
  await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  return { workspaceId: key.workspaceId, keyId: key.id, scopes: key.scopes };
}

/** Workspace-scoped revoke; false if the key is not in this workspace or already revoked. */
export async function revokeApiKey(
  prisma: Pick<PrismaClient, "apiKey">,
  workspaceId: string,
  id: string,
) {
  const r = await prisma.apiKey.updateMany({
    where: { id, workspaceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return r.count === 1;
}

const WRITE_VERBS = ["create", "update", "delete"];

/** `leads:read` is allowed by itself, `leads:all` or `all:all`. */
export function scopeAllows(scopes: string[], scope: string) {
  const [resource, action] = scope.split(":");
  // `<resource>:write` covers exactly create, update and delete; any other verb needs its own scope.
  return scopes.some(
    (s) =>
      s === scope ||
      s === `${resource}:all` ||
      s === "all:all" ||
      (s === `${resource}:write` && WRITE_VERBS.includes(action!)),
  );
}

/** Scopes offered when creating a key (`<resource>:all` stays valid for verification but is not offered). */
export const API_SCOPES = [
  ...["leads", "blocklist", "campaigns", "accounts", "inbox", "analytics"].flatMap((r) => [
    `${r}:read`,
    `${r}:write`,
  ]),
  "all:all",
] as const;
