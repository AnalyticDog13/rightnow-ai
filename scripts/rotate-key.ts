// Usage: OLD_ENCRYPTION_KEY=... NEW_ENCRYPTION_KEY=... DATABASE_URL=... npx tsx scripts/rotate-key.ts
// Compose: scripts/rotate-key.sh|.ps1. See docs/ops/KEY_ROTATION.md. Safe to rerun: values already on the new key are skipped.
import { ENCRYPTED_COLUMNS, rotateColumns } from "../packages/core/src/index";
import { prisma } from "../packages/db/src/index";

function keyFromEnv(name: string): Buffer {
  const k = Buffer.from(process.env[name] ?? "", "base64");
  if (k.length !== 32) throw new Error(`${name} must be base64 that decodes to 32 bytes`);
  return k;
}

const oldKey = keyFromEnv("OLD_ENCRYPTION_KEY");
const newKey = keyFromEnv("NEW_ENCRYPTION_KEY");
if (oldKey.equals(newKey)) throw new Error("Old and new keys are identical");

try {
  for (const [col, n] of Object.entries(
    await rotateColumns(prisma, ENCRYPTED_COLUMNS, oldKey, newKey),
  ))
    console.log(`${col}: re-encrypted ${n}`);
  console.log("Done. Now set ENCRYPTION_KEY to the new key and start the apps.");
} finally {
  await prisma.$disconnect();
}
