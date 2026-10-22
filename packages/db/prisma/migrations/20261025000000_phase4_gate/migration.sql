-- AlterTable
ALTER TABLE "Thread" ADD COLUMN "replyLeaseUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Attachment_messageId_idx" ON "Attachment"("messageId");
