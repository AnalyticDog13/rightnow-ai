import type { PrismaClient } from "@rightnow/db/client";
import { skipOrReencrypt } from "./crypto";

type Delegate = {
  findMany(a: unknown): Promise<Array<Record<string, unknown>>>;
  update(a: unknown): Promise<unknown>;
};

/**
 * Re-encrypts every column from oldKey to newKey; returns rows changed per `Model.field`.
 * One transaction per column: a value neither key decrypts aborts that column, leaving it untouched.
 * Values already on newKey are skipped, so a rerun is safe.
 */
export async function rotateColumns(
  prisma: PrismaClient,
  cols: Array<{ model: string; field: string }>,
  oldKey: Buffer,
  newKey: Buffer,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const { model, field } of cols) {
    const name = `${model}.${field}`;
    out[name] = await prisma.$transaction(
      async (tx) => {
        const d = (tx as unknown as Record<string, Delegate>)[
          model.charAt(0).toLowerCase() + model.slice(1)
        ];
        if (!d) throw new Error(`Unknown model ${model}`);
        // no `{ not: null }` filter: Prisma rejects it on required columns (OAuthSession.codeVerifierEnc)
        const rows = await d.findMany({ select: { id: true, [field]: true } });
        let changed = 0;
        for (const r of rows) {
          if (r[field] == null) continue;
          let next: string | null;
          try {
            next = skipOrReencrypt(r[field] as string, oldKey, newKey);
          } catch {
            throw new Error(
              `${name}: row ${String(r.id)} decrypts with neither key; column left unchanged`,
            );
          }
          if (next === null) continue;
          await d.update({ where: { id: r.id }, data: { [field]: next } });
          changed++;
        }
        return changed;
      },
      { timeout: 10 * 60_000 },
    );
  }
  return out;
}
