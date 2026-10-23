-- CreateEnum
CREATE TYPE "AutoRewarm" AS ENUM ('OFF', 'RECOMMEND', 'AUTO');

-- AlterTable
ALTER TABLE "EmailAccount" ADD COLUMN     "activityResetAt" TIMESTAMP(3),
ADD COLUMN     "rewarmIncrementPerDay" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "rewarmLastSendDay" DATE,
ADD COLUMN     "rewarmPrevious" JSONB,
ADD COLUMN     "rewarmSendDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rewarmStartVolume" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "rewarmStartedAt" TIMESTAMP(3),
ADD COLUMN     "rewarmTarget" INTEGER;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "autoRewarm" "AutoRewarm" NOT NULL DEFAULT 'AUTO',
ADD COLUMN     "inactivityDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "rewarmExitCleanDays" INTEGER NOT NULL DEFAULT 3;
