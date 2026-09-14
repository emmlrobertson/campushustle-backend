import { prisma } from './prisma';
import {
  checkoutOrder,
  getMyOrders,
  getOrderById,
  getSellerIncomingOrders,
  updateSubOrderStatus,
  confirmSubOrderReceipt,
  cancelSubOrder,
  disputeSubOrder,
} from '../controllers/orderController';
import { SubOrderStatus, EscrowStatus, OrderStatus } from '@prisma/client';

// Mock Express req/res
function createMockReqRes(options: {
  body?: any;
  params?: any;
  query?: any;
  headers?: any;
  user?: any;
}) {
  const req: any = {
    body: options.body || {},
    params: options.params || {},
    query: options.query || {},
    headers: options.headers || {},
    user: options.user,
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

async function runOrderArchitectureTests() {
  console.log('🧪 Starting Multi-Seller Marketplace Order Architecture Tests...\n');
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

  // 1. Setup Universities & Users
  const knust = await prisma.university.findUnique({ where: { code: 'KNUST' } });
  if (!knust) throw new Error('KNUST not found');

  const sellerUserA = await prisma.user.upsert({
    where: { email: 'seller.order.a@st.knust.edu.gh' },
    update: {},
    create: {
      email: 'seller.order.a@st.knust.edu.gh',
      name: 'Seller Kwame (Tech)',
      phoneNumber: '233548888801',
      phoneVerified: true,
      passwordHash: '$2a$10$FakeHashForTestingOnly1234567890123456789012',
      program: 'Computer Engineering',
      hostelLocation: 'Ayeduase',
      universityId: knust.id,
    },
    include: { sellerProfile: true },
  });

  const sellerUserB = await prisma.user.upsert({
    where: { email: 'seller.order.b@st.knust.edu.gh' },
    update: {},
    create: {
      email: 'seller.order.b@st.knust.edu.gh',
      name: 'Seller Akua (Food)',
      phoneNumber: '233548888802',
      phoneVerified: true,
      passwordHash: '$2a$10$FakeHashForTestingOnly1234567890123456789012',
      program: 'Biochemistry',
      hostelLocation: 'Brunei',
      universityId: knust.id,
    },
    include: { sellerProfile: true },
  });

  const buyerUser = await prisma.user.upsert({
    where: { email: 'buyer.order.c@st.knust.edu.gh' },
    update: {},
    create: {
      email: 'buyer.order.c@st.knust.edu.gh',
      name: 'Buyer Kofi',
      phoneNumber: '233548888803',
      phoneVerified: true,
      passwordHash: '$2a$10$FakeHashForTestingOnly1234567890123456789012',
      program: 'Electrical Engineering',
      hostelLocation: 'Gaza',
      universityId: knust.id,
    },
  });

  let sellerProfileA = sellerUserA.sellerProfile;
  if (!sellerProfileA) {
    sellerProfileA = await prisma.sellerProfile.create({
      data: {
        userId: sellerUserA.id,
        businessName: 'Kwame Gadgets',
        payoutMomoNumber: '0248888801',
      },
    });
  }

  let sellerProfileB = sellerUserB.sellerProfile;
  if (!sellerProfileB) {
    sellerProfileB = await prisma.sellerProfile.create({
      data: {
        userId: sellerUserB.id,
        businessName: 'Akua Campus Delights',
        payoutMomoNumber: '0248888802',
      },
    });
  }

  const category = await prisma.category.findFirst();
  if (!category) throw new Error('Category not found');

  // Setup 2 Hustles from 2 different sellers
  const hustleA = await prisma.hustle.create({
    data: {
      id: `hst_ord_a_${Date.now()}`,
      title: 'Original Type-C Fast Charger',
      description: '65W Fast charging adapter for phones and laptops.',
      price: 50.00,
      hostelLocation: 'Ayeduase',
      whatsAppContact: '233548888801',
      sellerProfileId: sellerProfileA.id,
      universityId: knust.id,
      categoryId: category.id,
      trackStock: true,
      stockQuantity: 3, // Inventory tracking enabled
    },
  });

  const hustleB = await prisma.hustle.create({
    data: {
      id: `hst_ord_b_${Date.now()}`,
      title: 'Fried Rice & Grilled Chicken Combo',
      description: 'Delicious warm campus meal with shito and salad.',
      price: 40.00,
      hostelLocation: 'Brunei',
      whatsAppContact: '233548888802',
      sellerProfileId: sellerProfileB.id,
      universityId: knust.id,
      categoryId: category.id,
      trackStock: false,
    },
  });

  // Paused hustle for testing availability
  const hustlePaused = await prisma.hustle.create({
    data: {
      id: `hst_ord_paused_${Date.now()}`,
      title: 'Busy Braiding Service',
      description: 'Hair braids',
      price: 80.00,
      status: 'BUSY',
      hostelLocation: 'Gaza',
      whatsAppContact: '233548888801',
      sellerProfileId: sellerProfileA.id,
      universityId: knust.id,
      categoryId: category.id,
    },
  });

  // --------------------------------------------------------------------------
  // TEST 1: Unauthenticated checkout rejected (401)
  // --------------------------------------------------------------------------
  console.log('--- TEST 1: Authentication Requirement ---');
  {
    const { req, res, getStatus } = createMockReqRes({
      body: {
        items: [{ hustleId: hustleA.id, quantity: 1, meetupLocation: 'CCB Ground' }],
        contactPhone: '0248888803',
      },
      user: undefined,
    });
    await checkoutOrder(req, res);
    assert(getStatus() === 401, 'Unauthenticated checkout rejected with 401');
  }

  // --------------------------------------------------------------------------
  // TEST 2: Multi-Seller Cart Checkout & Server-Side Pricing
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 2: Multi-Seller Cart & Server-Side Pricing ---');
  let createdOrderId = '';
  let subOrderIdA = '';
  let subOrderIdB = '';
  const testIdempotencyKey = `idem_${Date.now()}`;

  {
    // Buyer C checks out:
    // 2 units of Hustle A (Seller A, price 50 -> 100)
    // 1 unit of Hustle B (Seller B, price 40 -> 40)
    // Client attempts to pass spoofed total: 10.00
    const { req, res, getStatus, getData } = createMockReqRes({
      body: {
        items: [
          { hustleId: hustleA.id, quantity: 2, meetupLocation: 'Ayeduase Gate' },
          { hustleId: hustleB.id, quantity: 1, meetupLocation: 'Brunei Complex Gate' },
        ],
        contactPhone: '0248888803',
        idempotencyKey: testIdempotencyKey,
        totalAmount: 10.00, // Client tries to spoof total price
      },
      user: { id: buyerUser.id },
    });

    await checkoutOrder(req, res);
    assert(getStatus() === 201, 'Order created successfully with 201 Created');

    const orderData = getData().data;
    createdOrderId = orderData.id;

    assert(orderData.totalAmount === 140.00, `Server-side total calculated as GH₵ 140.00 (Client 10.00 ignored)`);
    assert(orderData.subOrders.length === 2, `Exactly 2 sub-orders partitioned (1 per seller)`);

    const soA = orderData.subOrders.find((s: any) => s.sellerName.includes('Kwame'));
    const soB = orderData.subOrders.find((s: any) => s.sellerName.includes('Akua'));

    assert(Boolean(soA), 'Sub-order created for Seller A');
    assert(Boolean(soB), 'Sub-order created for Seller B');
    assert(soA.subtotal === 100.00, `Seller A subtotal is GH₵ 100.00 (2 x 50)`);
    assert(soB.subtotal === 40.00, `Seller B subtotal is GH₵ 40.00 (1 x 40)`);

    subOrderIdA = soA.id;
    subOrderIdB = soB.id;
  }

  // --------------------------------------------------------------------------
  // TEST 3: Self-Purchase Prevention
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 3: Self-Purchase Prevention ---');
  {
    // Seller A attempts to purchase their own Hustle A
    const { req, res, getStatus } = createMockReqRes({
      body: {
        items: [{ hustleId: hustleA.id, quantity: 1, meetupLocation: 'Anywhere' }],
        contactPhone: '0248888801',
      },
      user: { id: sellerUserA.id },
    });

    await checkoutOrder(req, res);
    assert(getStatus() === 400, 'Self-purchase rejected with 400 Bad Request');
  }

  // --------------------------------------------------------------------------
  // TEST 4: Unavailable / Paused Listing Rejection
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 4: Listing Availability Enforcement ---');
  {
    const { req, res, getStatus } = createMockReqRes({
      body: {
        items: [{ hustleId: hustlePaused.id, quantity: 1, meetupLocation: 'Anywhere' }],
        contactPhone: '0248888803',
      },
      user: { id: buyerUser.id },
    });

    await checkoutOrder(req, res);
    assert(getStatus() === 400, 'Busy/Paused hustle rejected with 400');
  }

  // --------------------------------------------------------------------------
  // TEST 5: Inventory Tracking & Stock Decrement
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 5: Inventory Tracking & Decrement ---');
  {
    // Hustle A started with stockQuantity = 3, and Buyer C checked out 2 units in Test 2.
    // Stock should now be 1!
    const updatedHustleA = await prisma.hustle.findUnique({ where: { id: hustleA.id } });
    assert(updatedHustleA?.stockQuantity === 1, `Inventory decremented atomically from 3 to 1 (got ${updatedHustleA?.stockQuantity})`);

    // Buyer C attempts to order 2 units (exceeds current stock of 1)
    const { req, res, getStatus } = createMockReqRes({
      body: {
        items: [{ hustleId: hustleA.id, quantity: 2, meetupLocation: 'Anywhere' }],
        contactPhone: '0248888803',
      },
      user: { id: buyerUser.id },
    });

    await checkoutOrder(req, res);
    assert(getStatus() === 409, 'Insufficient inventory rejected with 409 Conflict');
  }

  // --------------------------------------------------------------------------
  // TEST 6: Historical Price Preservation
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 6: Historical Price Preservation ---');
  {
    // Seller A updates price of Hustle A to GH₵ 999.00
    await prisma.hustle.update({
      where: { id: hustleA.id },
      data: { price: 999.00, title: 'MODIFIED TITLE LATER' },
    });

    // Query previous order item
    const orderItem = await prisma.orderItem.findFirst({
      where: { subOrderId: subOrderIdA },
    });

    assert(Number(orderItem?.snapshotPrice) === 50.00, `Original snapshotPrice preserved at GH₵ 50.00 (got ${orderItem?.snapshotPrice})`);
    assert(Number(orderItem?.lineTotal) === 100.00, `Original lineTotal preserved at GH₵ 100.00 (got ${orderItem?.lineTotal})`);
    assert(orderItem?.snapshotTitle === 'Original Type-C Fast Charger', 'Original snapshotTitle preserved');
  }

  // --------------------------------------------------------------------------
  // TEST 7: Idempotency Protection
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 7: Idempotency Protection ---');
  {
    // Repeat the exact checkout request with the same idempotency key
    const { req, res, getStatus, getData } = createMockReqRes({
      body: {
        items: [{ hustleId: hustleB.id, quantity: 1, meetupLocation: 'Brunei' }],
        contactPhone: '0248888803',
        idempotencyKey: testIdempotencyKey,
      },
      user: { id: buyerUser.id },
    });

    await checkoutOrder(req, res);
    assert(getStatus() === 200, 'Duplicate request returns existing order with 200 OK');
    assert(getData().data.id === createdOrderId, 'Returned exact existing order without duplicate records');
  }

  // --------------------------------------------------------------------------
  // TEST 8: Seller Privacy & Sub-Order Scoping
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 8: Seller Data Privacy Scoping ---');
  {
    // Seller A queries GET /api/orders/:id
    const { req: reqA, res: resA, getData: getDataA } = createMockReqRes({
      params: { id: createdOrderId },
      user: { id: sellerUserA.id, role: 'STUDENT' },
    });

    await getOrderById(reqA, resA);
    const sellerAView = getDataA().data;

    assert(sellerAView.subOrders.length === 1, 'Seller A can only see 1 sub-order (their own)');
    assert(sellerAView.subOrders[0].id === subOrderIdA, 'Seller A cannot see Seller B items');

    // Buyer queries GET /api/orders/:id
    const { req: reqBuyer, res: resBuyer, getData: getDataBuyer } = createMockReqRes({
      params: { id: createdOrderId },
      user: { id: buyerUser.id, role: 'STUDENT' },
    });

    await getOrderById(reqBuyer, resBuyer);
    const buyerView = getDataBuyer().data;
    assert(buyerView.subOrders.length === 2, 'Buyer sees all sub-orders in the parent order');
  }

  // --------------------------------------------------------------------------
  // TEST 9: Seller Fulfillment Lifecycle
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 9: Seller Fulfillment Lifecycle ---');
  {
    // Seller B attempts to update Seller A's sub-order (blocked)
    const { req: reqUnauthorized, res: resUnauthorized, getStatus: getStatusUnauth } = createMockReqRes({
      params: { id: subOrderIdA },
      body: { status: 'ACCEPTED' },
      user: { id: sellerUserB.id },
    });
    await updateSubOrderStatus(reqUnauthorized, resUnauthorized);
    assert(getStatusUnauth() === 403, 'Seller B blocked from modifying Seller A sub-order (403 Forbidden)');

    // Seller A: ACCEPTED
    const { req: reqAccept, res: resAccept, getData: getDataAccept } = createMockReqRes({
      params: { id: subOrderIdA },
      body: { status: 'ACCEPTED' },
      user: { id: sellerUserA.id },
    });
    await updateSubOrderStatus(reqAccept, resAccept);
    assert(getDataAccept().data.status === 'ACCEPTED', 'Seller A accepts sub-order');

    // Seller A: DELIVERED
    const { req: reqDelivered, res: resDelivered, getData: getDataDelivered } = createMockReqRes({
      params: { id: subOrderIdA },
      body: { status: 'DELIVERED' },
      user: { id: sellerUserA.id },
    });
    await updateSubOrderStatus(reqDelivered, resDelivered);
    assert(getDataDelivered().data.status === 'DELIVERED', 'Seller A marks sub-order DELIVERED');
  }

  // --------------------------------------------------------------------------
  // TEST 10: Buyer Confirmation & Escrow Release
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 10: Buyer Confirmation & Escrow Release ---');
  {
    // Buyer confirms delivery of SubOrder A
    const { req, res, getStatus, getData } = createMockReqRes({
      params: { id: subOrderIdA },
      user: { id: buyerUser.id },
    });

    await confirmSubOrderReceipt(req, res);
    assert(getStatus() === 200, 'Buyer confirms receipt with 200 OK');

    const confirmedSubOrder = getData().data;
    assert(confirmedSubOrder.status === SubOrderStatus.COMPLETED, 'Sub-order status transitioned to COMPLETED');
    assert(confirmedSubOrder.escrowStatus === EscrowStatus.RELEASED_TO_SELLER, 'Escrow released to seller MoMo');
  }

  // --------------------------------------------------------------------------
  // TEST 11: Cancellation Rules & Inventory Restoration
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 11: Cancellation & Inventory Restoration ---');
  {
    // SubOrder B is still in PENDING_ACCEPTANCE.
    // Buyer cancels SubOrder B.
    const { req, res, getStatus, getData } = createMockReqRes({
      params: { id: subOrderIdB },
      body: { reason: 'Changed mind, need to study' },
      user: { id: buyerUser.id },
    });

    await cancelSubOrder(req, res);
    assert(getStatus() === 200, 'Pending sub-order cancelled successfully');

    const cancelledSo = getData().data;
    assert(cancelledSo.status === SubOrderStatus.CANCELLED, 'Status is CANCELLED');
    assert(cancelledSo.escrowStatus === EscrowStatus.REFUNDED_TO_BUYER, 'Escrow marked REFUNDED_TO_BUYER');
  }

  // --------------------------------------------------------------------------
  // TEST 12: Dispute Handling
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 12: Dispute Handling (Freezing Escrow) ---');
  {
    // Create new quick sub-order to dispute
    const disputeHustle = await prisma.hustle.create({
      data: {
        id: `hst_disp_${Date.now()}`,
        title: 'Disputed Tech Item',
        description: 'Test item for dispute flow',
        price: 30.00,
        hostelLocation: 'Ayeduase',
        whatsAppContact: '233548888801',
        sellerProfileId: sellerProfileA.id,
        universityId: knust.id,
        categoryId: category.id,
      },
    });

    const { req: reqCheckout, res: resCheckout, getData: getDataCheckout } = createMockReqRes({
      body: {
        items: [{ hustleId: disputeHustle.id, quantity: 1, meetupLocation: 'Hall 7' }],
        contactPhone: '0248888803',
      },
      user: { id: buyerUser.id },
    });
    await checkoutOrder(reqCheckout, resCheckout);
    const dispSubOrderId = getDataCheckout().data.subOrders[0].id;

    // Buyer raises a dispute
    const { req: reqDisp, res: resDisp, getStatus: getStatusDisp, getData: getDataDisp } = createMockReqRes({
      params: { id: dispSubOrderId },
      body: { reason: 'Item received had broken connectors.' },
      user: { id: buyerUser.id },
    });

    await disputeSubOrder(reqDisp, resDisp);
    assert(getStatusDisp() === 200, 'Dispute opened with 200 OK');
    assert(getDataDisp().data.status === SubOrderStatus.DISPUTED, 'Sub-order status is DISPUTED');
    assert(getDataDisp().data.escrowStatus === EscrowStatus.DISPUTED, 'Escrow funds safely frozen');
  }

  console.log(`\n======================================================`);
  console.log(`🎉 Marketplace Order Architecture Tests Complete:`);
  console.log(`   Passed: ${passed}`);
  console.log(`   Failed: ${failed}`);
  console.log(`======================================================\n`);

  if (failed > 0) process.exit(1);
}

runOrderArchitectureTests()
  .catch((e) => {
    console.error('Fatal test error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
