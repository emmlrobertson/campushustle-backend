import { prisma } from './prisma';
import { storageService } from '../services/storageService';
import {
  uploadHustleImageHandler,
  uploadHustleImagesForListingHandler,
  deleteHustle,
} from '../controllers/hustleController';
import { validateImageBuffer } from '../middleware/uploadMiddleware';

// Mock Express req/res
function createMockReqRes(options: {
  body?: any;
  params?: any;
  user?: any;
  file?: any;
}) {
  const req: any = {
    body: options.body || {},
    params: options.params || {},
    user: options.user,
    file: options.file,
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

async function runImageUploadSecurityTests() {
  console.log('🧪 Starting Image Upload Security & Storage Tests...\n');
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

  // Setup test sellers
  const knust = await prisma.university.findUnique({ where: { code: 'KNUST' } });
  const ug = await prisma.university.findUnique({ where: { code: 'UG' } });

  if (!knust || !ug) throw new Error('Universities not found');

  const sellerA = await prisma.user.upsert({
    where: { email: 'img.seller.a@st.knust.edu.gh' },
    update: {},
    create: {
      email: 'img.seller.a@st.knust.edu.gh',
      name: 'Seller Kwame',
      phoneNumber: '233549999901',
      phoneVerified: true,
      passwordHash: '$2a$10$FakeHashForTestingOnly1234567890123456789012',
      program: 'Art',
      hostelLocation: 'Ayeduase',
      universityId: knust.id,
    },
    include: { sellerProfile: true },
  });

  const sellerB = await prisma.user.upsert({
    where: { email: 'img.seller.b@st.ug.edu.gh' },
    update: {},
    create: {
      email: 'img.seller.b@st.ug.edu.gh',
      name: 'Seller Ama',
      phoneNumber: '233549999902',
      phoneVerified: true,
      passwordHash: '$2a$10$FakeHashForTestingOnly1234567890123456789012',
      program: 'Design',
      hostelLocation: 'Pentagon',
      universityId: ug.id,
    },
    include: { sellerProfile: true },
  });

  let sellerProfileA = sellerA.sellerProfile;
  if (!sellerProfileA) {
    sellerProfileA = await prisma.sellerProfile.create({
      data: {
        userId: sellerA.id,
        businessName: 'Kwame Tech Art',
        payoutMomoNumber: '0249999901',
      },
    });
  }

  const testCategory = await prisma.category.findFirst();
  if (!testCategory) throw new Error('Category not found');

  // Create a test hustle for Seller A
  const hustleA = await prisma.hustle.create({
    data: {
      id: `hst_img_test_${Date.now()}`,
      title: 'Dorm Portrait Photography',
      description: 'High resolution campus portraits and graduation shoots.',
      price: 120,
      hostelLocation: 'Ayeduase',
      whatsAppContact: '233549999901',
      sellerProfileId: sellerProfileA.id,
      universityId: knust.id,
      categoryId: testCategory.id,
    },
  });

  // Valid 1x1 PNG image buffer with genuine magic bytes
  const validPngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

  // Malicious buffer disguised as PNG
  const fakeSvgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>');

  // --------------------------------------------------------------------------
  // TEST 1: Unauthenticated upload rejected (401)
  // --------------------------------------------------------------------------
  console.log('--- TEST 1: Authentication Requirement ---');
  {
    const { req, res, getStatus } = createMockReqRes({
      file: { buffer: validPngBuffer, mimetype: 'image/png', originalname: 'test.png' },
      user: undefined,
    });
    await uploadHustleImageHandler(req, res);
    assert(getStatus() === 401, 'Unauthenticated upload rejected with 401');
  }

  // --------------------------------------------------------------------------
  // TEST 2: Missing image buffer rejected (400)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 2: Missing File Handling ---');
  {
    const { req, res, getStatus } = createMockReqRes({
      file: undefined,
      user: { id: sellerA.id },
    });
    await uploadHustleImageHandler(req, res);
    assert(getStatus() === 400, 'Missing image rejected with 400');
  }

  // --------------------------------------------------------------------------
  // TEST 3: Magic Byte Verification (Rejecting Malicious Disguised Files)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 3: Magic Byte Inspection (Anti-Spoofing) ---');
  {
    let nextCalled = false;
    const { req, res, getStatus } = createMockReqRes({
      file: { buffer: fakeSvgBuffer, mimetype: 'image/png', originalname: 'innocent.png' },
      user: { id: sellerA.id },
    });

    validateImageBuffer(req, res, () => {
      nextCalled = true;
    });

    assert(!nextCalled && getStatus() === 400, 'Disguised SVG with .png extension rejected by magic byte validator (400)');
  }

  // --------------------------------------------------------------------------
  // TEST 4: Valid Image Upload & Safe CSPRNG Identifier Generation
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 4: Valid Upload & Safe Unique Naming ---');
  let uploadedResult: any = null;
  {
    const dangerousFilename = '../../../../evil_script.jpg.php';
    const { req, res, getStatus, getData } = createMockReqRes({
      file: {
        buffer: validPngBuffer,
        mimetype: 'image/png',
        originalname: dangerousFilename,
      },
      user: { id: sellerA.id },
    });

    await uploadHustleImageHandler(req, res);
    assert(getStatus() === 200, 'Valid image uploaded successfully (returns 200)');

    uploadedResult = getData().data;
    assert(Boolean(uploadedResult.imageUrl), 'Returns secure imageUrl');
    assert(Boolean(uploadedResult.thumbnailUrl), 'Returns secure thumbnailUrl');
    assert(!uploadedResult.imageUrl.includes('evil_script'), 'Client filename discarded, not in URL');
    assert(uploadedResult.publicId.startsWith('hst_img_') || uploadedResult.publicId.startsWith('local_'), 'Safe unique identifier generated');
  }

  // --------------------------------------------------------------------------
  // TEST 5: Existing Hustle Ownership Verification
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 5: Hustle Image Ownership Enforcement ---');
  {
    // Seller B attempts to attach an image to Seller A's hustle
    const { req: reqB, res: resB, getStatus: getStatusB } = createMockReqRes({
      params: { id: hustleA.id },
      file: { buffer: validPngBuffer, mimetype: 'image/png', originalname: 'photo.png' },
      user: { id: sellerB.id },
    });

    await uploadHustleImagesForListingHandler(reqB, resB);
    assert(getStatusB() === 403, 'Seller B blocked from uploading image to Seller A hustle (returns 403 Forbidden)');

    // Seller A (owner) attaches image to their own hustle
    const { req: reqA, res: resA, getStatus: getStatusA, getData: getDataA } = createMockReqRes({
      params: { id: hustleA.id },
      file: { buffer: validPngBuffer, mimetype: 'image/png', originalname: 'photo.png' },
      user: { id: sellerA.id },
    });

    await uploadHustleImagesForListingHandler(reqA, resA);
    assert(getStatusA() === 201, 'Seller A attaches image to own hustle successfully (returns 201 Created)');

    const savedImage = getDataA().data;
    assert(savedImage.hustleId === hustleA.id, 'Image linked to correct hustleId');
    assert(Boolean(savedImage.publicId), 'Image has publicId stored in PostgreSQL');
  }

  // --------------------------------------------------------------------------
  // TEST 6: Cleanup on Hustle Deletion (Preventing Orphaned Files)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 6: Storage Asset Cleanup on Deletion ---');
  {
    const { req, res, getStatus } = createMockReqRes({
      params: { id: hustleA.id },
      user: { id: sellerA.id, role: 'STUDENT' },
    });

    await deleteHustle(req, res);
    assert(getStatus() === 200, 'Hustle deleted with 200');

    // Confirm image records in Prisma were cascade deleted
    const count = await prisma.hustleImage.count({ where: { hustleId: hustleA.id } });
    assert(count === 0, 'Image records in database removed with zero orphans');
  }

  console.log(`\n======================================================`);
  console.log(`🎉 Image Upload Security & Storage Tests Complete:`);
  console.log(`   Passed: ${passed}`);
  console.log(`   Failed: ${failed}`);
  console.log(`======================================================\n`);

  if (failed > 0) process.exit(1);
}

runImageUploadSecurityTests()
  .catch((e) => {
    console.error('Fatal test error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
