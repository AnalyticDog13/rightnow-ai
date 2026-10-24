-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "aiScore" INTEGER, ADD COLUMN "aiScoreReason" TEXT;

-- T05a deferral: a thread's suggestions go with the thread (account delete, retention, GDPR)
DELETE FROM "AiSuggestion" WHERE "threadId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Thread" t WHERE t.id = "AiSuggestion"."threadId");
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
