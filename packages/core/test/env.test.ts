import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, test } from "vitest";
import { getEnv, parseEnv, resetEnvCache } from "../src/env";

const good = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  APP_URL: "http://localhost:3000",
};

beforeEach(resetEnvCache);

describe("env", () => {
  test("applies defaults", () => {
    const e = parseEnv(good);
    expect(e.MODE).toBe("local");
    expect(e.SYNC_MAX_STALENESS_SEC).toBe(300);
    expect(e.DB_POOL_MAX).toBe(10);
  });

  test("lists every bad var without printing values", () => {
    const secret = Buffer.from("short-secret-key").toString("base64");
    let msg = "";
    try {
      parseEnv({ ENCRYPTION_KEY: secret, MODE: "cloud" });
    } catch (e) {
      msg = (e as Error).message;
    }
    for (const v of ["DATABASE_URL", "ENCRYPTION_KEY", "MODE", "APP_URL"]) expect(msg).toContain(v);
    expect(msg).not.toContain(secret);
  });

  test("key must decode to 32 bytes", () => {
    expect(() => parseEnv({ ...good, ENCRYPTION_KEY: randomBytes(16).toString("base64") })).toThrow(/ENCRYPTION_KEY/);
  });

  test("getEnv memoizes", () => {
    const old = { ...process.env };
    Object.assign(process.env, good, { MODE: "local" }); // vitest itself sets MODE=test
    try {
      expect(getEnv()).toBe(getEnv());
    } finally {
      process.env = old;
    }
  });
});
