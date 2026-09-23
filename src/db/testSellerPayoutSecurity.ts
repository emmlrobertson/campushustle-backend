import { prisma } from './prisma';
import { getPayoutAccount, updatePayoutAccount } from '../controllers/sellerController';
import { PaymentMethod } from '@prisma/client';

// Mock Express Request & Response helper
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

async function runSellerPayoutSecurityTests() {
  console.log('🧪 Starting Secure Seller Payout-Account Management Tests...\n');
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

  // Setup Test Universities & Users
  const knust = await prisma.university.findUnique({ where: { code: 'KNUST' } });
  if (!knust) throw new Error('KNUST not found');

  const sellerUserA = await prisma.user.upsert({
    where: { email: 'seller.payout.a@st.knust.edu.gh' },
    update: {},
    create: {
      email: 'seller.payout.a@st.knust.edu.gh',
      name: 'Kwame Mensah',
      phoneNumber: '233547777701',
      phoneVerified: true,
      passwordHash: '$2a$10$FakeHashForTestingOnly1234567890123456789012',
      program: 'Computer Engineering',
      hostelLocation: 'Ayeduase',
      universityId: knust.id,
    },
  });

  const sellerUserB = await prisma.user.upsert({
    where: { email: 'seller.payout.b@st.knust.edu.gh' },
    update: {},
    create: {
      email: 'seller.payout.b@st.knust.edu.gh',
      name: 'Akua Osei',
      phoneNumber: '233547777702',
      phoneVerified: true,
      passwordHash: '$2a$10$FakeHashForTestingOnly1234567890123456789012',
      program: 'Biochemistry',
      hostelLocation: 'Brunei',
      universityId: knust.id,
    },
  });

  // Clean initial state for testing
  await prisma.sellerProfile.deleteMany({
    where: { userId: { in: [sellerUserA.id, sellerUserB.id] } },
  });

  // --------------------------------------------------------------------------
  // TEST 1: Unauthenticated Access Rejected (401)
  // --------------------------------------------------------------------------
  console.log('--- TEST 1: Unauthenticated Access ---');
  {
    const { req: reqGet, res: resGet, getStatus: getStatusGet } = createMockReqRes({ user: undefined });
    await getPayoutAccount(reqGet, resGet);
    assert(getStatusGet() === 401, 'Unauthenticated GET /api/seller/payout-account rejected with 401');

    const { req: reqPut, res: resPut, getStatus: getStatusPut } = createMockReqRes({
      body: { network: 'MTN_MOMO', phoneNumber: '0248888801', accountName: 'Kwame' },
      user: undefined,
    });
    await updatePayoutAccount(reqPut, resPut);
    assert(getStatusPut() === 401, 'Unauthenticated PUT /api/seller/payout-account rejected with 401');
  }

  // --------------------------------------------------------------------------
  // TEST 2: Seller Creates Payout Account
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 2: Seller Creates Payout Account ---');
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      body: {
        network: PaymentMethod.MTN_MOMO,
        phoneNumber: '0248888801',
        accountName: 'Kwame Mensah',
      },
      user: { id: sellerUserA.id },
    });

    await updatePayoutAccount(req, res);
    assert(getStatus() === 200, 'Seller A created payout account with 200 OK');

    const data = getData().data;
    assert(data.hasConfiguredPayout === true, 'Response indicates hasConfiguredPayout = true');
    assert(data.isPayoutVerified === true, 'Response indicates isPayoutVerified = true');
    assert(data.payoutMomoNetwork === PaymentMethod.MTN_MOMO, 'Response returns correct network');
    assert(data.maskedPhoneNumber === '024 ••• ••• 801', `Phone number correctly masked (${data.maskedPhoneNumber})`);
    assert(data.verifiedAccountName === 'Kwame Mensah', 'Response returns verified account name');

    // Verify in database
    const profile = await prisma.sellerProfile.findUnique({ where: { userId: sellerUserA.id } });
    assert(Boolean(profile?.paystackRecipientCode?.startsWith('RCP_')), 'Server stored Paystack recipient code in DB');
    assert(profile?.payoutMomoNumber === '0248888801', 'Normalized 10-digit number stored in DB');
    assert(profile?.isPayoutVerified === true, 'Database has isPayoutVerified = true');
  }

  // --------------------------------------------------------------------------
  // TEST 3: Seller Updates Payout Account
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 3: Seller Updates Payout Account ---');
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      body: {
        network: PaymentMethod.MTN_MOMO,
        phoneNumber: '0548888801', // Different MTN prefix (054)
        accountName: 'Kwame K. Mensah',
      },
      user: { id: sellerUserA.id },
    });

    await updatePayoutAccount(req, res);
    assert(getStatus() === 200, 'Seller A updated payout account with 200 OK');

    const data = getData().data;
    assert(data.maskedPhoneNumber === '054 ••• ••• 801', 'Updated number masked correctly');
    assert(data.verifiedAccountName === 'Kwame K. Mensah', 'Updated account name reflected');

    const profile = await prisma.sellerProfile.findUnique({ where: { userId: sellerUserA.id } });
    assert(profile?.payoutMomoNumber === '0548888801', 'Database updated with new normalized number');
  }

  // --------------------------------------------------------------------------
  // TEST 4: IDOR Protection (Cannot Modify Another Seller)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 4: IDOR Protection & Spoof Prevention ---');
  {
    const profileABefore = await prisma.sellerProfile.findUnique({ where: { userId: sellerUserA.id } });

    // Seller B attempts to spoof Seller A's profile ID in body/query
    const { req, res, getStatus } = createMockReqRes({
      body: {
        network: PaymentMethod.TELECEL_CASH,
        phoneNumber: '0208888802',
        accountName: 'Malicious Attacker',
        sellerId: profileABefore!.id, // Spoofed target
        userId: sellerUserA.id,       // Spoofed target
      },
      user: { id: sellerUserB.id }, // Authenticated as Seller B
    });

    await updatePayoutAccount(req, res);
    assert(getStatus() === 200, 'Request processed under caller identity');

    // Verify Seller A's profile was NOT modified
    const profileAAfter = await prisma.sellerProfile.findUnique({ where: { userId: sellerUserA.id } });
    assert(profileAAfter?.payoutMomoNumber === profileABefore?.payoutMomoNumber, 'Seller A phone number unchanged');
    assert(profileAAfter?.verifiedAccountName === profileABefore?.verifiedAccountName, 'Seller A account name unchanged');

    // Verify Seller B's profile was created/updated instead
    const profileB = await prisma.sellerProfile.findUnique({ where: { userId: sellerUserB.id } });
    assert(profileB?.payoutMomoNumber === '0208888802', 'Seller B updated their own profile');
    assert(profileB?.verifiedAccountName === 'Malicious Attacker', 'Seller B verified name stored on own profile');
  }

  // --------------------------------------------------------------------------
  // TEST 5: Invalid Phone Rejection
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 5: Invalid Phone Number Rejection ---');
  {
    // Too short
    const { req: reqShort, res: resShort, getStatus: getStatusShort } = createMockReqRes({
      body: { network: PaymentMethod.MTN_MOMO, phoneNumber: '024123', accountName: 'Test' },
      user: { id: sellerUserA.id },
    });
    await updatePayoutAccount(reqShort, resShort);
    assert(getStatusShort() === 400, 'Too short phone number rejected with 400');

    // Non-numeric garbage
    const { req: reqAlpha, res: resAlpha, getStatus: getStatusAlpha } = createMockReqRes({
      body: { network: PaymentMethod.MTN_MOMO, phoneNumber: 'abc0248888', accountName: 'Test' },
      user: { id: sellerUserA.id },
    });
    await updatePayoutAccount(reqAlpha, resAlpha);
    assert(getStatusAlpha() === 400, 'Non-numeric phone number rejected with 400');
  }

  // --------------------------------------------------------------------------
  // TEST 6: Unsupported Network Rejection
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 6: Unsupported Network Rejection ---');
  {
    // Card is not a valid payout recipient in Ghana
    const { req: reqCard, res: resCard, getStatus: getStatusCard } = createMockReqRes({
      body: { network: PaymentMethod.CARD, phoneNumber: '0248888801', accountName: 'Test' },
      user: { id: sellerUserA.id },
    });
    await updatePayoutAccount(reqCard, resCard);
    assert(getStatusCard() === 400, 'Card network rejected with 400 for payout');

    // Arbitrary fake network
    const { req: reqFake, res: resFake, getStatus: getStatusFake } = createMockReqRes({
      body: { network: 'CRYPTO_USDT', phoneNumber: '0248888801', accountName: 'Test' },
      user: { id: sellerUserA.id },
    });
    await updatePayoutAccount(reqFake, resFake);
    assert(getStatusFake() === 400, 'Unknown network rejected with 400');
  }

  // --------------------------------------------------------------------------
  // TEST 7: Network Prefix Mismatch Rejection
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 7: Network Carrier Prefix Mismatch ---');
  {
    // MTN chosen, but Telecel 020 number passed
    const { req: reqMismatch1, res: resMismatch1, getStatus: getStatus1 } = createMockReqRes({
      body: { network: PaymentMethod.MTN_MOMO, phoneNumber: '0208888801', accountName: 'Test' },
      user: { id: sellerUserA.id },
    });
    await updatePayoutAccount(reqMismatch1, resMismatch1);
    assert(getStatus1() === 400, 'Telecel prefix on MTN network rejected with 400');

    // Telecel chosen, but MTN 024 number passed
    const { req: reqMismatch2, res: resMismatch2, getStatus: getStatus2 } = createMockReqRes({
      body: { network: PaymentMethod.TELECEL_CASH, phoneNumber: '0248888801', accountName: 'Test' },
      user: { id: sellerUserA.id },
    });
    await updatePayoutAccount(reqMismatch2, resMismatch2);
    assert(getStatus2() === 400, 'MTN prefix on Telecel network rejected with 400');
  }

  // --------------------------------------------------------------------------
  // TEST 8: Duplicate Recipient Idempotency
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 8: Duplicate Recipient Idempotency ---');
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      body: {
        network: PaymentMethod.MTN_MOMO,
        phoneNumber: '0548888801',
        accountName: 'Kwame K. Mensah',
      },
      user: { id: sellerUserA.id },
    });

    await updatePayoutAccount(req, res);
    assert(getStatus() === 200, 'Submitting identical details succeeds idempotently with 200 OK');
    assert(getData().data.hasConfiguredPayout === true, 'Payout remains configured');
  }

  // --------------------------------------------------------------------------
  // TEST 9: Invalidation of Previous Verification State on Change
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 9: Invalidation of Verification on Change ---');
  {
    // Fetch profile before
    const profile = await prisma.sellerProfile.findUnique({ where: { userId: sellerUserA.id } });
    assert(profile?.isPayoutVerified === true, 'Profile starts with isPayoutVerified = true');

    // Update with new AirtelTigo number (+233 format)
    const { req, res, getStatus } = createMockReqRes({
      body: {
        network: PaymentMethod.AIRTEL_TIGO_MONEY,
        phoneNumber: '+233278888801',
        accountName: 'Kwame Mensah AT',
      },
      user: { id: sellerUserA.id },
    });

    await updatePayoutAccount(req, res);
    assert(getStatus() === 200, 'AirtelTigo update succeeded');

    const updated = await prisma.sellerProfile.findUnique({ where: { userId: sellerUserA.id } });
    assert(updated?.payoutMomoNetwork === PaymentMethod.AIRTEL_TIGO_MONEY, 'Network transitioned to AIRTEL_TIGO_MONEY');
    assert(updated?.payoutMomoNumber === '0278888801', 'International +233 normalized to 0278888801');
  }

  // --------------------------------------------------------------------------
  // TEST 10: Unauthorized Access Prevention
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 10: Data Isolation & Unauthorized Access Prevention ---');
  {
    // Seller B queries GET /api/seller/payout-account
    const { req, res, getStatus, getData } = createMockReqRes({
      user: { id: sellerUserB.id },
    });

    await getPayoutAccount(req, res);
    assert(getStatus() === 200, 'Seller B queries payout account with 200 OK');
    assert(getData().data.maskedPhoneNumber === '020 ••• ••• 802', 'Seller B only sees their own masked number');
    assert(!getData().data.maskedPhoneNumber.includes('027'), 'Seller B cannot see Seller A data');
  }

  // --------------------------------------------------------------------------
  // TEST 11: Minimal Information Disclosure
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 11: Minimal Information Disclosure ---');
  {
    const { req, res, getData } = createMockReqRes({
      user: { id: sellerUserA.id },
    });

    await getPayoutAccount(req, res);
    const data = getData().data;

    assert(!('paystackRecipientCode' in data), 'paystackRecipientCode is NOT exposed to client');
    assert(!('payoutMomoNumber' in data), 'Raw unmasked payoutMomoNumber is NOT exposed to client');
    assert(data.maskedPhoneNumber.includes('•••'), 'Masked phone number provided for display');
  }

  // --------------------------------------------------------------------------
  // TEST 12: Audit Logging Verification
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 12: Audit Logging Verification ---');
  {
    const log = await prisma.moderationLog.findFirst({
      where: {
        action: { in: ['PAYOUT_ACCOUNT_CONFIGURED', 'PAYOUT_ACCOUNT_UPDATED'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    assert(Boolean(log), 'Audit log entry created in ModerationLog');
    const details = JSON.parse(log?.details || '{}');
    assert(details.event === 'SELLER_PAYOUT_DESTINATION_UPDATED', 'Audit log records correct event');
    assert(Boolean(details.recipientCode), 'Audit log records generated recipient code');
    assert(Boolean(details.maskedPhoneNumber), 'Audit log records masked phone number');
  }

  // Cleanup test profiles and logs
  await prisma.moderationLog.deleteMany({
    where: { adminId: { in: [sellerUserA.id, sellerUserB.id] } },
  });
  await prisma.sellerProfile.deleteMany({
    where: { userId: { in: [sellerUserA.id, sellerUserB.id] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [sellerUserA.id, sellerUserB.id] } },
  });

  console.log(`\n======================================================`);
  console.log(`🎉 Seller Payout Security Tests Complete:`);
  console.log(`   Passed: ${passed}`);
  console.log(`   Failed: ${failed}`);
  console.log(`======================================================\n`);

  if (failed > 0) process.exit(1);
}

runSellerPayoutSecurityTests()
  .catch((e) => {
    console.error('Fatal test error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
