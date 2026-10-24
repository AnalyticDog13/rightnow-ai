// Usage: DATABASE_URL=... npx tsx scripts/disable-2fa.ts <email>
// Recovery for a user who lost both the authenticator app and the backup codes (docs/ops/LOCAL.md). The user signs in
// with the password alone and can enrol again in Settings > Security. Audited as `auth.2fa_disable` with `via: "ops"`.
import { audit } from "../packages/core/src/index";
import { prisma } from "../packages/db/src/index";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) throw new Error("Usage: npx tsx scripts/disable-2fa.ts <email>");

try {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, members: { select: { workspaceId: true }, take: 1 } },
  });
  if (!user) throw new Error(`No user ${email}`);
  await prisma.$transaction(async (tx) => {
    await tx.twoFactor.deleteMany({ where: { userId: user.id } });
    await tx.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    const workspaceId = user.members[0]?.workspaceId;
    if (workspaceId)
      await audit(tx, { workspaceId, actorId: null }, "auth.2fa_disable", user.id, { via: "ops" });
  });
  console.log(`Two-factor is off for ${email}; their sessions were ended.`);
} finally {
  await prisma.$disconnect();
}
