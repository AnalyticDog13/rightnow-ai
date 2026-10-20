import { z } from "zod";

const key32 = z
  .string()
  .refine(
    (s) => Buffer.from(s, "base64").length === 32,
    "must be base64 that decodes to exactly 32 bytes",
  );

// Vars shared by every process; web and worker .extend() this with their own.
export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY: key32,
  MODE: z.enum(["local", "vps"]).default("local"),
  APP_URL: z.url(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  SYNC_MAX_STALENESS_SEC: z.coerce.number().int().positive().default(300),
  // Mail providers (all optional: an unconfigured provider answers 412 not_configured)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MS_CLIENT_ID: z.string().optional(),
  MS_CLIENT_SECRET: z.string().optional(),
  MS_TENANT: z.string().default("common"),
  ALLOW_PRIVATE_MAIL_HOSTS: z.literal("1").optional(),
  FAKE_MAIL_DIR: z.string().optional(),
  MAIL_PROVIDER_FAKE: z.literal("1").optional(),
});
export type Env = z.infer<typeof envSchema>;

/** Throws one error naming every bad var; values are never included. */
export function parseEnv<T extends z.ZodType = typeof envSchema>(
  source: Record<string, string | undefined>,
  schema: T = envSchema as unknown as T,
): z.infer<T> {
  const r = schema.safeParse(source);
  const lines = r.success ? [] : r.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
  // a refine() here would break the .extend() the web and worker schemas do
  if (source.MAIL_PROVIDER_FAKE === "1" && source.MODE === "vps")
    lines.push("  MAIL_PROVIDER_FAKE: must not be set when MODE=vps");
  if (r.success && lines.length === 0) return r.data;
  throw new Error(`Invalid environment:\n${lines.join("\n")}`);
}

let cached: Env | undefined;
export function getEnv(): Env {
  return (cached ??= parseEnv(process.env));
}
export function resetEnvCache(): void {
  cached = undefined;
}
