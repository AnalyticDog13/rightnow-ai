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
    expect(() => parseEnv({ ...good, ENCRYPTION_KEY: randomBytes(16).toString("base64") })).toThrow(
      /ENCRYPTION_KEY/,
    );
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

describe("mail provider env", () => {
  test("Google/MS vars are optional; MS_TENANT defaults to common", () => {
    const e = parseEnv(good);
    expect(e.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(e.MS_TENANT).toBe("common");
  });

  test("empty flag values (Compose passes unset vars as empty) mean off", () => {
    const e = parseEnv({ ...good, MAIL_PROVIDER_FAKE: "", ALLOW_PRIVATE_MAIL_HOSTS: "" });
    expect(e.MAIL_PROVIDER_FAKE).toBeUndefined();
    expect(e.ALLOW_PRIVATE_MAIL_HOSTS).toBeUndefined();
    expect(() => parseEnv({ ...good, MAIL_PROVIDER_FAKE: "true" })).toThrow(/MAIL_PROVIDER_FAKE/);
  });

  test("MAIL_PROVIDER_FAKE=1 is refused in vps mode, naming the var", () => {
    expect(() => parseEnv({ ...good, MODE: "vps", MAIL_PROVIDER_FAKE: "1" })).toThrow(
      /MAIL_PROVIDER_FAKE/,
    );
    expect(parseEnv({ ...good, MODE: "local", MAIL_PROVIDER_FAKE: "1" }).MAIL_PROVIDER_FAKE).toBe(
      "1",
    );
  });
  test("SEND_LEASE_SEC defaults to 600 and must be >= 120 unless the Fake runs", () => {
    expect(parseEnv(good).SEND_LEASE_SEC).toBe(600);
    expect(() => parseEnv({ ...good, SEND_LEASE_SEC: "60" })).toThrow(/SEND_LEASE_SEC/);
    expect(
      parseEnv({ ...good, SEND_LEASE_SEC: "60", MAIL_PROVIDER_FAKE: "1" }).SEND_LEASE_SEC,
    ).toBe(60);
  });
});
