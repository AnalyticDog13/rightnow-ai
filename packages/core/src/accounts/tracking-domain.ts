import dns from "node:dns";
import type { CnameStatus } from "@rightnow/db/client";

export type CnameResolver = (host: string) => Promise<string[]>;

/** VERIFIED when `domain` has a CNAME pointing at `expectedTarget`; any lookup failure is FAILED. */
export async function verifyCname(
  domain: string,
  expectedTarget: string,
  resolveCname: CnameResolver = dns.promises.resolveCname,
): Promise<CnameStatus> {
  const norm = (s: string) => s.toLowerCase().replace(/\.$/, "");
  try {
    const targets = await resolveCname(domain);
    return targets.some((t) => norm(t) === norm(expectedTarget)) ? "VERIFIED" : "FAILED";
  } catch {
    return "FAILED";
  }
}
