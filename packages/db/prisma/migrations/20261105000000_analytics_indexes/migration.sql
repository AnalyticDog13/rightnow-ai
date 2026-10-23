-- D42: the activity export pages each workspace's Events by (occurredAt, id).
CREATE INDEX "Event_workspaceId_occurredAt_id_idx" ON "Event"("workspaceId", "occurredAt", "id");

-- D42: "completed" counts a workspace's CampaignLeads COMPLETED in a range. Partial index, so raw SQL: Prisma does not
-- model it (see the CampaignLead model comment).
CREATE INDEX "CampaignLead_completed_idx" ON "CampaignLead"("workspaceId", "completedAt") WHERE "state" = 'COMPLETED';
