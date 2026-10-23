import { describe, expect, it } from "vitest";
import { ProviderError, assertPublicHost } from "../src";

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
    "0:0:0:0:0:ffff:a00:5",
    "0000:0000:0000:0000:0000:ffff:0a00:0005",
    "0:0:0:0:0:ffff:10.0.0.5",
    "::10.0.0.5",
    "::2",
    "::0.0.0.5",
    "::ff",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "64:ff9b::a00:5",
    "0:0:0:0:0:0:0:1",
    "fe80::1",
    "fec0::1",
    "ff02::1",
    "2002:a00:5::1",
    "2002:7f00:1::",
    "192.0.2.1",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "0.1.2.3",
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

  it("a host resolving to ::1 is loopback; :: and ::1 are not read as IPv4", async () => {
    const r = await assertPublicHost("localhost", {
      mode: "local",
      allowPrivate: false,
      resolve: dns({ localhost: ["::1"] }),
    });
    expect(r.loopback).toBe(true);
    expect(
      (await assertPublicHost("::ffff:127.0.0.1", { mode: "local", allowPrivate: false })).loopback,
    ).toBe(true);
  });

  it("a public 6to4 address passes and DNS failures become ProviderError", async () => {
    expect((await assertPublicHost("2002:5db8:d822::1", vps)).loopback).toBe(false);
    const resolve = async () => {
      throw Object.assign(new Error("boom"), { code: "ENOTFOUND" });
    };
    await expect(assertPublicHost("nx.example", { ...vps, resolve })).rejects.toBeInstanceOf(
      ProviderError,
    );
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

describe("R11 ranges and R24 metadata", () => {
  it.each([
    "::ffff:0:7f00:1", // IPv4-translated ::ffff:0:0:0/96
    "::ffff:0:808:808",
    "64:ff9b:1::1", // local-use NAT64
    "2001::1", // Teredo
    "100::1", // discard-only
    "2001:db8::1", // documentation
  ])("vps rejects new range %s", async (ip) => {
    await expect(assertPublicHost(ip, vps)).rejects.toThrow(/non-public/);
  });

  it.each([
    "169.254.169.254",
    "169.254.1.1",
    "fd00:ec2::254",
    "fe80::1",
    "::ffff:169.254.169.254",
    "100.100.100.200", // Alibaba Cloud
    "192.0.0.192", // Oracle Cloud
  ])("metadata and link-local %s stay refused with allowPrivate in every mode", async (ip) => {
    for (const mode of ["vps", "local"] as const)
      await expect(assertPublicHost(ip, { mode, allowPrivate: true })).rejects.toThrow(
        /non-public/,
      );
  });

  it("metadata.google.internal is refused by name, and by what it resolves to", async () => {
    const resolve = dns({ "md.example": ["169.254.169.254"] });
    for (const h of ["metadata.google.internal", "METADATA.google.internal."])
      await expect(
        assertPublicHost(h, { mode: "vps", allowPrivate: true, resolve: async () => ["8.8.8.8"] }),
      ).rejects.toThrow(/non-public/);
    await expect(
      assertPublicHost("md.example", { mode: "vps", allowPrivate: true, resolve }),
    ).rejects.toThrow(/non-public/);
  });

  it("allowPrivate still lets LAN addresses through", async () => {
    for (const ip of ["10.0.0.5", "192.168.1.5"])
      expect((await assertPublicHost(ip, { mode: "vps", allowPrivate: true })).address).toBe(ip);
  });

  it("a public 8.8.8.8 and 2606:4700::1111 still pass", async () => {
    expect((await assertPublicHost("8.8.8.8", vps)).address).toBe("8.8.8.8");
    expect((await assertPublicHost("2606:4700::1111", vps)).address).toBe("2606:4700::1111");
  });
});
