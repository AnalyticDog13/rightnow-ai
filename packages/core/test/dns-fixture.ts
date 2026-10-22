import type { DnsResolver } from "../src/deliverability/dns";

export type FakeRecord =
  string[][] | { mx: { exchange: string; priority: number }[] } | string[] | Error;

export const dnsError = (code: string) => Object.assign(new Error(code), { code });

/**
 * In-memory resolver. Key `name` answers every query type by value shape (TXT `string[][]`, MX `{mx}`, A and PTR
 * `string[]`); `name/TXT|MX|A|PTR` targets one type when a name has several. Missing = ENOTFOUND; the wrong shape = ENODATA.
 * An `Error` value is thrown (give it a `code` such as ETIMEOUT). `calls` records every query.
 */
export function fakeResolver(records: Record<string, FakeRecord>) {
  const calls: string[] = [];
  const get = (type: "TXT" | "MX" | "A" | "PTR", name: string) => {
    calls.push(`${type} ${name}`);
    const v = records[`${name}/${type}`] ?? records[name];
    if (v === undefined) throw dnsError("ENOTFOUND");
    if (v instanceof Error) throw v;
    const ok =
      type === "MX"
        ? !Array.isArray(v)
        : type === "TXT"
          ? Array.isArray(v) && Array.isArray(v[0])
          : Array.isArray(v) && typeof v[0] === "string";
    if (!ok) throw dnsError("ENODATA");
    return v;
  };
  const r: DnsResolver & { calls: string[] } = {
    calls,
    resolveTxt: async (n) => get("TXT", n) as string[][],
    resolveMx: async (n) => (get("MX", n) as { mx: { exchange: string; priority: number }[] }).mx,
    resolve4: async (n) => get("A", n) as string[],
    reverse: async (ip) => get("PTR", ip) as string[],
  };
  return r;
}
