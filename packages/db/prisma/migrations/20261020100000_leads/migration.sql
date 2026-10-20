-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('NOT_VERIFIED', 'VERIFIED', 'PENDING', 'PENDING_JOB', 'INVALID', 'RISKY', 'CATCH_ALL', 'JOB_CHANGE');

-- CreateEnum
CREATE TYPE "EspType" AS ENUM ('GOOGLE', 'MICROSOFT', 'ZOHO', 'YAHOO', 'YANDEX', 'OTHER', 'NOT_FOUND', 'IN_QUEUE');

-- CreateEnum
CREATE TYPE "EnrichmentStatus" AS ENUM ('ENRICHED', 'PENDING', 'NOT_AVAILABLE', 'ERROR');

-- CreateEnum
CREATE TYPE "SuppressionKind" AS ENUM ('EMAIL', 'DOMAIN');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('UNSUBSCRIBE', 'HARD_BOUNCE', 'COMPLAINT', 'MANUAL', 'NOT_INTERESTED', 'GDPR_ERASURE');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "companyName" TEXT,
    "companyDomain" TEXT,
    "jobTitle" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "phone" TEXT,
    "personalization" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "tags" TEXT[],
    "labels" TEXT[],
    "interestStatus" INTEGER,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'NOT_VERIFIED',
    "espType" "EspType" NOT NULL DEFAULT 'IN_QUEUE',
    "esg" TEXT,
    "enrichmentStatus" "EnrichmentStatus",
    "plValue" DECIMAL(65,30),
    "ownerId" TEXT,
    "source" TEXT,
    "lawfulBasis" TEXT,
    "country" TEXT,
    "importJobId" TEXT,
    "emailsSent" INTEGER NOT NULL DEFAULT 0,
    "opens" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "lastContactedAt" TIMESTAMP(3),
    "lastOpenAt" TIMESTAMP(3),
    "lastReplyAt" TIMESTAMP(3),
    "lastClickAt" TIMESTAMP(3),
    "lastInterestChangeAt" TIMESTAMP(3),
    "lastTouchAt" TIMESTAMP(3),
    "lastSenderAccountId" TEXT,
    "lastEngagement" JSONB,
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadLabel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "positive" BOOLEAN NOT NULL DEFAULT false,
    "aiDescription" TEXT,

    CONSTRAINT "LeadLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadList" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadListMember" (
    "listId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,

    CONSTRAINT "LeadListMember_pkey" PRIMARY KEY ("listId","leadId")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "SuppressionKind" NOT NULL,
    "value" TEXT,
    "valueHash" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "fileName" TEXT NOT NULL,
    "data" BYTEA,
    "mapping" JSONB NOT NULL,
    "options" JSONB NOT NULL,
    "confirmedAuthorized" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "lawfulBasis" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "attached" INTEGER NOT NULL DEFAULT 0,
    "skipped" JSONB NOT NULL DEFAULT '{}',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_workspaceId_createdAt_id_idx" ON "Lead"("workspaceId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_companyDomain_idx" ON "Lead"("workspaceId", "companyDomain");

-- CreateIndex
CREATE UNIQUE INDEX "LeadLabel_workspaceId_name_key" ON "LeadLabel"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "LeadList_workspaceId_name_key" ON "LeadList"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "LeadListMember_leadId_idx" ON "LeadListMember"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_workspaceId_kind_valueHash_key" ON "Suppression"("workspaceId", "kind", "valueHash");

-- CreateIndex
CREATE INDEX "ImportJob_status_createdAt_idx" ON "ImportJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadLabel" ADD CONSTRAINT "LeadLabel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadList" ADD CONSTRAINT "LeadList_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadListMember" ADD CONSTRAINT "LeadListMember_listId_fkey" FOREIGN KEY ("listId") REFERENCES "LeadList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadListMember" ADD CONSTRAINT "LeadListMember_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One live lead per address per workspace (soft-deleted rows may repeat).
CREATE UNIQUE INDEX "Lead_workspaceId_email_live_key" ON "Lead"("workspaceId", "email") WHERE "deletedAt" IS NULL;
