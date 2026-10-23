-- CreateEnum
CREATE TYPE "StageKind" AS ENUM ('OPEN', 'WON', 'LOST');

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'OPPORTUNITY';
ALTER TYPE "EventType" ADD VALUE 'MEETING';
ALTER TYPE "EventType" ADD VALUE 'DEAL_WON';
ALTER TYPE "EventType" ADD VALUE 'DEAL_LOST';

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "crmAutoOpportunity" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD';

-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "StageKind" NOT NULL,
    "interestCodes" INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "campaignId" TEXT,
    "stageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cashCollected" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expectedCloseAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "closedAt" TIMESTAMP(3),
    "stepId" TEXT,
    "variantId" TEXT,
    "accountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineStage_workspaceId_position_idx" ON "PipelineStage"("workspaceId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_workspaceId_name_key" ON "PipelineStage"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "Opportunity_workspaceId_stageId_idx" ON "Opportunity"("workspaceId", "stageId");

-- CreateIndex
CREATE INDEX "Opportunity_workspaceId_createdAt_idx" ON "Opportunity"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Opportunity_workspaceId_closedAt_idx" ON "Opportunity"("workspaceId", "closedAt");

-- AddForeignKey
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- D40: one deal per (lead, campaign), a campaign-less deal included (raw: Prisma cannot express NULLS NOT DISTINCT)
CREATE UNIQUE INDEX "Opportunity_leadId_campaignId_key" ON "Opportunity"("leadId", "campaignId") NULLS NOT DISTINCT;
