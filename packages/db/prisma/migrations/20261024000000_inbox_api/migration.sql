-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "threadId" TEXT,
    "leadId" TEXT,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Note_one_target" CHECK (num_nonnulls("threadId", "leadId") = 1)
);

-- CreateTable
CREATE TABLE "Macro" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "Macro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxView" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Note_workspaceId_threadId_idx" ON "Note"("workspaceId", "threadId");

-- CreateIndex
CREATE INDEX "Note_workspaceId_leadId_idx" ON "Note"("workspaceId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Macro_workspaceId_name_key" ON "Macro"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "InboxView_workspaceId_name_key" ON "InboxView"("workspaceId", "name");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Macro" ADD CONSTRAINT "Macro_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxView" ADD CONSTRAINT "InboxView_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
