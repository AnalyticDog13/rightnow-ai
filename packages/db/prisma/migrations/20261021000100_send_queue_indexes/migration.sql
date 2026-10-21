-- DropIndex
DROP INDEX "ScheduledMessage_campaignLeadId_idx";

-- CreateIndex
CREATE INDEX "ScheduledMessage_stepId_idx" ON "ScheduledMessage"("stepId");

-- CreateIndex
CREATE INDEX "ScheduledMessage_variantId_idx" ON "ScheduledMessage"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledMessage_campaignLeadId_stepId_key" ON "ScheduledMessage"("campaignLeadId", "stepId");


-- The claim walks due SCHEDULED rows in (dueAt, id) order; a partial index keeps that scan to open rows only.
CREATE INDEX "ScheduledMessage_scheduled_due_idx" ON "ScheduledMessage"("dueAt", "id") WHERE "status" = 'SCHEDULED';
