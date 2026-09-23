-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REQUIRES_REVIEW');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('NOT_REQUESTED', 'REQUESTED', 'PROCESSING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('PAYSTACK', 'MANUAL_SIMULATION');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED');

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDED';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "provider" "PaymentProvider" NOT NULL DEFAULT 'PAYSTACK',
ADD COLUMN     "providerReference" TEXT;

-- AlterTable
ALTER TABLE "SellerProfile" ADD COLUMN     "isPayoutVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paystackRecipientCode" TEXT,
ADD COLUMN     "verifiedAccountName" TEXT;

-- AlterTable
ALTER TABLE "SubOrder" ADD COLUMN     "commissionAmount" DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN     "commissionRate" DECIMAL(5,4) DEFAULT 0.0500,
ADD COLUMN     "netSellerAmount" DECIMAL(10,2) DEFAULT 0.00;

-- CreateTable
CREATE TABLE "PlatformConfig" (
    "id" TEXT NOT NULL,
    "configKey" TEXT NOT NULL DEFAULT 'DEFAULT',
    "commissionRate" DECIMAL(5,4) NOT NULL DEFAULT 0.0500,
    "isPayoutsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "payoutHoldHours" INTEGER NOT NULL DEFAULT 24,
    "minPayoutAmount" DECIMAL(10,2) NOT NULL DEFAULT 1.00,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformCommission" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "subOrderId" TEXT,
    "paymentId" TEXT,
    "rateApplied" DECIMAL(5,4) NOT NULL,
    "grossAmount" DECIMAL(10,2) NOT NULL,
    "commissionAmount" DECIMAL(10,2) NOT NULL,
    "netSellerAmount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformCommission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "subOrderId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sellerProfileId" TEXT NOT NULL,
    "grossAmount" DECIMAL(10,2) NOT NULL,
    "commissionAmount" DECIMAL(10,2) NOT NULL,
    "payoutAmount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "recipientIdentifier" TEXT NOT NULL,
    "recipientName" TEXT,
    "providerRecipientCode" TEXT,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'PAYSTACK',
    "providerReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "eligibleAt" TIMESTAMP(3),
    "initiatedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "subOrderId" TEXT,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "provider" "PaymentProvider" NOT NULL DEFAULT 'PAYSTACK',
    "providerReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
    "reason" TEXT NOT NULL,
    "failureReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'PAYSTACK',
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformConfig_configKey_key" ON "PlatformConfig"("configKey");

-- CreateIndex
CREATE INDEX "PlatformCommission_orderId_idx" ON "PlatformCommission"("orderId");

-- CreateIndex
CREATE INDEX "PlatformCommission_subOrderId_idx" ON "PlatformCommission"("subOrderId");

-- CreateIndex
CREATE INDEX "PlatformCommission_paymentId_idx" ON "PlatformCommission"("paymentId");

-- CreateIndex
CREATE INDEX "PlatformCommission_recordedAt_idx" ON "PlatformCommission"("recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_subOrderId_key" ON "Payout"("subOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_idempotencyKey_key" ON "Payout"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payout_sellerProfileId_status_idx" ON "Payout"("sellerProfileId", "status");

-- CreateIndex
CREATE INDEX "Payout_orderId_idx" ON "Payout"("orderId");

-- CreateIndex
CREATE INDEX "Payout_subOrderId_idx" ON "Payout"("subOrderId");

-- CreateIndex
CREATE INDEX "Payout_status_eligibleAt_idx" ON "Payout"("status", "eligibleAt");

-- CreateIndex
CREATE INDEX "Payout_providerReference_idx" ON "Payout"("providerReference");

-- CreateIndex
CREATE INDEX "Payout_idempotencyKey_idx" ON "Payout"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");

-- CreateIndex
CREATE INDEX "Refund_subOrderId_idx" ON "Refund"("subOrderId");

-- CreateIndex
CREATE INDEX "Refund_paymentId_idx" ON "Refund"("paymentId");

-- CreateIndex
CREATE INDEX "Refund_status_idx" ON "Refund"("status");

-- CreateIndex
CREATE INDEX "Refund_providerReference_idx" ON "Refund"("providerReference");

-- CreateIndex
CREATE INDEX "Refund_idempotencyKey_idx" ON "Refund"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_eventId_key" ON "WebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_eventType_idx" ON "WebhookEvent"("provider", "eventType");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_idx" ON "WebhookEvent"("status");

-- CreateIndex
CREATE INDEX "WebhookEvent_createdAt_idx" ON "WebhookEvent"("createdAt");

-- CreateIndex
CREATE INDEX "Payment_providerReference_idx" ON "Payment"("providerReference");

-- AddForeignKey
ALTER TABLE "PlatformCommission" ADD CONSTRAINT "PlatformCommission_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformCommission" ADD CONSTRAINT "PlatformCommission_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "SubOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformCommission" ADD CONSTRAINT "PlatformCommission_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "SubOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_sellerProfileId_fkey" FOREIGN KEY ("sellerProfileId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "SubOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
