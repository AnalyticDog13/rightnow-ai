import { describe, expect, it } from "vitest";
import { assertPublicHost } from "../src";

const vps = { mode: "vps" as const, allowPrivate: false };
const dns = (m: Record<string, string[]>) => async (h: string) => m[h] ?? [];

describe("assertPublicHost", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "fd00::1",
    "::1",
    "0.0.0.0",
    "::",
    "::ffff:10.0.0.5",
    "::ffff:a00:5",
  ])("vps rejects literal %s", async (ip) => {
    await expect(assertPublicHost(ip, { ...vps, resolve: dns({}) })).rejects.toThrow();
  });

  it("rejects hostnames resolving to any private address", async () => {
    const resolve = dns({ a: ["10.0.0.5"], b: ["93.184.216.34", "192.168.0.1"], c: ["fd00::1"] });
    for (const h of ["a", "b", "c"])
      await expect(assertPublicHost(h, { ...vps, resolve })).rejects.toThrow();
  });

  it("passes a public address with servername = hostname", async () => {
    const r = await assertPublicHost("mail.example.com", {
      ...vps,
      resolve: dns({ "mail.example.com": ["93.184.216.34"] }),
    });
    expect(r).toEqual({
      address: "93.184.216.34",
      servername: "mail.example.com",
      loopback: false,
    });
    expect((await assertPublicHost("2606:4700::1111", vps)).address).toBe("2606:4700::1111");
  });

  it("allowPrivate and local mode pass", async () => {
    expect((await assertPublicHost("10.0.0.5", { mode: "vps", allowPrivate: true })).address).toBe(
      "10.0.0.5",
    );
    expect(
      await assertPublicHost("127.0.0.1", { mode: "local", allowPrivate: false }),
    ).toMatchObject({
      loopback: true,
    });
  });
});
