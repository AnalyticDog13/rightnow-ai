-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED', 'UNCERTAIN', 'HELD');

-- AlterTable
ALTER TABLE "EmailAccount" ADD COLUMN     "consecutivePermanentErrors" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CampaignDailyUsage" (
    "campaignId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "newLeads" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CampaignDailyUsage_pkey" PRIMARY KEY ("campaignId","day")
);

-- CreateTable
CREATE TABLE "ScheduledMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignLeadId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "variantId" TEXT,
    "accountId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'SCHEDULED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimErrors" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "claimToken" TEXT,
    "claimedAt" TIMESTAMP(3),
    "claimBootId" TEXT,
    "usageDay" DATE,
    "wsUsageDay" DATE,
    "campUsageDay" DATE,
    "reservedUnits" INTEGER NOT NULL DEFAULT 0,
    "rfcMessageId" TEXT,
    "providerMessageId" TEXT,
    "providerThreadId" TEXT,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "renderedSubject" TEXT NOT NULL,
    "renderedBody" TEXT NOT NULL,
    "renderedText" TEXT NOT NULL,
    "cc" TEXT[],
    "bcc" TEXT[],
    "uncertainAt" TIMESTAMP(3),
    "searchCount" INTEGER NOT NULL DEFAULT 0,
    "lastSearchAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderVerification" (
    "provider" "AccountProvider" NOT NULL,
    "passedAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "report" JSONB NOT NULL,

    CONSTRAINT "ProviderVerification_pkey" PRIMARY KEY ("provider")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledMessage_idempotencyKey_key" ON "ScheduledMessage"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ScheduledMessage_status_dueAt_idx" ON "ScheduledMessage"("status", "dueAt");

-- CreateIndex
CREATE INDEX "ScheduledMessage_campaignLeadId_idx" ON "ScheduledMessage"("campaignLeadId");

-- CreateIndex
CREATE INDEX "ScheduledMessage_accountId_status_idx" ON "ScheduledMessage"("accountId", "status");

-- CreateIndex
CREATE INDEX "ScheduledMessage_campaignId_status_idx" ON "ScheduledMessage"("campaignId", "status");

-- AddForeignKey
ALTER TABLE "CampaignDailyUsage" ADD CONSTRAINT "CampaignDailyUsage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_campaignLeadId_fkey" FOREIGN KEY ("campaignLeadId") REFERENCES "CampaignLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "SequenceStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "StepVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

