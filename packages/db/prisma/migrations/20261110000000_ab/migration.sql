-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "abResetDaily" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StepVariant" ADD COLUMN "assignedDay" DATE,
ADD COLUMN "assignedToday" INTEGER NOT NULL DEFAULT 0;

-- abWinnerMetric becomes reply|click|open (null = reply); free text from before would make the Options tab unsavable
UPDATE "Campaign" SET "abWinnerMetric" = NULL WHERE "abWinnerMetric" NOT IN ('reply', 'click', 'open');
