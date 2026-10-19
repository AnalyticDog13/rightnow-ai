import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    TEST_PG_URL_BASE: string;
  }
}

const dbDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer().on("error", reject);
    s.listen(0, () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

export default async function setup(project: TestProject) {
  const dataDir = mkdtempSync(join(tmpdir(), "rn-pg-"));
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "pw",
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  const cleanup = async () => {
    await server.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  try {
    await server.initialise();
    await server.start();
    const base = `postgresql://postgres:pw@localhost:${port}`;
    const admin = new pg.Client({ connectionString: `${base}/postgres` });
    await admin.connect();
    try {
      await admin.query("CREATE DATABASE template_rn");
    } finally {
      await admin.end();
    }
    const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: dbDir,
      env: { ...process.env, DATABASE_URL: `${base}/template_rn` },
      stdio: "pipe",
    });
    project.provide("TEST_PG_URL_BASE", base);
  } catch (e) {
    await cleanup();
    throw e;
  }
  return cleanup;
}
