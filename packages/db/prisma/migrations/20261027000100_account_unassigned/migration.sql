-- D39 N-2: leads housekeeping paused for an unassigned or deleted sticky account get their own reason, so the
-- planner can reverse that pause once the account is live and assigned again. A separate migration: a new enum
-- value cannot be used in the transaction that adds it.
UPDATE "CampaignLead" cl SET "stopReason" = 'ACCOUNT_UNASSIGNED'
WHERE cl.state = 'PAUSED' AND cl."stopReason" = 'SEND_FAILED' AND cl."accountId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "EmailAccount" a JOIN "CampaignAccount" ca ON ca."accountId" = a.id
    WHERE a.id = cl."accountId" AND a."deletedAt" IS NULL AND ca."campaignId" = cl."campaignId");
