// Usage: OLD_ENCRYPTION_KEY=... NEW_ENCRYPTION_KEY=... DATABASE_URL=... npx tsx scripts/rotate-key.ts
// See docs/ops/KEY_ROTATION.md. Safe to rerun: values already on the new key are skipped.
import { ENCRYPTED_COLUMNS, skipOrReencrypt } from "../packages/core/src/index";
import { prisma } from "../packages/db/src/index";

function keyFromEnv(name: string): Buffer {
  const k = Buffer.from(process.env[name] ?? "", "base64");
  if (k.length !== 32) throw new Error(`${name} must be base64 that decodes to 32 bytes`);
  return k;
}

const oldKey = keyFromEnv("OLD_ENCRYPTION_KEY");
const newKey = keyFromEnv("NEW_ENCRYPTION_KEY");
if (oldKey.equals(newKey)) throw new Error("Old and new keys are identical");

type Delegate = {
  findMany(a: unknown): Promise<Array<Record<string, unknown>>>;
  update(a: unknown): Promise<unknown>;
};

try {
  for (const { model, field } of ENCRYPTED_COLUMNS) {
    let changed = 0;
    // One transaction per column: any undecryptable value aborts it and leaves the column untouched.
    await prisma.$transaction(
      async (tx) => {
        const d = (tx as unknown as Record<string, Delegate>)[model.charAt(0).toLowerCase() + model.slice(1)];
        if (!d) throw new Error(`Unknown model ${model}`);
        const rows = await d.findMany({ where: { [field]: { not: null } }, select: { id: true, [field]: true } });
        for (const r of rows) {
          const next = skipOrReencrypt(r[field] as string, oldKey, newKey);
          if (next === null) continue;
          await d.update({ where: { id: r.id }, data: { [field]: next } });
          changed++;
        }
      },
      { timeout: 10 * 60_000 },
    );
    console.log(`${model}.${field}: re-encrypted ${changed}`);
  }
  console.log("Done. Now set ENCRYPTION_KEY to the new key and start the apps.");
} finally {
  await prisma.$disconnect();
}
