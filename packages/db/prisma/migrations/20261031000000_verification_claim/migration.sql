-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "verifyAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verifyClaimedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "verifierLastError" TEXT,
ADD COLUMN     "verifierLastErrorAt" TIMESTAMP(3);
