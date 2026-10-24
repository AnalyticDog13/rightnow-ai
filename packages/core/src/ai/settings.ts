import type { Prisma, PrismaClient } from "@rightnow/db/client";
import { assertPublicHost } from "@rightnow/providers";
import { z } from "zod";
import { AccountError } from "../accounts/service";
import { audit } from "../audit";
import { decrypt, encrypt } from "../crypto";
import type { OutEnv } from "@rightnow/providers";

type Db = PrismaClient | Prisma.TransactionClient;
type Actor = string | null | undefined;

export type AiConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  inputPricePerMTok?: number;
  outputPricePerMTok?: number;
  classifierEnabled: boolean;
};

/** Sent by the settings form; an omitted `apiKey` keeps the stored one (same host only). */
export const aiSettingsInput = z.strictObject({
  baseUrl: z.string().max(500),
  apiKey: z.string().min(1).max(500).optional(),
  model: z.string().trim().min(1).max(100),
  inputPricePerMTok: z.number().min(0).max(1_000_000).optional(),
  outputPricePerMTok: z.number().min(0).max(1_000_000).optional(),
  classifierEnabled: z.boolean().default(false),
});

const bad = (m: string) => new AccountError(400, m);

export async function loadAiConfig(db: Db, ws: string): Promise<AiConfig | null> {
  const w = await db.workspace.findUniqueOrThrow({
    where: { id: ws },
    select: { aiConfigEnc: true },
  });
  return w.aiConfigEnc ? (JSON.parse(decrypt(w.aiConfigEnc)) as AiConfig) : null;
}

/** Never returns the apiKey. `null` = AI is off. */
export async function getAiSettings(db: Db, ws: string) {
  const c = await loadAiConfig(db, ws);
  if (!c) return null;
  const out: Partial<AiConfig> = { ...c };
  delete out.apiKey;
  return { ...(out as Omit<AiConfig, "apiKey">), hasApiKey: true as const };
}

/**
 * The only writer of `Workspace.aiConfigEnc`. http(s) without userinfo, a host that is public now (checked again on
 * every call: DNS rebinding), and the stored key is never sent to a different host (D38/D47).
 */
export async function setAiSettings(
  prisma: PrismaClient,
  ws: string,
  actorId: Actor,
  input: unknown,
  env: OutEnv,
): Promise<void> {
  const r = aiSettingsInput.safeParse(input);
  if (!r.success) throw bad(r.error.issues[0]!.message);
  const v = r.data;
  let u: URL;
  try {
    u = new URL(v.baseUrl);
  } catch {
    throw bad("invalid_url");
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password)
    throw bad("invalid_url");
  try {
    await assertPublicHost(u.hostname, {
      mode: "vps",
      allowPrivate: env.allowPrivate,
      resolve: env.resolve,
    });
  } catch {
    throw bad("ai_host_not_public");
  }
  const old = await loadAiConfig(prisma, ws);
  const apiKey =
    v.apiKey ?? (old && new URL(old.baseUrl).origin === u.origin ? old.apiKey : undefined);
  if (!apiKey) throw bad("api_key_required");
  const cfg: AiConfig = {
    baseUrl: v.baseUrl,
    apiKey,
    model: v.model,
    classifierEnabled: v.classifierEnabled,
    ...(v.inputPricePerMTok !== undefined && { inputPricePerMTok: v.inputPricePerMTok }),
    ...(v.outputPricePerMTok !== undefined && { outputPricePerMTok: v.outputPricePerMTok }),
  };
  await prisma.$transaction(async (tx) => {
    await tx.workspace.update({
      where: { id: ws },
      data: { aiConfigEnc: encrypt(JSON.stringify(cfg)) },
    });
    await audit(tx, { workspaceId: ws, actorId }, "ai.settings", ws, {
      model: cfg.model,
      classifierEnabled: cfg.classifierEnabled,
    });
  });
}
