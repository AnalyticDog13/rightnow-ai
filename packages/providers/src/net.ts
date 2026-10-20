import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { ProviderError } from "./errors";

const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], // "this network" incl. 0.0.0.0
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local incl. cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3], // multicast, reserved, broadcast
] as const)
  blocked.addSubnet(net, bits, "ipv4");
blocked.addAddress("::", "ipv6");
blocked.addAddress("::1", "ipv6");
blocked.addSubnet("fc00::", 7, "ipv6"); // ULA
blocked.addSubnet("fe80::", 10, "ipv6"); // link-local

/** IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:hhhh:hhhh) -> the IPv4 string, else null. */
function mappedV4(ip: string): string | null {
  const m = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(ip);
  if (!m) return null;
  if (m[1]) return m[1];
  const hi = parseInt(m[2]!, 16);
  const lo = parseInt(m[3]!, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function isPrivate(ip: string): boolean {
  const v4 = mappedV4(ip);
  if (v4) return blocked.check(v4, "ipv4");
  return blocked.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");
}

const isLoopback = (ip: string) => {
  const a = mappedV4(ip) ?? ip;
  return a === "::1" || /^127\./.test(a);
};

/** Resolve `host` and, in vps mode without allowPrivate, refuse if ANY address is internal. Callers connect to `address` with TLS `servername`. */
export async function assertPublicHost(
  host: string,
  o: {
    mode: "local" | "vps";
    allowPrivate: boolean;
    resolve?: (host: string) => Promise<string[]>; // injectable for tests
  },
): Promise<{ address: string; servername: string; loopback: boolean }> {
  const bare = host.replace(/^\[|\]$/g, "");
  const resolve =
    o.resolve ??
    (async (h) => (await lookup(h, { all: true, verbatim: true })).map((a) => a.address));
  const addrs = isIP(bare) ? [bare] : await resolve(bare);
  if (addrs.length === 0) throw new ProviderError(`host ${host} did not resolve`);
  if (o.mode === "vps" && !o.allowPrivate && addrs.some(isPrivate))
    throw new ProviderError(`host ${host} resolves to a non-public address`);
  return { address: addrs[0]!, servername: host, loopback: isLoopback(addrs[0]!) };
}
