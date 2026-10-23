-- A-3: the every-minute lead-verify job (stuck restore, workspaces with queued leads, the claim ordered by updatedAt)
-- reads only queued leads. Partial index, so raw SQL: Prisma does not model it (see the Lead model comment).
CREATE INDEX "Lead_verify_pending_idx" ON "Lead"("workspaceId", "updatedAt") WHERE "verificationStatus" = 'PENDING_JOB';
