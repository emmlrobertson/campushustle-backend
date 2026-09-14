-- AlterTable
ALTER TABLE "HustleImage" ADD COLUMN     "publicId" TEXT;

-- CreateIndex
CREATE INDEX "HustleImage_publicId_idx" ON "HustleImage"("publicId");
