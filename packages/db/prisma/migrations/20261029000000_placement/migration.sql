-- AlterTable
ALTER TABLE "EmailAccount" ADD COLUMN     "placementSeed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PlacementTest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PlacementTest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlacementTest_workspaceId_createdAt_idx" ON "PlacementTest"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "PlacementTest_accountId_finishedAt_idx" ON "PlacementTest"("accountId", "finishedAt");

-- AddForeignKey
ALTER TABLE "PlacementTest" ADD CONSTRAINT "PlacementTest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
