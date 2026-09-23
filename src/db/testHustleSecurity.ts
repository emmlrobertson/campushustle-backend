import { prisma } from './prisma';
import jwt from 'jsonwebtoken';
import {
  createHustle,
  updateHustle,
  deleteHustle,
  toggleHustleStatus,
  getAllHustles,
  getHustleById,
  createHustleReview,
} from '../controllers/hustleController';

// Helper to mock Express req/res
function createMockReqRes(options: {
  body?: any;
  params?: any;
  query?: any;
  user?: any;
}) {
  const req: any = {
    body: options.body || {},
    params: options.params || {},
    query: options.query || {},
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

async function runHustleSecurityTests() {
  console.log('🧪 Starting Hustle / Listing Security & Functionality Tests...\n');
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

  // 1. Setup Test Universities & Students
  const knust = await prisma.university.findUnique({ where: { code: 'KNUST' } });
  const ug = await prisma.university.findUnique({ where: { code: 'UG' } });

  if (!knust || !ug) {
    throw new Error('KNUST or UG not found in database. Run seed first.');
  }

  // Seller A (KNUST)
  const sellerA = await prisma.user.upsert({
    where: { email: 'seller.a@st.knust.edu.gh' },
    update: {},
    create: {
      email: 'seller.a@st.knust.edu.gh',
      name: 'Kwame Tech',
      phoneNumber: '233541111111',
      phoneVerified: true,
      passwordHash: '$2a$10$FakeHashForTestingOnly1234567890123456789012',
      program: 'Computer Engineering',
      hostelLocation: 'Ayeduase Central',
      universityId: knust.id,
    },
    include: { sellerProfile: true },
  });

  // Seller B (UG Legon)
  const sellerB = await prisma.user.upsert({
    where: { email: 'seller.b@st.ug.edu.gh' },
    update: {},
    create: {
      email: 'seller.b@st.ug.edu.gh',
      name: 'Ama Legon',
      phoneNumber: '233542222222',
      phoneVerified: true,
      passwordHash: '$2a$10$FakeHashForTestingOnly1234567890123456789012',
      program: 'Administration',
      hostelLocation: 'Pentagon',
      universityId: ug.id,
    },
    include: { sellerProfile: true },
  });

  // Buyer C (KNUST)
  const buyerC = await prisma.user.upsert({
    where: { email: 'buyer.c@st.knust.edu.gh' },
    update: {},
    create: {
      email: 'buyer.c@st.knust.edu.gh',
      name: 'Kofi Reviewer',
      phoneNumber: '233543333333',
      phoneVerified: true,
      passwordHash: '$2a$10$FakeHashForTestingOnly1234567890123456789012',
      program: 'Civil Engineering',
      hostelLocation: 'Brunei',
      universityId: knust.id,
    },
  });

  // Buyer D (KNUST)
  const buyerD = await prisma.user.upsert({
    where: { email: 'buyer.d@st.knust.edu.gh' },
    update: {},
    create: {
      email: 'buyer.d@st.knust.edu.gh',
      name: 'Akua Student',
      phoneNumber: '233544444444',
      phoneVerified: true,
      passwordHash: '$2a$10$FakeHashForTestingOnly1234567890123456789012',
      program: 'Chemical Engineering',
      hostelLocation: 'Gaza',
      universityId: knust.id,
    },
  });

  let createdHustleId = '';

  // --------------------------------------------------------------------------
  // TEST 1: Unauthenticated request rejected (401)
  // --------------------------------------------------------------------------
  console.log('--- TEST 1: Authentication Enforcement ---');
  {
    const { req, res, getStatus } = createMockReqRes({
      body: { title: 'No Auth Laptop Repair', description: 'Quick fixes', price: 50, category: 'tech_repair' },
      user: undefined, // No authenticated user
    });
    await createHustle(req, res);
    assert(getStatus() === 401, 'Unauthenticated hustle creation returns 401');
  }

  // --------------------------------------------------------------------------
  // TEST 2: Zod Validation Rejections (400)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 2: Zod Request Body Validation ---');
  {
    // A: Negative price
    const { req, res, getStatus } = createMockReqRes({
      body: { title: 'Valid Title Here', description: 'Valid description text here', price: -20, category: 'tech_repair' },
      user: { id: sellerA.id, email: sellerA.email },
    });
    await createHustle(req, res);
    assert(getStatus() === 400, 'Rejects negative price (-20)');

    // B: Title too short
    const { req: req2, res: res2, getStatus: getStatus2 } = createMockReqRes({
      body: { title: 'Hi', description: 'Valid description text here', price: 20, category: 'tech_repair' },
      user: { id: sellerA.id, email: sellerA.email },
    });
    await createHustle(req2, res2);
    assert(getStatus2() === 400, 'Rejects title shorter than 3 characters');

    // C: Description too short
    const { req: req3, res: res3, getStatus: getStatus3 } = createMockReqRes({
      body: { title: 'Valid Title Here', description: 'Short', price: 20, category: 'tech_repair' },
      user: { id: sellerA.id, email: sellerA.email },
    });
    await createHustle(req3, res3);
    assert(getStatus3() === 400, 'Rejects description shorter than 10 characters');
  }

  // --------------------------------------------------------------------------
  // TEST 3: Seller Identity & University Derivation (Security Rule)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 3: Seller Identity & University Derivation ---');
  {
    const maliciousPayload = {
      title: 'Premium Laptop Screen & Keyboard Repairs',
      description: 'Expert repairs for MacBooks, Dell, HP and Lenovo laptops on KNUST campus.',
      price: 150,
      priceType: 'flat',
      category: 'tech_repair',
      hostelLocation: 'Ayeduase Central',
      whatsAppNumber: '233541111111',
      // Attacker tries to impersonate Seller B and spoof UG university:
      sellerId: sellerB.id,
      sellerProfileId: 'fake_profile_id',
      universityId: ug.id,
      campus: 'ug_legon',
      rating: 5.0,
      reviewCount: 500, // Attacker tries to inject fake reviews
    };

    const { req, res, getStatus, getData } = createMockReqRes({
      body: maliciousPayload,
      user: { id: sellerA.id, email: sellerA.email },
    });

    await createHustle(req, res);
    assert(getStatus() === 201, 'Hustle created successfully with 201');

    const data = getData().data;
    createdHustleId = data.id;

    assert(data.sellerId === sellerA.id, 'Seller ID derived strictly from token (Seller B spoof ignored)');
    assert(data.campus === 'knust', 'University derived strictly from user record (UG spoof ignored)');
    assert(data.reviewCount === 0, 'Client-supplied reviewCount (500) ignored (initialized to 0)');
  }

  // --------------------------------------------------------------------------
  // TEST 4: Edit Listing Ownership Enforcement
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 4: Edit Listing Ownership Enforcement ---');
  {
    // Seller B attempts to edit Seller A's hustle
    const { req, res, getStatus } = createMockReqRes({
      params: { id: createdHustleId },
      body: { title: 'Hacked Listing Title by Seller B', price: 10 },
      user: { id: sellerB.id, email: sellerB.email },
    });

    await updateHustle(req, res);
    assert(getStatus() === 403, 'Seller B blocked from editing Seller A hustle (returns 403 Forbidden)');

    // Seller A (legitimate owner) edits their own hustle
    const { req: reqOwner, res: resOwner, getStatus: getStatusOwner, getData: getDataOwner } = createMockReqRes({
      params: { id: createdHustleId },
      body: { title: 'Updated Screen & Battery Repairs', price: 175 },
      user: { id: sellerA.id, email: sellerA.email },
    });

    await updateHustle(reqOwner, resOwner);
    assert(getStatusOwner() === 200, 'Seller A successfully updates their own hustle');
    assert(getDataOwner().data.title === 'Updated Screen & Battery Repairs', 'Title updated correctly');
    assert(getDataOwner().data.price === 175, 'Price updated correctly');
  }

  // --------------------------------------------------------------------------
  // TEST 5: Status Toggle Ownership Enforcement
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 5: Status Toggle Ownership Enforcement ---');
  {
    // Seller B attempts to toggle status
    const { req, res, getStatus } = createMockReqRes({
      params: { id: createdHustleId },
      body: { status: 'BUSY' },
      user: { id: sellerB.id, email: sellerB.email },
    });
    await toggleHustleStatus(req, res);
    assert(getStatus() === 403, 'Seller B blocked from toggling Seller A status (returns 403 Forbidden)');

    // Seller A toggles status
    const { req: reqOwner, res: resOwner, getStatus: getStatusOwner, getData: getDataOwner } = createMockReqRes({
      params: { id: createdHustleId },
      body: { status: 'BUSY' },
      user: { id: sellerA.id, email: sellerA.email },
    });
    await toggleHustleStatus(reqOwner, resOwner);
    assert(getStatusOwner() === 200, 'Seller A toggles status successfully');
    assert(getDataOwner().status === 'BUSY', 'Status is now BUSY');
  }

  // --------------------------------------------------------------------------
  // TEST 6: Review Self-Review Prevention & Atomic Calculation
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 6: Review Integrity & Dynamic Calculation ---');
  {
    // A: Seller A attempts to review their own hustle
    const { req: reqSelf, res: resSelf, getStatus: getStatusSelf } = createMockReqRes({
      params: { id: createdHustleId },
      body: { rating: 5, comment: 'I am the best seller on campus!' },
      user: { id: sellerA.id, email: sellerA.email },
    });
    await createHustleReview(reqSelf, resSelf);
    assert(getStatusSelf() === 400, 'Seller A blocked from reviewing own hustle (returns 400 Bad Request)');

    // B: Buyer C attempts to review without a completed order (Must be rejected with 403)
    const { req: reqUnverified, res: resUnverified, getStatus: getStatusUnverified } = createMockReqRes({
      params: { id: createdHustleId },
      body: { rating: 5, comment: 'Nice!' },
      user: { id: buyerC.id, email: buyerC.email },
    });
    await createHustleReview(reqUnverified, resUnverified);
    assert(getStatusUnverified() === 403, 'Buyer without completed order blocked from reviewing (returns 403 Forbidden)');

    // Create completed SubOrders + OrderItems for Buyer C & Buyer D to grant verified review capability
    const createdHustleRecord = await prisma.hustle.findUnique({
      where: { id: createdHustleId },
    });
    const sellerProfileId = createdHustleRecord!.sellerProfileId;

    const orderC = await prisma.order.create({
      data: {
        orderNumber: `CH-KNUST-TEST-${Date.now()}-C`,
        buyerId: buyerC.id,
        totalAmount: 150,
        status: 'COMPLETED',
        subOrders: {
          create: {
            subOrderNumber: `CH-KNUST-TEST-${Date.now()}-C1`,
            sellerProfileId,
            subtotal: 150,
            meetupLocation: 'CCB Ground Floor',
            status: 'COMPLETED',
            items: {
              create: {
                hustleId: createdHustleId,
                snapshotTitle: 'iPhone Screen Replacement',
                snapshotPrice: 150,
                quantity: 1,
                lineTotal: 150,
              },
            },
          },
        },
      },
    });

    const orderD = await prisma.order.create({
      data: {
        orderNumber: `CH-KNUST-TEST-${Date.now()}-D`,
        buyerId: buyerD.id,
        totalAmount: 150,
        status: 'COMPLETED',
        subOrders: {
          create: {
            subOrderNumber: `CH-KNUST-TEST-${Date.now()}-D1`,
            sellerProfileId,
            subtotal: 150,
            meetupLocation: 'CCB Ground Floor',
            status: 'COMPLETED',
            items: {
              create: {
                hustleId: createdHustleId,
                snapshotTitle: 'iPhone Screen Replacement',
                snapshotPrice: 150,
                quantity: 1,
                lineTotal: 150,
              },
            },
          },
        },
      },
    });

    // C: Buyer C leaves a verified 4-star review
    const { req: reqBuyerC, res: resBuyerC, getStatus: getStatusBuyerC } = createMockReqRes({
      params: { id: createdHustleId },
      body: { rating: 4, comment: 'Great repair service, screen looks brand new.' },
      user: { id: buyerC.id, email: buyerC.email },
    });
    await createHustleReview(reqBuyerC, resBuyerC);
    assert(getStatusBuyerC() === 201, 'Verified Buyer C posts 4-star review successfully');

    // D: Buyer D leaves a verified 2-star review
    const { req: reqBuyerD, res: resBuyerD, getStatus: getStatusBuyerD } = createMockReqRes({
      params: { id: createdHustleId },
      body: { rating: 2, comment: 'Took longer than expected to finish.' },
      user: { id: buyerD.id, email: buyerD.email },
    });
    await createHustleReview(reqBuyerD, resBuyerD);
    assert(getStatusBuyerD() === 201, 'Verified Buyer D posts 2-star review successfully');

    // E: Verify Hustle rating recalculated dynamically: (4 + 2) / 2 = 3.0, count = 2
    const { req: reqFetch, res: resFetch, getData: getDataFetch } = createMockReqRes({
      params: { id: createdHustleId },
    });
    await getHustleById(reqFetch, resFetch);
    const hustleData = getDataFetch().data;

    assert(hustleData.rating === 3.0, `Rating dynamically calculated to 3.0 (got ${hustleData.rating})`);
    assert(hustleData.reviewCount === 2, `Review count dynamically calculated to 2 (got ${hustleData.reviewCount})`);
  }

  // --------------------------------------------------------------------------
  // TEST 7: Filtering, Search, Price Range, and Pagination
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 7: Filtering, Search, Price Range, and Pagination ---');
  {
    // A: Campus Filter (KNUST)
    const { req: reqKnust, res: resKnust, getData: getDataKnust } = createMockReqRes({
      query: { campus: 'knust' },
    });
    await getAllHustles(reqKnust, resKnust);
    const knustResults = getDataKnust().data;
    assert(knustResults.every((h: any) => h.campus === 'knust'), 'Campus filter returns only KNUST listings');

    // B: Price Range Filter
    const { req: reqPrice, res: resPrice, getData: getDataPrice } = createMockReqRes({
      query: { minPrice: 100, maxPrice: 200 },
    });
    await getAllHustles(reqPrice, resPrice);
    const priceResults = getDataPrice().data;
    assert(
      priceResults.every((h: any) => h.price >= 100 && h.price <= 200),
      'Price filter respects minPrice and maxPrice'
    );

    // C: Search Query
    const { req: reqSearch, res: resSearch, getData: getDataSearch } = createMockReqRes({
      query: { search: 'Battery' },
    });
    await getAllHustles(reqSearch, resSearch);
    const searchResults = getDataSearch().data;
    assert(searchResults.length > 0, 'Search matches keyword in title or description');

    // D: Pagination
    const { req: reqPage, res: resPage, getData: getDataPage } = createMockReqRes({
      query: { page: 1, limit: 1 },
    });
    await getAllHustles(reqPage, resPage);
    const paged = getDataPage();
    assert(paged.data.length === 1, 'Pagination limit=1 returns exactly 1 item');
    assert(paged.page === 1, 'Page number is 1');
    assert(paged.total >= 1, 'Total items count is reported');
  }

  // --------------------------------------------------------------------------
  // TEST 8: Delete Listing Ownership Enforcement
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 8: Deletion Ownership Enforcement ---');
  {
    // Seller B attempts to delete Seller A's hustle
    const { req: reqB, res: resB, getStatus: getStatusB } = createMockReqRes({
      params: { id: createdHustleId },
      user: { id: sellerB.id, email: sellerB.email, role: 'STUDENT' },
    });
    await deleteHustle(reqB, resB);
    assert(getStatusB() === 403, 'Seller B blocked from deleting Seller A listing (returns 403 Forbidden)');

    // Seller A deletes their own hustle
    const { req: reqA, res: resA, getStatus: getStatusA } = createMockReqRes({
      params: { id: createdHustleId },
      user: { id: sellerA.id, email: sellerA.email, role: 'STUDENT' },
    });
    await deleteHustle(reqA, resA);
    assert(getStatusA() === 200, 'Seller A deletes own listing successfully (returns 200)');

    // Verify it is gone
    const { req: reqCheck, res: resCheck, getStatus: getStatusCheck } = createMockReqRes({
      params: { id: createdHustleId },
    });
    await getHustleById(reqCheck, resCheck);
    assert(getStatusCheck() === 404, 'Deleted hustle is no longer found (returns 404)');
  }

  console.log(`\n======================================================`);
  console.log(`🎉 Hustle Security & Integration Tests Complete:`);
  console.log(`   Passed: ${passed}`);
  console.log(`   Failed: ${failed}`);
  console.log(`======================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runHustleSecurityTests()
  .catch((e) => {
    console.error('Fatal test error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
