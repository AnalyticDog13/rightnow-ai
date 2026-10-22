-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "verifyPrevStatus" "VerificationStatus";

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "verifierConfigEnc" TEXT,
ADD COLUMN     "verifierKind" TEXT NOT NULL DEFAULT 'mx';
