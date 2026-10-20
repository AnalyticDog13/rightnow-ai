import { envSchema, parseEnv } from "@rightnow/core";
import { z } from "zod";

export const webEnvSchema = envSchema.extend({
  BETTER_AUTH_SECRET: z.string().min(32),
  SETUP_TOKEN: z.string().min(16),
});

let cached: z.infer<typeof webEnvSchema> | undefined;
export const getWebEnv = () => (cached ??= parseEnv(process.env, webEnvSchema));
export const resetWebEnvCache = () => {
  cached = undefined;
};
