-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED', 'ACCOUNTS_UNHEALTHY', 'BOUNCE_PROTECT');

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "dailyCap" INTEGER,
ADD COLUMN     "disableOpenTracking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "firstEmailTextOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "perCompanyDailyLimit" INTEGER,
ADD COLUMN     "physicalAddress" TEXT,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "evergreen" BOOLEAN NOT NULL DEFAULT false,
    "dailyLimit" INTEGER,
    "maxNewLeadsPerDay" INTEGER,
    "perCompanyDailyLimit" INTEGER,
    "minGapSec" INTEGER NOT NULL DEFAULT 540,
    "randomGapSec" INTEGER NOT NULL DEFAULT 300,
    "stopOnReply" BOOLEAN NOT NULL DEFAULT true,
    "stopOnAutoReply" BOOLEAN NOT NULL DEFAULT false,
    "stopForCompanyOnReply" BOOLEAN NOT NULL DEFAULT false,
    "trackOpens" BOOLEAN NOT NULL DEFAULT false,
    "trackClicks" BOOLEAN NOT NULL DEFAULT false,
    "textOnly" BOOLEAN NOT NULL DEFAULT false,
    "firstEmailTextOnly" BOOLEAN NOT NULL DEFAULT false,
    "prioritizeNewLeads" BOOLEAN NOT NULL DEFAULT false,
    "matchProvider" BOOLEAN NOT NULL DEFAULT false,
    "espRoutingRules" JSONB NOT NULL DEFAULT '[]',
    "accountTags" TEXT[],
    "allowRisky" BOOLEAN NOT NULL DEFAULT false,
    "bounceProtect" BOOLEAN NOT NULL DEFAULT true,
    "unsubscribeHeader" BOOLEAN NOT NULL DEFAULT true,
    "cc" TEXT[],
    "bcc" TEXT[],
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "plValue" DECIMAL(65,30),
    "tags" TEXT[],
    "abAutoOptimize" BOOLEAN NOT NULL DEFAULT false,
    "abWinnerMetric" TEXT,
    "launchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignSchedule" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,

    CONSTRAINT "CampaignSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignAccount" (
    "campaignId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,

    CONSTRAINT "CampaignAccount_pkey" PRIMARY KEY ("campaignId","accountId")
);

-- CreateIndex
CREATE INDEX "Campaign_workspaceId_status_idx" ON "Campaign"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "CampaignAccount_accountId_idx" ON "CampaignAccount"("accountId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSchedule" ADD CONSTRAINT "CampaignSchedule_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignAccount" ADD CONSTRAINT "CampaignAccount_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignAccount" ADD CONSTRAINT "CampaignAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

