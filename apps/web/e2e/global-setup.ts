import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import dbSetup from "@rightnow/db/global-setup";
import { E2E_PORT, SETUP_TOKEN } from "./env";

const webDir = fileURLToPath(new URL("..", import.meta.url));

// Boots the shared embedded-postgres harness (migrated template DB), then `next dev` against it.
export default async function setup() {
  let base = "";
  const stopDb = await dbSetup({ provide: (_k: string, v: string) => (base = v) } as never);
  const env = {
    ...process.env,
    DATABASE_URL: `${base}/template_rn`,
    APP_URL: `http://localhost:${E2E_PORT}`,
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    BETTER_AUTH_SECRET: "e2e-better-auth-secret-0123456789abcdef",
    SETUP_TOKEN,
    MAIL_PROVIDER_FAKE: "1",
    FAKE_MAIL_DIR: mkdtempSync(join(tmpdir(), "rn-e2e-mail-")),
  };
  const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
  const server = spawn(process.execPath, [next, "dev", "-p", String(E2E_PORT)], {
    cwd: webDir,
    env,
    stdio: "ignore",
  });
  const stop = async () => {
    // kill the whole tree: next dev spawns workers
    if (process.platform === "win32") {
      try {
        execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        /* already gone */
      }
    } else server.kill("SIGKILL");
    await stopDb?.();
  };
  try {
    const deadline = Date.now() + 120_000;
    for (;;) {
      if (server.exitCode !== null) throw new Error("next dev exited early");
      if (
        await fetch(`http://localhost:${E2E_PORT}/api/healthz`).then(
          (r) => r.ok,
          () => false,
        )
      )
        break;
      if (Date.now() > deadline) throw new Error("next dev did not become ready in 120s");
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (e) {
    await stop();
    throw e;
  }
  return stop;
}
