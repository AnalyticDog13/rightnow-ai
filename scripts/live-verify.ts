// Usage: npx tsx scripts/live-verify.ts --account <accountId> --to <your address>
// Needs DATABASE_URL, ENCRYPTION_KEY and the provider's OAuth env. Sends ONE real message. See docs/ops/LIVE_VERIFICATION.md.
import { createProvider, liveVerify, systemClock } from "../packages/core/src/index";
import { prisma } from "../packages/db/src/index";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const id = arg("account");
const to = arg("to");
if (!id || !to) {
  console.error("Usage: npx tsx scripts/live-verify.ts --account <id> --to <address>");
  process.exit(2);
}

try {
  const account = await prisma.emailAccount.findFirst({ where: { id, deletedAt: null } });
  if (!account) throw new Error(`account ${id} not found`);
  const steps = await liveVerify(createProvider(account, { prisma }), to, systemClock);
  for (const s of steps)
    console.log(`${s.ok ? "PASS" : "FAIL"} ${s.step}${s.detail ? ` (${s.detail})` : ""}`);
  process.exitCode = steps.some((s) => !s.ok) ? 1 : 0;
} finally {
  await prisma.$disconnect();
}
