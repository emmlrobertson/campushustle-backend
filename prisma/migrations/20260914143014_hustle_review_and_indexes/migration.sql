-- DropForeignKey
ALTER TABLE "Review" DROP CONSTRAINT "Review_orderItemId_fkey";

-- AlterTable
ALTER TABLE "Review" ALTER COLUMN "orderItemId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Hustle_universityId_price_idx" ON "Hustle"("universityId", "price");

-- CreateIndex
CREATE INDEX "Hustle_universityId_ratingAverage_idx" ON "Hustle"("universityId", "ratingAverage" DESC);

-- CreateIndex
CREATE INDEX "Hustle_universityId_hostelLocation_idx" ON "Hustle"("universityId", "hostelLocation");

-- CreateIndex
CREATE INDEX "Hustle_universityId_createdAt_idx" ON "Hustle"("universityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Review_hustleId_rating_idx" ON "Review"("hustleId", "rating");

-- CreateIndex
CREATE INDEX "Review_reviewerId_idx" ON "Review"("reviewerId");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
