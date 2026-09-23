import { prisma } from './prisma';
import {
  PaymentStatus,
  PayoutStatus,
  RefundStatus,
  PaymentProvider,
  WebhookEventStatus,
} from '@prisma/client';

async function testFinancialArchitectureDb() {
  console.log('🧪 Starting Financial Architecture Database Verification...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: any) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`, detail || '');
      failed++;
    }
  }

  // 1. Verify PlatformConfig
  console.log('--- 1. Platform Configuration & Commission Rate ---');
  const config = await prisma.platformConfig.findUnique({
    where: { configKey: 'DEFAULT' },
  });
  assert(Boolean(config), 'Default PlatformConfig exists');
  assert(Number(config?.commissionRate) === 0.05, `Default commission rate is 5% (0.0500, got ${config?.commissionRate})`);
  assert(config?.isPayoutsEnabled === true, 'Payouts enabled by default');
  assert(config?.payoutHoldHours === 24, 'Default payout hold window is 24 hours');

  // 2. Verify SellerProfile Payout Fields
  console.log('\n--- 2. SellerProfile Payout Verification Fields ---');
  const seller = await prisma.sellerProfile.findFirst();
  assert(Boolean(seller), 'Found at least one seller profile');
  const updatedSeller = await prisma.sellerProfile.update({
    where: { id: seller!.id },
    data: {
      paystackRecipientCode: 'RCP_test_mock_123',
      verifiedAccountName: 'Kwame Mensah',
      isPayoutVerified: true,
    },
  });
  assert(updatedSeller.paystackRecipientCode === 'RCP_test_mock_123', 'Stored paystackRecipientCode on SellerProfile');
  assert(updatedSeller.isPayoutVerified === true, 'Stored isPayoutVerified flag on SellerProfile');
  assert(updatedSeller.verifiedAccountName === 'Kwame Mensah', 'Stored verifiedAccountName on SellerProfile');

  // 3. Verify Payment Status & Provider
  console.log('\n--- 3. Payment Model Tracking ---');
  const order = await prisma.order.findFirst({
    include: { subOrders: true },
  });
  assert(Boolean(order), 'Found at least one order');

  const testPayment = await prisma.payment.create({
    data: {
      orderId: order!.id,
      reference: `PAY_TEST_${Date.now()}`,
      providerReference: `PSTK_TRX_${Date.now()}`,
      provider: PaymentProvider.PAYSTACK,
      amount: 100.00,
      currency: 'GHS',
      momoNumber: '0240000000',
      status: PaymentStatus.SUCCESS,
    },
  });
  assert(testPayment.provider === PaymentProvider.PAYSTACK, 'Payment stored with PaymentProvider.PAYSTACK');
  assert(testPayment.status === PaymentStatus.SUCCESS, 'Payment stored with PaymentStatus.SUCCESS');
  assert(Boolean(testPayment.providerReference), 'Payment stored with gateway providerReference');

  // 4. Verify Commission Snapshot Persistence
  console.log('\n--- 4. Platform Commission Snapshot Tracking ---');
  const subOrder = order!.subOrders[0];
  assert(Boolean(subOrder), 'Found at least one sub-order');

  // Update sub-order snapshot fields
  const updatedSubOrder = await prisma.subOrder.update({
    where: { id: subOrder.id },
    data: {
      commissionRate: 0.0500,
      commissionAmount: 5.00,
      netSellerAmount: 95.00,
    },
  });
  assert(Number(updatedSubOrder.commissionRate) === 0.05, 'SubOrder stored snapshot commission rate (0.0500)');
  assert(Number(updatedSubOrder.commissionAmount) === 5.00, 'SubOrder stored snapshot commission amount (5.00)');
  assert(Number(updatedSubOrder.netSellerAmount) === 95.00, 'SubOrder stored netSellerAmount (95.00)');

  // Create dedicated PlatformCommission record
  const commission = await prisma.platformCommission.create({
    data: {
      orderId: order!.id,
      subOrderId: subOrder.id,
      paymentId: testPayment.id,
      rateApplied: 0.0500,
      grossAmount: 100.00,
      commissionAmount: 5.00,
      netSellerAmount: 95.00,
      currency: 'GHS',
    },
  });
  assert(Number(commission.rateApplied) === 0.05, 'PlatformCommission recorded transaction rate snapshot');
  assert(Number(commission.commissionAmount) === 5.00, 'PlatformCommission recorded platform revenue');

  // 5. Verify Seller Payout Lifecycle Tracking
  console.log('\n--- 5. Seller Payout Tracking ---');
  const payout = await prisma.payout.create({
    data: {
      subOrderId: subOrder.id,
      orderId: order!.id,
      sellerProfileId: seller!.id,
      grossAmount: 100.00,
      commissionAmount: 5.00,
      payoutAmount: 95.00,
      currency: 'GHS',
      recipientIdentifier: '0248888801',
      recipientName: 'Kwame Mensah',
      providerRecipientCode: 'RCP_test_mock_123',
      provider: PaymentProvider.PAYSTACK,
      providerReference: `TRF_${Date.now()}`,
      idempotencyKey: `payout_idem_${Date.now()}`,
      status: PayoutStatus.PROCESSING,
      eligibleAt: new Date(Date.now() + 24 * 3600 * 1000),
      initiatedAt: new Date(),
    },
  });
  assert(payout.status === PayoutStatus.PROCESSING, 'Payout created with status PROCESSING');
  assert(Number(payout.payoutAmount) === 95.00, 'Payout amount is 95.00 (gross 100 - commission 5)');
  assert(Boolean(payout.idempotencyKey), 'Payout has unique idempotencyKey');

  // 6. Verify Refund Model Tracking
  console.log('\n--- 6. Refund Model Tracking ---');
  const refund = await prisma.refund.create({
    data: {
      orderId: order!.id,
      subOrderId: subOrder.id,
      paymentId: testPayment.id,
      amount: 40.00,
      currency: 'GHS',
      provider: PaymentProvider.PAYSTACK,
      providerReference: `RFD_${Date.now()}`,
      idempotencyKey: `refund_idem_${Date.now()}`,
      status: RefundStatus.REQUESTED,
      reason: 'Buyer received damaged charger',
    },
  });
  assert(refund.status === RefundStatus.REQUESTED, 'Refund created with RefundStatus.REQUESTED');
  assert(Number(refund.amount) === 40.00, 'Refund tracks specific amount');
  assert(refund.reason === 'Buyer received damaged charger', 'Refund tracks explicit reason');

  // 7. Verify Webhook Idempotency Tracking
  console.log('\n--- 7. Webhook Event Idempotency ---');
  const eventId = `evt_test_${Date.now()}`;
  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      provider: PaymentProvider.PAYSTACK,
      eventId: eventId,
      eventType: 'transfer.success',
      status: WebhookEventStatus.PROCESSED,
      payload: { event: 'transfer.success', data: { reference: payout.providerReference } },
      processedAt: new Date(),
    },
  });
  assert(webhookEvent.status === WebhookEventStatus.PROCESSED, 'Webhook event logged as PROCESSED');

  // Test duplicate webhook rejection (idempotency constraint)
  let duplicateRejected = false;
  try {
    await prisma.webhookEvent.create({
      data: {
        provider: PaymentProvider.PAYSTACK,
        eventId: eventId, // Same event ID!
        eventType: 'transfer.success',
        payload: {},
      },
    });
  } catch (err: any) {
    duplicateRejected = true;
  }
  assert(duplicateRejected, 'Duplicate webhook event rejected by unique eventId constraint');

  // Clean up test records
  console.log('\n--- 8. Cleanup Test Entities ---');
  await prisma.webhookEvent.delete({ where: { id: webhookEvent.id } });
  await prisma.refund.delete({ where: { id: refund.id } });
  await prisma.payout.delete({ where: { id: payout.id } });
  await prisma.platformCommission.delete({ where: { id: commission.id } });
  await prisma.payment.delete({ where: { id: testPayment.id } });
  assert(true, 'Ephemeral test entities cleaned up cleanly');

  console.log(`\n======================================================`);
  console.log(`🎉 Financial Architecture DB Verification Complete:`);
  console.log(`   Passed: ${passed}`);
  console.log(`   Failed: ${failed}`);
  console.log(`======================================================\n`);

  if (failed > 0) process.exit(1);
}

testFinancialArchitectureDb()
  .catch((e) => {
    console.error('Fatal DB test error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
