import { z } from "zod";

const key32 = z
  .string()
  .refine((s) => Buffer.from(s, "base64").length === 32, "must be base64 that decodes to exactly 32 bytes");

// Vars shared by every process; web and worker .extend() this with their own.
export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY: key32,
  MODE: z.enum(["local", "vps"]).default("local"),
  APP_URL: z.url(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  SYNC_MAX_STALENESS_SEC: z.coerce.number().int().positive().default(300),
});
export type Env = z.infer<typeof envSchema>;

/** Throws one error naming every bad var; values are never included. */
export function parseEnv<T extends z.ZodType = typeof envSchema>(
  source: Record<string, string | undefined>,
  schema: T = envSchema as unknown as T,
): z.infer<T> {
  const r = schema.safeParse(source);
  if (r.success) return r.data;
  const lines = r.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
  throw new Error(`Invalid environment:\n${lines.join("\n")}`);
}

let cached: Env | undefined;
export function getEnv(): Env {
  return (cached ??= parseEnv(process.env));
}
export function resetEnvCache(): void {
  cached = undefined;
}
