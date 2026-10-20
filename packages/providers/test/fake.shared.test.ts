import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { FakeProvider } from "../src";

let dir: string;
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), "rn-fake-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const mime = (n: number) => ({
  from: { email: "me@rn.test" },
  to: [{ email: "you@rn.test" }],
  subject: `s${n}`,
  text: "t",
  messageId: `<s${n}@rn.test>`,
});

it("two instances on one dir share state", async () => {
  const a = new FakeProvider("me@rn.test", { dir });
  const b = new FakeProvider("me@rn.test", { dir });
  await a.send(mime(1));
  expect((await b.findSent("<s1@rn.test>"))?.subject).toBe("s1");
});

it("20 concurrent sends across both instances lose nothing", async () => {
  const ps = [new FakeProvider("me@rn.test", { dir }), new FakeProvider("me@rn.test", { dir })];
  await Promise.all(Array.from({ length: 20 }, (_, i) => ps[i % 2]!.send(mime(i))));
  expect(await ps[0]!.sentRaw()).toHaveLength(20);
});

it("rejects an address that would escape the directory", () => {
  expect(() => new FakeProvider("../evil@rn.test", { dir })).toThrow();
});

it("diagnostics fail for a host starting with fail.", async () => {
  const p = new FakeProvider("me@rn.test", { dir, kind: "SMTP", host: "fail.example.test" });
  expect((await p.diagnostics()).ok).toBe(false);
});

it("clearFailures lifts a sticky auth_revoked", async () => {
  const p = new FakeProvider("me@rn.test", { dir });
  p.failNext("auth_revoked");
  await expect(p.send(mime(1))).rejects.toThrow();
  await expect(p.send(mime(2))).rejects.toThrow();
  p.clearFailures();
  await expect(p.send(mime(3))).resolves.toBeDefined();
  expect((await p.diagnostics()).ok).toBe(true);
});
