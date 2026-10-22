-- CreateEnum
CREATE TYPE "WarmupKind" AS ENUM ('SEND', 'REPLY', 'PLACEMENT');

-- CreateEnum
CREATE TYPE "WarmupStatus" AS ENUM ('PLANNED', 'SENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "EmailAccount" ADD COLUMN     "lastWarmupAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WarmupSettings" (
    "accountId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dailyLimit" INTEGER NOT NULL DEFAULT 10,
    "slowWarmup" BOOLEAN NOT NULL DEFAULT true,
    "startVolume" INTEGER NOT NULL DEFAULT 1,
    "increasePerDay" INTEGER NOT NULL DEFAULT 1,
    "customCurve" JSONB,
    "replyRatePct" INTEGER NOT NULL DEFAULT 30,
    "weekdaysOnly" BOOLEAN NOT NULL DEFAULT false,
    "filterTag" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "nextAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarmupSettings_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "WarmupMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fromAccountId" TEXT NOT NULL,
    "toAccountId" TEXT NOT NULL,
    "kind" "WarmupKind" NOT NULL,
    "status" "WarmupStatus" NOT NULL DEFAULT 'PLANNED',
    "rfcMessageId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "parentId" TEXT,
    "placementTestId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "landedFolder" TEXT,
    "checkedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarmupMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WarmupSettings_workspaceId_idx" ON "WarmupSettings"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WarmupMessage_rfcMessageId_key" ON "WarmupMessage"("rfcMessageId");

-- CreateIndex
CREATE INDEX "WarmupMessage_fromAccountId_sentAt_idx" ON "WarmupMessage"("fromAccountId", "sentAt");

-- CreateIndex
CREATE INDEX "WarmupMessage_toAccountId_receivedAt_idx" ON "WarmupMessage"("toAccountId", "receivedAt");

-- CreateIndex
CREATE INDEX "WarmupMessage_status_dueAt_idx" ON "WarmupMessage"("status", "dueAt");

-- AddForeignKey
ALTER TABLE "WarmupSettings" ADD CONSTRAINT "WarmupSettings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarmupMessage" ADD CONSTRAINT "WarmupMessage_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarmupMessage" ADD CONSTRAINT "WarmupMessage_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

