-- CreateEnum
CREATE TYPE "AccountProvider" AS ENUM ('GMAIL', 'MICROSOFT', 'SMTP');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('CONNECTED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "AccountLifecycle" AS ENUM ('ACTIVE', 'INACTIVE', 'REWARMING', 'PAUSED', 'NEEDS_ATTENTION');

-- CreateEnum
CREATE TYPE "SyncState" AS ENUM ('IDLE', 'SYNCING', 'FAILED');

-- CreateEnum
CREATE TYPE "AutofixState" AS ENUM ('NONE', 'IN_PROGRESS', 'FAILED', 'SUCCEEDED');

-- CreateEnum
CREATE TYPE "CapTier" AS ENUM ('GMAIL_WORKSPACE', 'GMAIL_CONSUMER', 'MS365', 'OUTLOOK_COM', 'SMTP');

-- CreateEnum
CREATE TYPE "OAuthStatus" AS ENUM ('PENDING', 'SUCCESS', 'ERROR', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CnameStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'FAILED');

-- CreateTable
CREATE TABLE "EmailAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "AccountProvider" NOT NULL,
    "email" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "replyTo" TEXT,
    "signature" TEXT,
    "tags" TEXT[],
    "credentialsEnc" TEXT,
    "credentialGen" INTEGER NOT NULL DEFAULT 0,
    "status" "AccountStatus" NOT NULL DEFAULT 'CONNECTED',
    "lifecycle" "AccountLifecycle" NOT NULL DEFAULT 'ACTIVE',
    "pausedUntil" TIMESTAMP(3),
    "capTier" "CapTier" NOT NULL,
    "providerCap" INTEGER NOT NULL,
    "dailyLimit" INTEGER NOT NULL DEFAULT 30,
    "minGapSec" INTEGER NOT NULL DEFAULT 0,
    "randomGapSec" INTEGER NOT NULL DEFAULT 0,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "slowRamp" BOOLEAN NOT NULL DEFAULT false,
    "rampStartVolume" INTEGER NOT NULL DEFAULT 2,
    "rampIncrementPerDay" INTEGER NOT NULL DEFAULT 2,
    "rampStartedAt" TIMESTAMP(3),
    "historyImportDays" INTEGER NOT NULL DEFAULT 30,
    "nextSendAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMP(3),
    "lastCampaignActivityAt" TIMESTAMP(3),
    "lastError" JSONB,
    "lastErrorAt" TIMESTAMP(3),
    "errorCount24h" INTEGER NOT NULL DEFAULT 0,
    "autofixState" "AutofixState" NOT NULL DEFAULT 'NONE',
    "autofixAt" TIMESTAMP(3),
    "refreshLeaseId" TEXT,
    "refreshLeaseUntil" TIMESTAMP(3),
    "syncState" "SyncState" NOT NULL DEFAULT 'IDLE',
    "syncCursor" JSONB,
    "lastSyncCompletedAt" TIMESTAMP(3),
    "healthScore" INTEGER,
    "trackingDomain" TEXT,
    "trackingDomainStatus" "CnameStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "appendToSent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "EmailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "provider" "AccountProvider" NOT NULL,
    "stateHash" TEXT NOT NULL,
    "codeVerifierEnc" TEXT NOT NULL,
    "reconnectAccountId" TEXT,
    "status" "OAuthStatus" NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "accountId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountDailyUsage" (
    "accountId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AccountDailyUsage_pkey" PRIMARY KEY ("accountId","day")
);

-- CreateTable
CREATE TABLE "WorkspaceDailyUsage" (
    "workspaceId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkspaceDailyUsage_pkey" PRIMARY KEY ("workspaceId","day")
);

-- CreateIndex
CREATE INDEX "EmailAccount_workspaceId_idx" ON "EmailAccount"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthSession_stateHash_key" ON "OAuthSession"("stateHash");

-- CreateIndex
CREATE INDEX "OAuthSession_workspaceId_idx" ON "OAuthSession"("workspaceId");

-- CreateIndex
CREATE INDEX "OAuthSession_createdAt_idx" ON "OAuthSession"("createdAt");

-- AddForeignKey
ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthSession" ADD CONSTRAINT "OAuthSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDailyUsage" ADD CONSTRAINT "AccountDailyUsage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceDailyUsage" ADD CONSTRAINT "WorkspaceDailyUsage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One live account per address per workspace (case-insensitive); soft-deleted rows free the address
CREATE UNIQUE INDEX "EmailAccount_workspaceId_email_live_key" ON "EmailAccount"("workspaceId", lower("email")) WHERE "deletedAt" IS NULL;
