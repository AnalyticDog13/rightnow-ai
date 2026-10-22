-- AlterEnum
ALTER TYPE "StopReason" ADD VALUE 'ACCOUNT_UNASSIGNED';
ALTER TYPE "StopReason" ADD VALUE 'COMPLAINED';

-- AlterEnum
ALTER TYPE "MessageKind" ADD VALUE 'COMPLAINT';

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'COMPLAINT';

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "bounceThresholdPct" DOUBLE PRECISION NOT NULL DEFAULT 3,
ADD COLUMN     "healthSlowdownPct" INTEGER NOT NULL DEFAULT 50;

-- AlterTable
ALTER TABLE "EmailAccount" ADD COLUMN     "healthCap" INTEGER,
ADD COLUMN     "healthCapAt" TIMESTAMP(3),
ADD COLUMN     "healthResetAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "bounceProtectResetAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "HealthSnapshot" (
    "accountId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "score" INTEGER NOT NULL,

    CONSTRAINT "HealthSnapshot_pkey" PRIMARY KEY ("accountId","day")
);

-- AddForeignKey
ALTER TABLE "HealthSnapshot" ADD CONSTRAINT "HealthSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
