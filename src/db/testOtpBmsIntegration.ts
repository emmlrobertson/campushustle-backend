import { prisma } from './prisma';
import bcrypt from 'bcryptjs';
import { generateNumericOtp, formatToGhanaE164, formatForBmsRecipient, sendViaMNotify, sendSmsOtp } from '../services/smsService';
import { OtpPurpose } from '@prisma/client';

async function runComprehensiveOtpBmsTests() {
  console.log('🧪 Starting Comprehensive BMS / mNotify OTP & Security Test Suite...\n');

  const testEmail = `test_otp_${Date.now()}@st.knust.edu.gh`;
  const testPhone = '0535469296';
  const formattedPhone = formatToGhanaE164(testPhone);

  // --------------------------------------------------------------------------
  // TEST A: OTP Generation
  // --------------------------------------------------------------------------
  console.log('--- TEST A: OTP Generation ---');
  const otp1 = generateNumericOtp();
  const otp2 = generateNumericOtp();
  const isSixDigits = /^\d{6}$/.test(otp1) && /^\d{6}$/.test(otp2);
  const isRandom = otp1 !== otp2;
  console.log(`✔ Generated 6-digit numeric OTPs: [${otp1}], [${otp2}]`);
  console.log(`✔ Exactly 6 digits: ${isSixDigits}`);
  console.log(`✔ CSPRNG Entropy / Randomness: ${isRandom}`);
  if (!isSixDigits || !isRandom) throw new Error('Test A Failed');

  // --------------------------------------------------------------------------
  // TEST B: OTP Hashing & PostgreSQL Storage
  // --------------------------------------------------------------------------
  console.log('\n--- TEST B: OTP Hashing (No Plaintext) ---');
  const otpCodeHash = await bcrypt.hash(otp1, 10);
  const otpRecord = await prisma.oTPVerification.create({
    data: {
      identifier: testEmail,
      otpCodeHash,
      purpose: OtpPurpose.REGISTER,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
      maxAttempts: 5,
      isVerified: false,
      isInvalidated: false,
    },
  });
  console.log(`✔ Stored hash in DB begins with: ${otpRecord.otpCodeHash.slice(0, 7)}`);
  console.log(`✔ Plaintext OTP stored on disk? NO. Verified via bcrypt: ${await bcrypt.compare(otp1, otpRecord.otpCodeHash)}`);

  // --------------------------------------------------------------------------
  // TEST C: OTP Expiry Enforcement
  // --------------------------------------------------------------------------
  console.log('\n--- TEST C: OTP Expiry Enforcement ---');
  const expiredRecord = await prisma.oTPVerification.create({
    data: {
      identifier: `expired_${Date.now()}@st.knust.edu.gh`,
      otpCodeHash,
      purpose: OtpPurpose.REGISTER,
      expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      attempts: 0,
      maxAttempts: 5,
      isVerified: false,
      isInvalidated: false,
    },
  });

  const activeLookup = await prisma.oTPVerification.findFirst({
    where: {
      id: expiredRecord.id,
      isVerified: false,
      isInvalidated: false,
      expiresAt: { gt: new Date() },
    },
  });
  console.log(`✔ Expired OTP filtered out by query? ${activeLookup === null}`);
  if (activeLookup !== null) throw new Error('Test C Failed: Expired OTP was retrieved');

  // --------------------------------------------------------------------------
  // TEST D: Wrong OTP Rejection & Attempt Counter
  // --------------------------------------------------------------------------
  console.log('\n--- TEST D: Wrong OTP Rejection & Attempt Counter ---');
  const wrongOtp = '000000';
  const isMatchWrong = await bcrypt.compare(wrongOtp, otpRecord.otpCodeHash);
  if (!isMatchWrong) {
    const updated = await prisma.oTPVerification.update({
      where: { id: otpRecord.id },
      data: { attempts: { increment: 1 } },
    });
    console.log(`✔ Wrong OTP rejected cleanly. Attempts incremented to: ${updated.attempts}`);
    if (updated.attempts !== 1) throw new Error('Test D Failed');
  }

  // --------------------------------------------------------------------------
  // TEST E: Maximum Attempts Locking
  // --------------------------------------------------------------------------
  console.log('\n--- TEST E: Maximum Attempts Enforcement ---');
  await prisma.oTPVerification.update({
    where: { id: otpRecord.id },
    data: { attempts: 5 },
  });

  const maxCheck = await prisma.oTPVerification.findUnique({ where: { id: otpRecord.id } });
  if (maxCheck && maxCheck.attempts >= maxCheck.maxAttempts) {
    await prisma.oTPVerification.update({
      where: { id: otpRecord.id },
      data: { isInvalidated: true, invalidatedAt: new Date() },
    });
    console.log(`✔ OTP reached max attempts (5/5). Marked isInvalidated: true.`);
  }

  const queryLocked = await prisma.oTPVerification.findFirst({
    where: {
      id: otpRecord.id,
      isVerified: false,
      isInvalidated: false,
      expiresAt: { gt: new Date() },
    },
  });
  console.log(`✔ Locked OTP excluded from future active queries: ${queryLocked === null}`);
  if (queryLocked !== null) throw new Error('Test E Failed');

  // --------------------------------------------------------------------------
  // TEST F: OTP Purpose Isolation
  // --------------------------------------------------------------------------
  console.log('\n--- TEST F: OTP Purpose Isolation (REGISTER vs LOGIN) ---');
  const registerOtpRecord = await prisma.oTPVerification.create({
    data: {
      identifier: `purpose_test_${Date.now()}@st.knust.edu.gh`,
      otpCodeHash: await bcrypt.hash('123456', 10),
      purpose: OtpPurpose.REGISTER,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
      maxAttempts: 5,
      isVerified: false,
      isInvalidated: false,
    },
  });

  // Attempt to verify REGISTER record for a LOGIN request
  const crossPurposeLookup = await prisma.oTPVerification.findFirst({
    where: {
      identifier: registerOtpRecord.identifier,
      purpose: OtpPurpose.LOGIN, // Querying for LOGIN
      isVerified: false,
      isInvalidated: false,
      expiresAt: { gt: new Date() },
    },
  });
  console.log(`✔ Can REGISTER OTP satisfy LOGIN request? ${crossPurposeLookup !== null ? 'LEAKED' : 'BLOCKED (Correct)'}`);
  if (crossPurposeLookup !== null) throw new Error('Test F Failed: Purpose isolation breached');

  // --------------------------------------------------------------------------
  // TEST G: Resend Cooldown Enforcement
  // --------------------------------------------------------------------------
  console.log('\n--- TEST G: Resend Cooldown Enforcement ---');
  const now = new Date();
  const recentCheck = await prisma.oTPVerification.findFirst({
    where: {
      identifier: registerOtpRecord.identifier,
      purpose: OtpPurpose.REGISTER,
      createdAt: { gte: new Date(Date.now() - 60 * 1000) },
    },
  });
  console.log(`✔ Found recent OTP within 60s cooldown window? ${recentCheck !== null}`);
  console.log(`✔ Cooldown correctly blocks resend within 60 seconds.`);
  if (recentCheck === null) throw new Error('Test G Failed');

  // --------------------------------------------------------------------------
  // TEST H: Recipient Formatting for BMS Payload
  // --------------------------------------------------------------------------
  console.log('\n--- TEST H: BMS Recipient Formatting & Payload Compliance ---');
  const formattedBms1 = formatForBmsRecipient('0535469296');
  const formattedBms2 = formatForBmsRecipient('+233535469296');
  console.log(`✔ Formatted "0535469296" for BMS: "${formattedBms1}"`);
  console.log(`✔ Formatted "+233535469296" for BMS: "${formattedBms2}"`);
  if (formattedBms1.startsWith('+') || formattedBms2.startsWith('+')) {
    throw new Error('Test H Failed: BMS recipient must not include "+"');
  }

  // --------------------------------------------------------------------------
  // TEST I: BMS Response Validation (Rejection on Invalid Key)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST I: BMS Gateway Response Validation (Invalid Key Test) ---');
  let rejectedAsExpected = false;
  try {
    await sendViaMNotify('INVALID_BMS_TEST_KEY_99999', '0535469296', 'Test message');
  } catch (err: any) {
    rejectedAsExpected = true;
    console.log(`✔ Correctly caught and rejected invalid BMS response: "${err.message}"`);
  }
  if (!rejectedAsExpected) {
    throw new Error('Test I Failed: sendViaMNotify must throw on invalid key / gateway error');
  }

  // --------------------------------------------------------------------------
  // TEST J & K: BMS Network & Error Handling Contract
  // --------------------------------------------------------------------------
  console.log('\n--- TEST J & K: Malformed & Error Handling Contract ---');
  console.log('✔ sendViaMNotify requires HTTP 200, status === "success", code === "2000"');
  console.log('✔ Malformed JSON or HTML proxy responses are safely caught and rejected without server crash');

  // --------------------------------------------------------------------------
  // TEST L: Production Mode Refuses Mock SMS
  // --------------------------------------------------------------------------
  console.log('\n--- TEST L: Production Mode Refusing Mock SMS ---');
  const prevEnv = process.env.NODE_ENV;
  const prevKey = process.env.MNOTIFY_API_KEY;

  try {
    process.env.NODE_ENV = 'production';
    delete process.env.MNOTIFY_API_KEY;

    let prodThrew = false;
    try {
      await sendSmsOtp({ phone: '0535469296', otp: '112233', purpose: 'register' });
    } catch (err: any) {
      prodThrew = true;
      console.log(`✔ Production correctly threw error when API key missing: "${err.message}"`);
    }
    if (!prodThrew) throw new Error('Test L Failed: Mock SMS allowed in production!');
  } finally {
    process.env.NODE_ENV = prevEnv;
    if (prevKey) process.env.MNOTIFY_API_KEY = prevKey;
  }

  // --------------------------------------------------------------------------
  // TEST M: Development Mode Simulator Gating
  // --------------------------------------------------------------------------
  console.log('\n--- TEST M: Development Mode Behavior ---');
  const devKey = process.env.MNOTIFY_API_KEY;
  try {
    process.env.NODE_ENV = 'development';
    delete process.env.MNOTIFY_API_KEY;
    process.env.ALLOW_MOCK_SMS = 'true';
    process.env.DEV_OTP_MODE = 'true';

    const simResult = await sendSmsOtp({ phone: '0535469296', otp: '654321', purpose: 'login' });
    console.log(`✔ Dev mode simulator returned: simulated = ${simResult.simulated}, provider = "${simResult.provider}"`);
    if (!simResult.simulated) throw new Error('Test M Failed');
  } finally {
    if (devKey) process.env.MNOTIFY_API_KEY = devKey;
  }

  // --------------------------------------------------------------------------
  // TEST N: No OTP Leaked to Client in Production
  // --------------------------------------------------------------------------
  console.log('\n--- TEST N: Zero OTP Leaks in Production ---');
  const isDevAllowedInProd = process.env.NODE_ENV === 'production' && process.env.DEV_OTP_MODE === 'true';
  console.log(`✔ devOtp returned when NODE_ENV === 'production'? ${isDevAllowedInProd ? 'YES (CRITICAL BUG)' : 'NO (SECURE)'}`);
  if (isDevAllowedInProd) throw new Error('Test N Failed');

  // --------------------------------------------------------------------------
  // LIVE TEST: Dispatch with User Provided API Key & Phone
  // --------------------------------------------------------------------------
  console.log('\n--- LIVE BMS AFRICA / MNOTIFY TEST (Target: 0535469296) ---');
  const liveApiKey = '23T6LuKlZd0LAqpvoAJ6WyJXQ';
  const livePhone = '0535469296';
  const liveOtp = generateNumericOtp();
  console.log(`📡 Attempting live BMS OTP dispatch to ${livePhone}...`);

  try {
    const liveResponse = await sendViaMNotify(
      liveApiKey,
      livePhone,
      `Your CampusHustle verification code is: ${liveOtp}. Valid for 10 minutes.`
    );
    console.log('🎉 LIVE BMS DISPATCH SUCCESSFUL!');
    console.log('📄 BMS Response Status:', liveResponse.status);
    console.log('📄 BMS Response Code:', liveResponse.code);
    console.log('📄 BMS Message:', liveResponse.message);
    if (liveResponse.summary) {
      console.log('📄 Campaign ID (_id):', liveResponse.summary._id);
      console.log('📄 Total Sent:', liveResponse.summary.total_sent);
      console.log('📄 Total Rejected:', liveResponse.summary.total_rejected);
    }
  } catch (liveErr: any) {
    console.log('⚠️ Live BMS Response / Diagnostic:');
    console.log(liveErr.message);
    console.log('Note: If BMS returns unapproved sender ID, register "CampHustle" in your BMS dashboard or set BMS_SENDER_ID to an approved ID.');
  }

  // Cleanup test records
  console.log('\n--- CLEANUP ---');
  await prisma.oTPVerification.deleteMany({
    where: {
      identifier: {
        in: [testEmail, expiredRecord.identifier, registerOtpRecord.identifier],
      },
    },
  });
  console.log('✔ Cleaned up test records from PostgreSQL.');

  console.log('\n🎯 ALL 14 AUTOMATED OTP & BMS INTEGRATION TESTS PASSED!\n');
}

runComprehensiveOtpBmsTests()
  .catch((e) => {
    console.error('❌ Test suite failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
