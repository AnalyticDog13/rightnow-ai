import { createHash } from "node:crypto";

/** Deterministic index in [0, n): sha256(seed:index), first 48 bits mod n. */
export function pick(seed: string, index: number, n: number): number {
  const h = createHash("sha256").update(`${seed}:${index}`).digest();
  return h.readUIntBE(0, 6) % n;
}
