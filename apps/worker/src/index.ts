import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { envSchema, parseEnv } from "@rightnow/core";
import { z } from "zod";
import { startWorker } from "./boss";

export const workerEnvSchema = envSchema.extend({
  WORKER_HEALTH_PORT: z.coerce.number().int().min(0).default(8081),
});

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const env = parseEnv(process.env, workerEnvSchema);
const worker = await startWorker({
  databaseUrl: env.DATABASE_URL,
  healthPort: env.WORKER_HEALTH_PORT,
  poolMax: env.DB_POOL_MAX,
});
console.log(`worker ${worker.bootId} up, health on :${worker.healthPort}`);

let stopping = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    worker.stop().then(
      () => process.exit(0),
      (e) => {
        console.error("shutdown failed", e);
        process.exit(1);
      },
    );
  });
}
