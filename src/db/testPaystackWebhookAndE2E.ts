import { prisma } from './prisma';
import crypto from 'crypto';
import { handlePaystackWebhook } from '../controllers/paymentController';
import { PaymentStatus, OrderStatus, SubOrderStatus, EscrowStatus } from '@prisma/client';

function createMockReqRes(options: {
  body?: any;
  headers?: any;
  rawBody?: Buffer;
}) {
  const req: any = {
    body: options.body || {},
    headers: options.headers || {},
    rawBody: options.rawBody,
  };

  let statusCode = 200;
  let responseData: any = null;

  const res: any = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: any) {
      responseData = data;
      return res;
    },
  };

  return {
    req,
    res,
    getStatus: () => statusCode,
    getData: () => responseData,
  };
}

const initialSecret = process.env.PAYSTACK_SECRET_KEY;

async function runPaystackAndCommerceTests() {
  console.log('🧪 Starting Paystack Webhook, Cart, & Escrow Lifecycle Tests...\n');

  // Clearly isolated mock secret for testing HMAC SHA512 signature calculation
  const secret = initialSecret || 'isolated_mock_paystack_secret_for_webhook_signature_tests';
  process.env.PAYSTACK_SECRET_KEY = secret;

  // 1. Setup Student & Order
  const knust = await prisma.university.findUnique({ where: { code: 'KNUST' } });
  if (!knust) throw new Error('KNUST not seeded');

  const buyer = await prisma.user.upsert({
    where: { email: 'webhook.buyer@st.knust.edu.gh' },
    update: {},
    create: {
      email: 'webhook.buyer@st.knust.edu.gh',
      name: 'Webhook Buyer',
      phoneNumber: '233549999991',
      phoneVerified: true,
      passwordHash: 'dummyhash',
      program: 'Computer Science',
      hostelLocation: 'Ayeduase',
      universityId: knust.id,
    },
  });

  const seller = await prisma.user.upsert({
    where: { email: 'webhook.seller@st.knust.edu.gh' },
    update: {},
    create: {
      email: 'webhook.seller@st.knust.edu.gh',
      name: 'Webhook Seller',
      phoneNumber: '233549999992',
      phoneVerified: true,
      passwordHash: 'dummyhash',
      program: 'Engineering',
      hostelLocation: 'Brunei',
      universityId: knust.id,
      sellerProfile: {
        create: {
          payoutMomoNumber: '0241999992',
          businessName: 'Webhook Repair Co',
        },
      },
    },
    include: { sellerProfile: true },
  });

  const sellerProfileId = seller.sellerProfile!.id;
  const testRef = `PAY_KNUST_TEST_${Date.now()}`;
  const orderNumber = `CH-KNUST-WH-${Date.now()}`;

  const order = await prisma.order.create({
    data: {
      orderNumber,
      buyerId: buyer.id,
      totalAmount: 120,
      currency: 'GHS',
      status: OrderStatus.PENDING_PAYMENT,
      subOrders: {
        create: {
          subOrderNumber: `${orderNumber}-A`,
          sellerProfileId,
          subtotal: 120,
          meetupLocation: 'CCB Ground Floor',
          status: SubOrderStatus.PENDING_ACCEPTANCE,
          escrowStatus: EscrowStatus.HELD,
          items: {
            create: {
              snapshotTitle: 'Test Service',
              snapshotPrice: 120,
              quantity: 1,
              lineTotal: 120,
            },
          },
        },
      },
      payments: {
        create: {
          reference: testRef,
          amount: 120,
          currency: 'GHS',
          momoNumber: '0241999991',
          status: PaymentStatus.INITIALIZED,
        },
      },
    },
  });

  console.log('✅ Created pending order and payment reference:', testRef);

  // TEST 1: Reject Webhook with Forged / Invalid Signature
  console.log('\n--- TEST 1: Reject Webhook with Invalid Signature ---');
  {
    const payload = JSON.stringify({
      event: 'charge.success',
      data: { reference: testRef, amount: 12000, paid_at: new Date().toISOString() },
    });

    const { req, res, getStatus } = createMockReqRes({
      body: JSON.parse(payload),
      rawBody: Buffer.from(payload),
      headers: { 'x-paystack-signature': 'bad_forged_signature_12345' },
    });

    await handlePaystackWebhook(req, res);
    if (getStatus() === 401) {
      console.log('  ✅ PASS: Forged signature rejected with 401 Unauthorized');
    } else {
      throw new Error(`Expected 401 but got ${getStatus()}`);
    }
  }

  // TEST 2: Process Valid charge.success Webhook with HMAC SHA512
  console.log('\n--- TEST 2: Process Valid charge.success Webhook with HMAC SHA512 ---');
  {
    const payload = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: testRef,
        amount: 12000,
        status: 'success',
        gateway_response: 'Approved',
        paid_at: new Date().toISOString(),
      },
    });

    const signature = crypto
      .createHmac('sha512', secret)
      .update(Buffer.from(payload))
      .digest('hex');

    const { req, res, getStatus } = createMockReqRes({
      body: JSON.parse(payload),
      rawBody: Buffer.from(payload),
      headers: { 'x-paystack-signature': signature },
    });

    await handlePaystackWebhook(req, res);
    if (getStatus() === 200) {
      console.log('  ✅ PASS: Valid signature accepted with 200 OK');
    } else {
      throw new Error(`Expected 200 but got ${getStatus()}`);
    }

    // Verify DB states
    const updatedPayment = await prisma.payment.findUnique({ where: { reference: testRef } });
    const updatedOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: { subOrders: true },
    });

    if (updatedPayment?.status === PaymentStatus.SUCCESS) {
      console.log('  ✅ PASS: Payment status updated to SUCCESS in PostgreSQL');
    } else {
      throw new Error(`Expected PaymentStatus.SUCCESS, got ${updatedPayment?.status}`);
    }

    if (updatedOrder?.status === OrderStatus.PAID) {
      console.log('  ✅ PASS: Parent Order status updated to PAID in PostgreSQL');
    } else {
      throw new Error(`Expected OrderStatus.PAID, got ${updatedOrder?.status}`);
    }

    if (
      updatedOrder?.subOrders[0]?.status === SubOrderStatus.IN_PROGRESS &&
      updatedOrder?.subOrders[0]?.escrowStatus === EscrowStatus.HELD
    ) {
      console.log('  ✅ PASS: SubOrder status set to IN_PROGRESS, Escrow safely HELD');
    } else {
      throw new Error('SubOrder state mismatch after webhook');
    }
  }

  // TEST 3: Webhook Idempotency (Duplicate Delivery)
  console.log('\n--- TEST 3: Webhook Idempotency (Duplicate Delivery) ---');
  {
    const payload = JSON.stringify({
      event: 'charge.success',
      data: { reference: testRef, amount: 12000, status: 'success' },
    });

    const signature = crypto
      .createHmac('sha512', secret)
      .update(Buffer.from(payload))
      .digest('hex');

    const { req, res, getStatus, getData } = createMockReqRes({
      body: JSON.parse(payload),
      rawBody: Buffer.from(payload),
      headers: { 'x-paystack-signature': signature },
    });

    await handlePaystackWebhook(req, res);
    if (getStatus() === 200 && getData()?.status === 'already_processed') {
      console.log('  ✅ PASS: Duplicate webhook recognized and safely acknowledged (already_processed)');
    } else {
      throw new Error(`Expected already_processed, got ${JSON.stringify(getData())}`);
    }
  }

  // CLEANUP
  console.log('\n=== CLEANUP ===');
  await prisma.orderItem.deleteMany({
    where: { subOrder: { orderId: order.id } },
  });
  await prisma.subOrder.deleteMany({ where: { orderId: order.id } });
  await prisma.payment.deleteMany({ where: { orderId: order.id } });
  await prisma.order.delete({ where: { id: order.id } });
  await prisma.sellerProfile.deleteMany({ where: { userId: seller.id } });
  await prisma.user.deleteMany({ where: { id: { in: [buyer.id, seller.id] } } });
  console.log('✔ Test data safely cleaned up.');

  console.log('\n🎉 ALL PAYSTACK WEBHOOK & COMMERCE LIFECYCLE TESTS 100% PASSED!\n');
}

runPaystackAndCommerceTests()
  .catch((e) => {
    console.error('❌ Test failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    if (initialSecret !== undefined) {
      process.env.PAYSTACK_SECRET_KEY = initialSecret;
    } else {
      delete process.env.PAYSTACK_SECRET_KEY;
    }
    await prisma.$disconnect();
  });
