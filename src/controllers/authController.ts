import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/prisma';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { getJwtSecret, JWT_EXPIRES_IN } from '../config/jwt';
import {
  sendSmsOtp,
  generateNumericOtp,
  formatToGhanaE164,
} from '../services/smsService';
import { OtpPurpose } from '@prisma/client';

const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10);
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Masks phone numbers for safe client responses
 * Example: "+233241234567" -> "+233 ••• ••• 567"
 */
function maskPhoneNumber(phone: string): string {
  if (phone.length < 7) return phone;
  const lastThree = phone.slice(-3);
  const prefix = phone.startsWith('+233') ? '+233' : phone.slice(0, 3);
  return `${prefix} ••• ••• ${lastThree}`;
}

function parseOtpPurpose(purposeStr?: string): OtpPurpose {
  const normalized = purposeStr?.toLowerCase().trim();
  if (normalized === 'login') return OtpPurpose.LOGIN;
  if (normalized === 'phone_verification') return OtpPurpose.PHONE_VERIFICATION;
  if (normalized === 'password_reset') return OtpPurpose.PASSWORD_RESET;
  return OtpPurpose.REGISTER;
}

/**
 * Register student, validate domain, create pending user, generate & dispatch hashed OTP
 */
export const registerStudent = async (req: Request, res: Response) => {
  try {
    const {
      name,
      email,
      password,
      program,
      hostelLocation,
      whatsAppNumber,
      campus = 'knust',
    } = req.body;

    if (!name || !email || !password || !program || !hostelLocation || !whatsAppNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, email, password, program, hostelLocation, whatsAppNumber',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters long for account security.',
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const campusCode = (campus as string).toUpperCase();

    // Validate university domain
    const university = await prisma.university.findFirst({
      where: {
        OR: [
          { code: campusCode },
          { id: campus.toLowerCase() },
          { shortName: { equals: campus, mode: 'insensitive' } },
        ],
      },
    });

    if (!university) {
      return res.status(400).json({
        success: false,
        error: `University '${campus}' is not currently registered on Campus Hustle.`,
      });
    }

    const emailDomain = cleanEmail.split('@')[1];
    const isDomainAllowed = university.allowedDomains.some(
      (domain) => emailDomain === domain || cleanEmail.endsWith(`@${domain}`)
    );

    if (!isDomainAllowed) {
      return res.status(400).json({
        success: false,
        error: `Registration for ${university.shortName} is restricted strictly to valid student emails (e.g. yourname@${university.allowedDomains[0]}).`,
      });
    }

    const formattedPhone = formatToGhanaE164(whatsAppNumber);
    if (!formattedPhone || formattedPhone.length < 12) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid Ghana phone number (e.g. 0241234567).',
      });
    }

    // Check duplicate accounts
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email: cleanEmail }, { phoneNumber: formattedPhone }],
      },
    });

    if (existingUser) {
      if (existingUser.phoneVerified) {
        return res.status(409).json({
          success: false,
          error: 'An account with this student email or phone number already exists. Please log in.',
        });
      }
      // Update pending registration
      const passwordHash = await bcrypt.hash(password, 12);
      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          name: name.trim(),
          passwordHash,
          program: program.trim(),
          hostelLocation: hostelLocation.trim(),
          phoneNumber: formattedPhone,
          universityId: university.id,
        },
      });
    } else {
      const passwordHash = await bcrypt.hash(password, 12);
      await prisma.user.create({
        data: {
          name: name.trim(),
          email: cleanEmail,
          passwordHash,
          program: program.trim(),
          hostelLocation: hostelLocation.trim(),
          phoneNumber: formattedPhone,
          phoneVerified: false,
          tokenVersion: 1,
          universityId: university.id,
        },
      });
    }

    // Cooldown check for registration OTP
    const recentOtp = await prisma.oTPVerification.findFirst({
      where: {
        identifier: cleanEmail,
        purpose: OtpPurpose.REGISTER,
        createdAt: { gte: new Date(Date.now() - RESEND_COOLDOWN_SECONDS * 1000) },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentOtp) {
      return res.status(429).json({
        success: false,
        error: `Please wait ${RESEND_COOLDOWN_SECONDS} seconds before requesting another verification code.`,
      });
    }

    // Invalidate previous unverified registration OTPs
    await prisma.oTPVerification.updateMany({
      where: {
        identifier: cleanEmail,
        purpose: OtpPurpose.REGISTER,
        isVerified: false,
        isInvalidated: false,
      },
      data: {
        isInvalidated: true,
        invalidatedAt: new Date(),
      },
    });

    // Generate and hash OTP
    const otp = generateNumericOtp();
    const otpCodeHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await prisma.oTPVerification.create({
      data: {
        identifier: cleanEmail,
        otpCodeHash,
        purpose: OtpPurpose.REGISTER,
        expiresAt,
        attempts: 0,
        maxAttempts: 5,
        isVerified: false,
        isInvalidated: false,
      },
    });

    await sendSmsOtp({
      phone: formattedPhone,
      otp,
      purpose: 'register',
      campusName: university.shortName,
    });

    const isDevOtpAllowed = process.env.NODE_ENV !== 'production' && process.env.DEV_OTP_MODE === 'true';

    res.status(201).json({
      success: true,
      message: 'Verification code sent to your mobile phone.',
      data: {
        email: cleanEmail,
        phoneMasked: maskPhoneNumber(formattedPhone),
        expiresInMinutes: OTP_EXPIRY_MINUTES,
        ...(isDevOtpAllowed && { devOtp: otp }),
      },
    });
  } catch (error: any) {
    console.error('Registration Error:', error);
    res.status(500).json({
      success: false,
      error: error.message?.includes('telecom')
        ? error.message
        : 'Registration failed. Please check your information and try again.',
    });
  }
};

/**
 * Verify 6-Digit OTP, mark verified, and issue authenticated JWT session
 * Enforces strict purpose isolation (REGISTER cannot verify LOGIN and vice versa)
 */
export const verifySmsOtpHandler = async (req: Request, res: Response) => {
  try {
    const { email, phone, otp, purpose = 'register' } = req.body;

    if (!otp) {
      return res.status(400).json({ success: false, error: 'Please provide the 6-digit verification code.' });
    }

    const cleanOtp = otp.toString().trim();
    if (cleanOtp.length !== 6 || !/^\d{6}$/.test(cleanOtp)) {
      return res.status(400).json({ success: false, error: 'Verification code must be exactly 6 digits.' });
    }

    const cleanEmail = email ? email.trim().toLowerCase() : '';
    const cleanPhone = phone ? formatToGhanaE164(phone) : '';

    if (!cleanEmail && !cleanPhone) {
      return res.status(400).json({
        success: false,
        error: 'Please provide the registered email or phone number.',
      });
    }

    const targetPurpose = parseOtpPurpose(purpose);
    const now = new Date();

    const otpRecord = await prisma.oTPVerification.findFirst({
      where: {
        OR: [{ identifier: cleanEmail }, { identifier: cleanPhone }],
        purpose: targetPurpose, // Strict purpose isolation!
        isVerified: false,
        isInvalidated: false, // Must not be superseded!
        expiresAt: { gt: now }, // Must not be expired!
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        error: `No active ${targetPurpose.toLowerCase()} verification code found or the code has expired. Please request a new code.`,
      });
    }

    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      await prisma.oTPVerification.update({
        where: { id: otpRecord.id },
        data: {
          isInvalidated: true,
          invalidatedAt: new Date(),
        },
      });
      return res.status(429).json({
        success: false,
        error: 'Maximum verification attempts exceeded. For security, please request a new verification code.',
      });
    }

    const isMatch = await bcrypt.compare(cleanOtp, otpRecord.otpCodeHash);

    if (!isMatch) {
      const updated = await prisma.oTPVerification.update({
        where: { id: otpRecord.id },
        data: { attempts: { increment: 1 } },
      });
      const remaining = otpRecord.maxAttempts - updated.attempts;
      return res.status(400).json({
        success: false,
        error: remaining > 0
          ? `Incorrect verification code. ${remaining} attempt(s) remaining.`
          : 'Incorrect code. Maximum attempts reached. Please request a new code.',
      });
    }

    // Mark OTP as verified and record consumption timestamp
    await prisma.oTPVerification.update({
      where: { id: otpRecord.id },
      data: {
        isVerified: true,
        consumedAt: new Date(),
      },
    });

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: cleanEmail }, { phoneNumber: cleanPhone }],
      },
      include: {
        university: true,
        sellerProfile: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'No matching user profile found. Please register.',
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { phoneVerified: true },
      include: { university: true, sellerProfile: true },
    });

    // Issue JWT with tokenVersion
    const secret = getJwtSecret();
    const token = jwt.sign(
      {
        id: updatedUser.id,
        email: updatedUser.email,
        universityId: updatedUser.universityId,
        role: updatedUser.role,
        tokenVersion: updatedUser.tokenVersion,
      },
      secret,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      success: true,
      message: '🎉 Phone number verified successfully! Welcome to Campus Hustle.',
      token,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        program: updatedUser.program,
        hostelLocation: updatedUser.hostelLocation,
        phoneNumber: updatedUser.phoneNumber,
        campus: updatedUser.university.code,
        campusName: updatedUser.university.shortName,
        phoneVerified: true,
        isSeller: Boolean(updatedUser.sellerProfile),
        sellerProfile: updatedUser.sellerProfile,
        createdAt: updatedUser.createdAt,
      },
    });
  } catch (error: any) {
    console.error('Verify OTP Error:', error);
    res.status(500).json({ success: false, error: 'Verification failed. Please try again.' });
  }
};

/**
 * Resend OTP with cooldown and strict purpose tracking
 */
export const resendOtpHandler = async (req: Request, res: Response) => {
  try {
    const { email, phone, purpose = 'register' } = req.body;

    const cleanEmail = email ? email.trim().toLowerCase() : '';
    const cleanPhone = phone ? formatToGhanaE164(phone) : '';

    if (!cleanEmail && !cleanPhone) {
      return res.status(400).json({
        success: false,
        error: 'Please provide email or phone number to resend verification code.',
      });
    }

    const targetPurpose = parseOtpPurpose(purpose);

    const recentOtp = await prisma.oTPVerification.findFirst({
      where: {
        OR: [{ identifier: cleanEmail }, { identifier: cleanPhone }],
        purpose: targetPurpose,
        createdAt: { gte: new Date(Date.now() - RESEND_COOLDOWN_SECONDS * 1000) },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentOtp) {
      return res.status(429).json({
        success: false,
        error: `Please wait ${RESEND_COOLDOWN_SECONDS} seconds before requesting another code.`,
      });
    }

    // Invalidate previous unverified OTPs of the same purpose
    await prisma.oTPVerification.updateMany({
      where: {
        OR: [{ identifier: cleanEmail }, { identifier: cleanPhone }],
        purpose: targetPurpose,
        isVerified: false,
        isInvalidated: false,
      },
      data: {
        isInvalidated: true,
        invalidatedAt: new Date(),
      },
    });

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: cleanEmail }, { phoneNumber: cleanPhone }],
      },
      include: { university: true },
    });

    const targetPhone = user?.phoneNumber || cleanPhone;
    if (!targetPhone) {
      return res.status(400).json({
        success: false,
        error: 'Could not determine mobile number for dispatch.',
      });
    }

    const otp = generateNumericOtp();
    const otpCodeHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await prisma.oTPVerification.create({
      data: {
        identifier: cleanEmail || cleanPhone,
        otpCodeHash,
        purpose: targetPurpose,
        expiresAt,
        attempts: 0,
        maxAttempts: 5,
        isVerified: false,
        isInvalidated: false,
      },
    });

    await sendSmsOtp({
      phone: targetPhone,
      otp,
      purpose: targetPurpose === OtpPurpose.LOGIN ? 'login' : 'register',
      campusName: user?.university.shortName || 'CampusHustle',
    });

    const isDevOtpAllowed = process.env.NODE_ENV !== 'production' && process.env.DEV_OTP_MODE === 'true';

    res.json({
      success: true,
      message: 'New verification code dispatched to your phone.',
      data: {
        phoneMasked: maskPhoneNumber(targetPhone),
        expiresInMinutes: OTP_EXPIRY_MINUTES,
        ...(isDevOtpAllowed && { devOtp: otp }),
      },
    });
  } catch (err: any) {
    console.error('Resend OTP Error:', err);
    res.status(500).json({
      success: false,
      error: err.message?.includes('telecom')
        ? err.message
        : 'Failed to dispatch verification code. Please try again.',
    });
  }
};

/**
 * Login with email and password
 */
export const loginStudent = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please enter both your student email and password.',
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: cleanEmail },
      include: { university: true, sellerProfile: true },
    });

    // Constant-time mitigation against user enumeration
    if (!user) {
      await bcrypt.hash(password, 12);
      return res.status(401).json({
        success: false,
        error: 'Invalid student email or password.',
      });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid student email or password.',
      });
    }

    if (!user.phoneVerified) {
      return res.status(403).json({
        success: false,
        error: 'Your student account requires mobile phone verification before you can log in.',
        requiresVerification: true,
        email: user.email,
        phoneNumber: user.phoneNumber,
      });
    }

    const secret = getJwtSecret();
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        universityId: user.universityId,
        role: user.role,
        tokenVersion: user.tokenVersion,
      },
      secret,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      success: true,
      message: '🔑 Logged in successfully!',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        program: user.program,
        hostelLocation: user.hostelLocation,
        phoneNumber: user.phoneNumber,
        campus: user.university.code,
        campusName: user.university.shortName,
        phoneVerified: user.phoneVerified,
        isSeller: Boolean(user.sellerProfile),
        sellerProfile: user.sellerProfile,
        createdAt: user.createdAt,
      },
    });
  } catch (error: any) {
    console.error('Login Error:', error);
    res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
  }
};

/**
 * Server-Side Logout: Invalidate current token by incrementing tokenVersion
 */
export const logoutStudent = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (userId) {
      await prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      });
    }

    res.json({
      success: true,
      message: 'Logged out successfully. Session invalidated.',
    });
  } catch (err: any) {
    console.error('Logout Error:', err);
    res.status(500).json({ success: false, error: 'Failed to complete logout.' });
  }
};

/**
 * Get authenticated student user profile
 */
export const getCurrentUser = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        university: true,
        sellerProfile: true,
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User profile not found.' });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        program: user.program,
        hostelLocation: user.hostelLocation,
        phoneNumber: user.phoneNumber,
        campus: user.university.code,
        campusName: user.university.shortName,
        phoneVerified: user.phoneVerified,
        isSeller: Boolean(user.sellerProfile),
        sellerProfile: user.sellerProfile,
        createdAt: user.createdAt,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
