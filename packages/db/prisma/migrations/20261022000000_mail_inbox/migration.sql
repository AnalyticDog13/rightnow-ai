-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('REPLY', 'AUTO_REPLY', 'BOUNCE', 'UNSUBSCRIBE', 'OUTBOUND', 'OTHER');

-- CreateEnum
CREATE TYPE "ReplyCategory" AS ENUM ('INTERESTED', 'MEETING_REQUESTED', 'NOT_INTERESTED', 'WRONG_PERSON', 'NEUTRAL', 'OUT_OF_OFFICE', 'UNSUBSCRIBE', 'AUTOMATED', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "BounceType" AS ENUM ('HARD', 'SOFT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('ACCEPTED', 'SEND_FAILED', 'BOUNCE_HARD', 'BOUNCE_SOFT', 'BOUNCE_UNKNOWN', 'UNSUBSCRIBE', 'REPLY', 'AUTO_REPLY', 'OPEN', 'CLICK', 'INTEREST_CHANGED');

-- CreateEnum
CREATE TYPE "SyncMode" AS ENUM ('INCREMENTAL', 'FULL', 'HISTORICAL');

-- CreateTable
CREATE TABLE "Thread" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerThreadId" TEXT,
    "subject" TEXT NOT NULL,
    "leadId" TEXT,
    "campaignId" TEXT,
    "campaignLeadId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "lastInboundAt" TIMESTAMP(3),
    "lastInboundKind" "MessageKind",
    "isRead" BOOLEAN NOT NULL DEFAULT true,
    "category" "ReplyCategory",
    "categorySource" TEXT,
    "reminderAt" TIMESTAMP(3),
    "hasAttachment" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "rfcMessageId" TEXT NOT NULL,
    "synthetic" BOOLEAN NOT NULL DEFAULT false,
    "inReplyTo" TEXT,
    "references" TEXT[],
    "direction" "MessageDirection" NOT NULL,
    "folder" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT,
    "to" TEXT[],
    "cc" TEXT[],
    "subject" TEXT NOT NULL,
    "text" TEXT,
    "html" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "kind" "MessageKind" NOT NULL,
    "category" "ReplyCategory",
    "bounceType" "BounceType",
    "bounceRecipient" TEXT,
    "oooUntil" TIMESTAMP(3),
    "scheduledMessageId" TEXT,
    "outsideApp" BOOLEAN NOT NULL DEFAULT false,
    "leadId" TEXT,
    "campaignId" TEXT,
    "remoteDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA,
    "truncated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "leadId" TEXT,
    "campaignId" TEXT,
    "accountId" TEXT,
    "stepId" TEXT,
    "variantId" TEXT,
    "scheduledMessageId" TEXT,
    "messageId" TEXT,
    "isEstimated" BOOLEAN NOT NULL DEFAULT false,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "mode" "SyncMode" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Thread_workspaceId_lastMessageAt_idx" ON "Thread"("workspaceId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Thread_accountId_providerThreadId_idx" ON "Thread"("accountId", "providerThreadId");

-- CreateIndex
CREATE INDEX "Thread_workspaceId_leadId_idx" ON "Thread"("workspaceId", "leadId");

-- CreateIndex
CREATE INDEX "Thread_workspaceId_reminderAt_idx" ON "Thread"("workspaceId", "reminderAt");

-- CreateIndex
CREATE INDEX "Message_accountId_providerMessageId_idx" ON "Message"("accountId", "providerMessageId");

-- CreateIndex
CREATE INDEX "Message_threadId_sentAt_idx" ON "Message"("threadId", "sentAt");

-- CreateIndex
CREATE INDEX "Message_workspaceId_rfcMessageId_idx" ON "Message"("workspaceId", "rfcMessageId");

-- CreateIndex
CREATE INDEX "Message_workspaceId_fromEmail_idx" ON "Message"("workspaceId", "fromEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Message_accountId_rfcMessageId_key" ON "Message"("accountId", "rfcMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_dedupeKey_key" ON "Event"("dedupeKey");

-- CreateIndex
CREATE INDEX "Event_workspaceId_type_occurredAt_idx" ON "Event"("workspaceId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "Event_campaignId_type_idx" ON "Event"("campaignId", "type");

-- CreateIndex
CREATE INDEX "Event_leadId_occurredAt_idx" ON "Event"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "SyncRun_accountId_startedAt_idx" ON "SyncRun"("accountId", "startedAt");

-- CreateIndex
CREATE INDEX "ScheduledMessage_workspaceId_rfcMessageId_idx" ON "ScheduledMessage"("workspaceId", "rfcMessageId");

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: every SENT row gets its ACCEPTED event (written by the sender from now on).
INSERT INTO "Event" ("id", "workspaceId", "type", "occurredAt", "campaignId", "accountId", "stepId", "variantId", "scheduledMessageId", "leadId", "dedupeKey")
SELECT gen_random_uuid()::text, m."workspaceId", 'ACCEPTED', COALESCE(m."sentAt", m."updatedAt"), m."campaignId", m."accountId", m."stepId", m."variantId", m.id, cl."leadId", 'acc:' || m.id
FROM "ScheduledMessage" m JOIN "CampaignLead" cl ON cl.id = m."campaignLeadId"
WHERE m.status = 'SENT'
ON CONFLICT ("dedupeKey") DO NOTHING;
