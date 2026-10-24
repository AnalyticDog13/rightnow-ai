-- CreateEnum
CREATE TYPE "AiSuggestionKind" AS ENUM ('DRAFT', 'PERSONALIZATION', 'FOLLOWUP', 'REPLY_DRAFT', 'SUMMARY', 'SCORE', 'RECOMMENDATION', 'CAMPAIGN_ANALYSIS');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "aiConfigEnc" TEXT;

-- AlterTable
ALTER TABLE "LeadLabel" ADD COLUMN     "aiSelectable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "aiFeedback" INTEGER;

-- CreateTable
CREATE TABLE "AiSuggestion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "AiSuggestionKind" NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "text" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "leadId" TEXT,
    "threadId" TEXT,
    "campaignId" TEXT,
    "stepId" TEXT,
    "jobId" TEXT,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCall" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costMicros" BIGINT,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "suggestionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiSuggestion_workspaceId_status_kind_idx" ON "AiSuggestion"("workspaceId", "status", "kind");

-- CreateIndex
CREATE INDEX "AiSuggestion_threadId_idx" ON "AiSuggestion"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "AiSuggestion_jobId_leadId_key" ON "AiSuggestion"("jobId", "leadId");

-- CreateIndex
CREATE INDEX "AiCall_workspaceId_createdAt_idx" ON "AiCall"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

