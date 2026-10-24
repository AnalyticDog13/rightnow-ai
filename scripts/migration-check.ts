// Usage: DATABASE_URL=... ENCRYPTION_KEY=... npx tsx scripts/migration-check.ts seed|verify
// Compose: `docker compose run --rm --no-deps migrate migration-check seed|verify` (CI compose-smoke, PS-DEPLOY-11).
import {
  seedMigrationFixture,
  systemClock,
  verifyMigrationFixture,
} from "../packages/core/src/index";
import { prisma } from "../packages/db/src/index";

const cmd = process.argv[2];
try {
  if (cmd === "seed") await seedMigrationFixture(prisma, systemClock);
  else if (cmd === "verify") await verifyMigrationFixture(prisma);
  else throw new Error("usage: migration-check seed|verify");
  console.log(`migration-check ${cmd}: ok`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
