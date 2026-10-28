-- Optional visible unsubscribe link; the footer then carries an opt-out reply message
ALTER TABLE "Campaign" ADD COLUMN     "unsubscribeLink" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "optOutText" TEXT;
