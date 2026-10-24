-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "abResetDaily" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StepVariant" ADD COLUMN "assignedDay" DATE,
ADD COLUMN "assignedToday" INTEGER NOT NULL DEFAULT 0;
