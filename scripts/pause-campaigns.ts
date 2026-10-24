// Usage (Compose): `docker compose run --rm --no-deps migrate pause-campaigns` (called by scripts/restore.sh|.ps1).
import { pauseActiveCampaigns } from "../packages/core/src/index";
import { prisma } from "../packages/db/src/index";

try {
  const n = await pauseActiveCampaigns(prisma);
  console.log(`paused ${n} active campaign(s)`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
