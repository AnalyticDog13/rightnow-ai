import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { ProviderError, TransientBeforeSendError } from "./errors";

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
  ["192.0.2.0", 24], // TEST-NET-1..3
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3], // multicast, reserved, broadcast
] as const)
  blocked.addSubnet(net, bits, "ipv4");
blocked.addAddress("::", "ipv6");
blocked.addAddress("::1", "ipv6");
blocked.addSubnet("fc00::", 7, "ipv6"); // ULA
blocked.addSubnet("fe80::", 10, "ipv6"); // link-local
blocked.addSubnet("fec0::", 10, "ipv6"); // site-local (deprecated)
blocked.addSubnet("ff00::", 8, "ipv6"); // multicast
// R11 (M7): IPv4-translated, local-use NAT64, Teredo, discard-only, documentation
blocked.addSubnet("::ffff:0:0:0", 96, "ipv6");
blocked.addSubnet("64:ff9b:1::", 48, "ipv6");
blocked.addSubnet("2001::", 32, "ipv6");
blocked.addSubnet("100::", 64, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");

// R24: cloud metadata and link-local stay refused even with allowPrivate (that flag is for LAN services)
const metadata = new BlockList();
metadata.addSubnet("169.254.0.0", 16, "ipv4");
metadata.addSubnet("fe80::", 10, "ipv6");
metadata.addAddress("fd00:ec2::254", "ipv6");
metadata.addAddress("100.100.100.200", "ipv4"); // Alibaba Cloud
metadata.addAddress("192.0.0.192", "ipv4"); // Oracle Cloud
const METADATA_NAMES = new Set(["metadata.google.internal"]);

/** Parses any textual IPv6 form (compressed, expanded, mixed ::ffff:a.b.c.d) to 16 bytes. */
function v6Bytes(ip: string): number[] {
  let s = ip.split("%")[0]!;
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    s = s.slice(0, v4.index) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const [head = "", tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  return groups.flatMap((g) => {
    const n = parseInt(g, 16);
    return [n >> 8, n & 255];
  });
}

/** The IPv4 embedded in IPv4-mapped (::ffff:0:0/96), IPv4-compatible (::/96) or NAT64 (64:ff9b::/96) IPv6, else null. */
function embeddedV4(ip: string): string | null {
  if (isIP(ip) !== 6) return null;
  const b = v6Bytes(ip);
  const zero = (n: number) => b.slice(0, n).every((x) => x === 0);
  const mapped = zero(10) && b[10] === 255 && b[11] === 255;
  const nat64 =
    b[0] === 0 &&
    b[1] === 0x64 &&
    b[2] === 0xff &&
    b[3] === 0x9b &&
    b.slice(4, 12).every((x) => x === 0);
  if (b[0] === 0x20 && b[1] === 0x02) return b.slice(2, 6).join("."); // 6to4 (2002::/16)
  if (zero(15) && b[15]! <= 1) return null; // only :: and ::1 are checked as IPv6; ::2 .. ::ff are 0.0.0.x
  if (!mapped && !nat64 && !zero(12)) return null;
  return b.slice(12).join(".");
}

const inList = (l: BlockList, ip: string) => {
  const v4 = embeddedV4(ip);
  if (v4) return l.check(v4, "ipv4");
  return l.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");
};
export const isPrivate = (ip: string): boolean => inList(blocked, ip);
const isMetadata = (ip: string) => inList(metadata, ip);

const isLoopback = (ip: string) => {
  const a = embeddedV4(ip) ?? ip;
  return a === "::1" || /^127\./.test(a);
};

/**
 * Resolve `host` and, in vps mode without allowPrivate, refuse if ANY address is internal. Cloud metadata and
 * link-local are refused in every mode (R24). Callers connect to `address` with TLS `servername`.
 */
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
  const nonPublic = () => new ProviderError(`host ${host} resolves to a non-public address`);
  if (METADATA_NAMES.has(bare.toLowerCase().replace(/\.$/, ""))) throw nonPublic();
  let addrs: string[];
  try {
    addrs = isIP(bare) ? [bare] : await resolve(bare);
  } catch (e) {
    // DNS failure is transient and happens before anything is sent
    throw new TransientBeforeSendError(
      `dns lookup failed for ${host}: ${(e as NodeJS.ErrnoException).code ?? "error"}`,
    );
  }
  if (addrs.length === 0)
    throw new TransientBeforeSendError(`dns lookup for ${host} returned nothing`);
  if (addrs.some(isMetadata) || (o.mode === "vps" && !o.allowPrivate && addrs.some(isPrivate)))
    throw nonPublic();
  return { address: addrs[0]!, servername: host, loopback: isLoopback(addrs[0]!) };
}
