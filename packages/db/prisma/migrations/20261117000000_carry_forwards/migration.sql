-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "rewarmExitBouncePct" DOUBLE PRECISION NOT NULL DEFAULT 2;

-- CreateIndex
CREATE INDEX "Lead_mergedIntoId_idx" ON "Lead"("mergedIntoId");
