-- AlterTable
ALTER TABLE "InboxView" ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'inbox';

-- DropIndex
DROP INDEX "InboxView_workspaceId_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "InboxView_workspaceId_scope_name_key" ON "InboxView"("workspaceId", "scope", "name");
