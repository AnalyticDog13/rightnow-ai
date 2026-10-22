-- CreateTable
CREATE TABLE "DomainCheck" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "level" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "selectors" TEXT[],

    CONSTRAINT "DomainCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DomainCheck_workspaceId_domain_key" ON "DomainCheck"("workspaceId", "domain");

-- AddForeignKey
ALTER TABLE "DomainCheck" ADD CONSTRAINT "DomainCheck_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

