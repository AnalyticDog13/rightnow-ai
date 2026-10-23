-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'ACCOUNT_ERROR';
ALTER TYPE "EventType" ADD VALUE 'QUOTA_REACHED';
ALTER TYPE "EventType" ADD VALUE 'CAMPAIGN_COMPLETED';
ALTER TYPE "EventType" ADD VALUE 'LABEL_ADDED';

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('OK', 'FAILED');

-- AlterTable (D43 / Rev 2 R3): existing rows get the epoch through the fast default (no table rewrite, history never
-- fires); dropping the default makes every new row NULL, i.e. pending.
ALTER TABLE "Event" ADD COLUMN     "dispatchedAt" TIMESTAMP(3) DEFAULT '1970-01-01',
ADD COLUMN     "dispatchError" TEXT;
ALTER TABLE "Event" ALTER COLUMN "dispatchedAt" DROP DEFAULT;

-- CreateIndex (partial: the outbox, raw SQL only)
CREATE INDEX "Event_pending_idx" ON "Event"("createdAt", "id") WHERE "dispatchedAt" IS NULL;

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" TEXT NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "AutomationRunStatus" NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationRule_workspaceId_enabled_idx" ON "AutomationRule"("workspaceId", "enabled");

-- CreateIndex
CREATE INDEX "AutomationRun_workspaceId_createdAt_idx" ON "AutomationRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRun_ruleId_eventId_key" ON "AutomationRun"("ruleId", "eventId");

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
