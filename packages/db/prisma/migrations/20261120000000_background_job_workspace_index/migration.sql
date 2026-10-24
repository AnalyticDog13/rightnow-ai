-- Round C: gdprDeleteLead filters BackgroundJob by workspace and status
CREATE INDEX "BackgroundJob_workspaceId_status_idx" ON "BackgroundJob"("workspaceId", "status");
