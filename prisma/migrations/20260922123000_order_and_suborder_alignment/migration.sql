-- AlterTable
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "campusCode" TEXT,
ADD COLUMN IF NOT EXISTS "contactPhone" TEXT,
ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "SubOrder" ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT,
ADD COLUMN IF NOT EXISTS "cancelledByUserId" TEXT,
ADD COLUMN IF NOT EXISTS "deliveryAddress" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_idempotencyKey_idx" ON "Order"("idempotencyKey");
