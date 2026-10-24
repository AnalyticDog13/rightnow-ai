-- CreateEnum
CREATE TYPE "PushStatus" AS ENUM ('ACTIVE', 'FAILED');

-- AlterTable
ALTER TABLE "EmailAccount" ADD COLUMN "syncRequestedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" "AccountProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "clientStateHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "PushStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "lastNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_accountId_key" ON "PushSubscription"("accountId");

-- CreateIndex
CREATE INDEX "PushSubscription_externalId_idx" ON "PushSubscription"("externalId");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
