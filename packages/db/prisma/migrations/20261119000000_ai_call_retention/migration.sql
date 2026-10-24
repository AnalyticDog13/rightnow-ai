-- A10: the daily retention purge deletes AiCall rows older than 180 days across workspaces
CREATE INDEX "AiCall_createdAt_idx" ON "AiCall"("createdAt");
