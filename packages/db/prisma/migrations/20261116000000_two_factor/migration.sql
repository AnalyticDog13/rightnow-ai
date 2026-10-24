-- AlterTable
ALTER TABLE "User" ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN "createdById" TEXT;

-- CreateTable
CREATE TABLE "TwoFactor" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "TwoFactor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TwoFactor_userId_idx" ON "TwoFactor"("userId");

-- AddForeignKey
ALTER TABLE "TwoFactor" ADD CONSTRAINT "TwoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keys made before createdById existed: the audit row of their creation names the creator.
UPDATE "ApiKey" k SET "createdById" = a."actorId" FROM "AuditLog" a
WHERE a.action = 'apikey.create' AND a.target = k.id AND k."createdById" IS NULL AND a."actorId" IS NOT NULL;

-- AlterTable: set by the server (route or import), never from input
ALTER TABLE "Lead" ADD COLUMN "uploadMethod" TEXT;

-- Audit rows written before the invitation id left the audit log: the id is the join secret. Targets become the invited
-- email and `email` leaves meta, as new rows are written.
UPDATE "AuditLog" SET target = meta->>'email', meta = meta - 'email' WHERE action = 'member.invite' AND meta ? 'email';
UPDATE "AuditLog" l SET target = i.email FROM "Invitation" i WHERE l.action = 'member.invite_cancel' AND l.target = i.id;
UPDATE "AuditLog" SET target = NULL WHERE action IN ('member.invite', 'member.invite_cancel') AND (target IS NULL OR target NOT LIKE '%@%');
