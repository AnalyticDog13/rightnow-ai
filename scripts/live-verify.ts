// Usage: npx tsx scripts/live-verify.ts --account <accountId> --to <your address>
// Needs DATABASE_URL, ENCRYPTION_KEY and the provider's OAuth env. Sends ONE real message. See docs/ops/LIVE_VERIFICATION.md.
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const id = arg("account");
const to = arg("to");
if (process.env.MAIL_PROVIDER_FAKE) {
  // The Fake would print PASS for everything and falsely clear the P3-T11 gate.
  console.error(
    "Refusing to run: MAIL_PROVIDER_FAKE is set. Live verification needs the real provider.",
  );
  process.exit(2);
}
if (!id || !to) {
  console.error("Usage: npx tsx scripts/live-verify.ts --account <id> --to <address>");
  process.exit(2);
}

const { createProvider, liveVerify, systemClock } = await import("../packages/core/src/index");
const { prisma } = await import("../packages/db/src/index");
try {
  const account = await prisma.emailAccount.findFirst({ where: { id, deletedAt: null } });
  if (!account) throw new Error(`account ${id} not found`);
  const provider = createProvider(account, { prisma });
  console.log(`Verifying ${provider.kind} ${provider.address}`);
  const steps = await liveVerify(provider, to, systemClock);
  for (const s of steps)
    console.log(`${s.ok ? "PASS" : "FAIL"} ${s.step}${s.detail ? ` (${s.detail})` : ""}`);
  process.exitCode = steps.some((s) => !s.ok) ? 1 : 0;
} finally {
  await prisma.$disconnect();
}
