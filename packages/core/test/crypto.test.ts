import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { decrypt, encrypt, reencrypt, skipOrReencrypt } from "../src/crypto";

const key = randomBytes(32);

describe("crypto", () => {
  test("round-trips unicode", () => {
    const s = "pässwörd 🔑 日本語";
    const enc = encrypt(s, key);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(decrypt(enc, key)).toBe(s);
  });

  test("uses a fresh iv each time", () => {
    expect(encrypt("a", key)).not.toBe(encrypt("a", key));
  });

  test("flipped byte throws", () => {
    const buf = Buffer.from(encrypt("secret", key).slice(3), "base64");
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 1;
    expect(() => decrypt("v1:" + buf.toString("base64"), key)).toThrow();
  });

  test("other key throws", () => {
    expect(() => decrypt(encrypt("secret", key), randomBytes(32))).toThrow();
  });

  test("unsupported version throws", () => {
    expect(() => decrypt("v2:abcd", key)).toThrow(/unsupported/i);
  });

  test("key not 32 bytes throws", () => {
    expect(() => encrypt("x", randomBytes(16))).toThrow(/32 bytes/);
    expect(() => decrypt("v1:abcd", randomBytes(16))).toThrow(/32 bytes/);
  });

  test("truncated payload throws", () => {
    expect(() => decrypt("v1:AAAA", key)).toThrow();
  });

  test("reencrypt moves a value to the new key", () => {
    const k2 = randomBytes(32);
    const out = reencrypt(encrypt("tok", key), key, k2);
    expect(decrypt(out, k2)).toBe("tok");
    expect(() => decrypt(out, key)).toThrow();
  });

  test("skipOrReencrypt skips values already on the new key", () => {
    const k2 = randomBytes(32);
    const done = encrypt("tok", k2);
    expect(skipOrReencrypt(done, key, k2)).toBeNull();
    const out = skipOrReencrypt(encrypt("tok", key), key, k2);
    expect(decrypt(out!, k2)).toBe("tok");
  });

  test("skipOrReencrypt throws when neither key works", () => {
    expect(() => skipOrReencrypt(encrypt("t", randomBytes(32)), key, randomBytes(32))).toThrow();
  });
});
