-- DropIndex
DROP INDEX "OTPVerification_identifier_purpose_isVerified_expiresAt_idx";

-- AlterTable
ALTER TABLE "OTPVerification" ADD COLUMN     "consumedAt" TIMESTAMP(3),
ADD COLUMN     "invalidatedAt" TIMESTAMP(3),
ADD COLUMN     "isInvalidated" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "OTPVerification_identifier_purpose_isVerified_isInvalidated_idx" ON "OTPVerification"("identifier", "purpose", "isVerified", "isInvalidated", "expiresAt");
