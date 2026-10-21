-- CreateEnum
CREATE TYPE "DelayUnit" AS ENUM ('MINUTES', 'HOURS', 'DAYS');

-- CreateEnum
CREATE TYPE "CampaignLeadState" AS ENUM ('QUEUED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'STOPPED');

-- CreateEnum
CREATE TYPE "StopReason" AS ENUM ('REPLIED', 'AUTO_REPLIED', 'COMPANY_REPLIED', 'UNSUBSCRIBED', 'BOUNCED', 'SUPPRESSED', 'SKIPPED', 'MANUAL', 'SEND_FAILED');

-- CreateTable
CREATE TABLE "Subsequence" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" JSONB NOT NULL,
    "preDelayMinutes" INTEGER NOT NULL DEFAULT 0,
    "dailyLimit" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subsequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceStep" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "subsequenceId" TEXT,
    "order" INTEGER NOT NULL,
    "delayValue" INTEGER NOT NULL,
    "delayUnit" "DelayUnit" NOT NULL DEFAULT 'DAYS',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepVariant" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assigned" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StepVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignLead" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "subsequenceId" TEXT,
    "state" "CampaignLeadState" NOT NULL DEFAULT 'QUEUED',
    "stopReason" "StopReason",
    "currentStepId" TEXT,
    "nextDueAt" TIMESTAMP(3),
    "accountId" TEXT,
    "threadRef" TEXT,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CampaignLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Subsequence_campaignId_idx" ON "Subsequence"("campaignId");

-- CreateIndex
CREATE INDEX "SequenceStep_campaignId_subsequenceId_order_idx" ON "SequenceStep"("campaignId", "subsequenceId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "StepVariant_stepId_label_key" ON "StepVariant"("stepId", "label");

-- CreateIndex
CREATE INDEX "CampaignLead_campaignId_state_nextDueAt_idx" ON "CampaignLead"("campaignId", "state", "nextDueAt");

-- CreateIndex
CREATE INDEX "CampaignLead_workspaceId_leadId_idx" ON "CampaignLead"("workspaceId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignLead_campaignId_leadId_key" ON "CampaignLead"("campaignId", "leadId");

-- AddForeignKey
ALTER TABLE "Subsequence" ADD CONSTRAINT "Subsequence_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_subsequenceId_fkey" FOREIGN KEY ("subsequenceId") REFERENCES "Subsequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepVariant" ADD CONSTRAINT "StepVariant_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "SequenceStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_subsequenceId_fkey" FOREIGN KEY ("subsequenceId") REFERENCES "Subsequence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
