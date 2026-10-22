-- AlterTable
ALTER TABLE "EmailAccount" ADD COLUMN     "lastSyncAttemptAt" TIMESTAMP(3),
ADD COLUMN     "syncErrors" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "syncLeaseId" TEXT,
ADD COLUMN     "syncLeaseUntil" TIMESTAMP(3),
ADD COLUMN     "syncProgress" JSONB;
