-- D41 feed and lead timeline: CRM audit rows are picked by meta->>'leadId' / meta->>'opportunityId' and by target.
-- Partial expression indexes, so raw SQL: Prisma does not model them (see the AuditLog model comment).
CREATE INDEX "AuditLog_meta_leadId_idx" ON "AuditLog"("workspaceId", ("meta"->>'leadId')) WHERE ("meta"->>'leadId') IS NOT NULL;
CREATE INDEX "AuditLog_meta_opportunityId_idx" ON "AuditLog"("workspaceId", ("meta"->>'opportunityId')) WHERE ("meta"->>'opportunityId') IS NOT NULL;

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_target_idx" ON "AuditLog"("workspaceId", "target");

-- CreateIndex: the cascades from Lead and Opportunity, and the per-lead / per-deal task lists
CREATE INDEX "Task_leadId_idx" ON "Task"("leadId");

-- CreateIndex
CREATE INDEX "Task_opportunityId_idx" ON "Task"("opportunityId");
