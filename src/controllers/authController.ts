import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDatabase } from '../db/database';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import {
  sendSmsOtp,
  generateNumericOtp,
  formatToGhanaE164,
} from '../services/smsService';

const JWT_SECRET = process.env.JWT_SECRET || 'campushustle_knust_secret_key_2026';

// Valid student email domains for Ghanaian Universities
const ALLOWED_STUDENT_DOMAINS = ['st.knust.edu.gh', 'st.ug.edu.gh', 'stu.ucc.edu.gh'];

export const registerStudent = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
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

    const cleanEmail = email.trim().toLowerCase();

    // Verify Student Email Domain (e.g., must end with @st.knust.edu.gh)
    const emailDomain = cleanEmail.split('@')[1];
    const isDomainAllowed = ALLOWED_STUDENT_DOMAINS.some(
      (domain) => emailDomain === domain || cleanEmail.endsWith(`@${domain}`)
    );

    if (!isDomainAllowed) {
      return res.status(400).json({
        success: false,
        error: `Registration restricted strictly to valid student emails (e.g. yourname@st.knust.edu.gh).`,
      });
    }

    // Check if user already exists
    const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'A student account with this email already exists. Please log in.',
      });
    }

    // Hash Password securely
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const userId = `usr_${Date.now()}`;
    const createdAt = new Date().toISOString();

    await db.run(
      `INSERT INTO users (id, name, email, password_hash, program, hostel_location, whats_app_number, campus_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, name, cleanEmail, passwordHash, program, hostelLocation, whatsAppNumber, campus, createdAt]
    );

    // Generate JWT Token
    const token = jwt.sign(
      { id: userId, email: cleanEmail, campus },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      message: '🎓 KNUST Student Account Registered Successfully!',
      token,
      user: {
        id: userId,
        name,
        email: cleanEmail,
        program,
        hostelLocation,
        whatsAppNumber,
        campus,
        createdAt,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const loginStudent = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please provide email and password.',
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Fetch user from DB
    const user = await db.get('SELECT * FROM users WHERE email = ?', [cleanEmail]);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid student email or password.',
      });
    }

    // Verify Password Hash
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid student email or password.',
      });
    }

    // Generate JWT Token
    const token = jwt.sign(
      { id: user.id, email: user.email, campus: user.campus_id },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: '🔑 Login Successful!',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        program: user.program,
        hostelLocation: user.hostel_location,
        whatsAppNumber: user.whats_app_number,
        campus: user.campus_id,
        createdAt: user.created_at,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getCurrentUser = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDatabase();
    const userId = req.user?.id;

    const user = await db.get(
      'SELECT id, name, email, program, hostel_location, whats_app_number, campus_id, created_at FROM users WHERE id = ?',
      [userId]
    );

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
        hostelLocation: user.hostel_location,
        whatsAppNumber: user.whats_app_number,
        campus: user.campus_id,
        createdAt: user.created_at,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Send 6-Digit Verification Code via SMS for Registration or Login
 */
export const sendSmsOtpHandler = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const { email, whatsAppNumber, purpose = 'register', campus = 'knust' } = req.body;

    const cleanEmail = email ? email.trim().toLowerCase() : '';
    const cleanPhone = whatsAppNumber ? whatsAppNumber.trim() : '';

    if (purpose === 'register') {
      if (!cleanEmail || !cleanPhone) {
        return res.status(400).json({
          success: false,
          error: 'Please provide both your student email and Ghana phone number.',
        });
      }

      // Check student domain
      const emailDomain = cleanEmail.split('@')[1];
      const isDomainAllowed = ALLOWED_STUDENT_DOMAINS.some(
        (domain) => emailDomain === domain || cleanEmail.endsWith(`@${domain}`)
      );
      if (!isDomainAllowed) {
        return res.status(400).json({
          success: false,
          error:
            'Registration is restricted strictly to valid student emails (@st.knust.edu.gh, @st.ug.edu.gh, @stu.ucc.edu.gh).',
        });
      }

      // Check if user already exists
      const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [cleanEmail]);
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: 'An account with this student email already exists. Please log in.',
        });
      }
    } else if (purpose === 'login') {
      // Login with OTP
      if (!cleanEmail && !cleanPhone) {
        return res.status(400).json({
          success: false,
          error: 'Please enter your student email or phone number to receive a login code.',
        });
      }

      const user = await db.get(
        'SELECT * FROM users WHERE email = ? OR whats_app_number = ?',
        [cleanEmail, cleanPhone]
      );
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'No student account found with this email/phone. Please sign up first.',
        });
      }
    }

    // Determine target phone number
    let targetPhone = cleanPhone;
    if (purpose === 'login') {
      const user = await db.get(
        'SELECT whats_app_number, email FROM users WHERE email = ? OR whats_app_number = ?',
        [cleanEmail, cleanPhone]
      );
      if (user) {
        targetPhone = user.whats_app_number;
      }
    }

    const formattedE164 = formatToGhanaE164(targetPhone);

    // Safeguard 1: Invalidate all previous unverified OTPs for this student
    await db.run(
      `UPDATE otp_verifications SET is_verified = -1 
       WHERE (email = ? OR phone_number = ?) AND is_verified = 0`,
      [cleanEmail, formattedE164]
    );

    // Safeguard 2: Fetch student's last code to guarantee no consecutive repetition
    const previousRecord = await db.get(
      `SELECT otp_code FROM otp_verifications 
       WHERE (email = ? OR phone_number = ?) 
       ORDER BY created_at DESC LIMIT 1`,
      [cleanEmail, formattedE164]
    );
    const previousOtp = previousRecord ? previousRecord.otp_code : null;

    // Safeguard 3: Hardware Cryptographic Generation & Global Active Collision Resistance
    // Ensures the code does NOT repeat for this student AND is not currently active for ANY other student
    let otp = generateNumericOtp();
    let collisionCheckAttempts = 0;
    const nowIso = new Date().toISOString();

    while (collisionCheckAttempts < 10) {
      if (otp !== previousOtp) {
        // Check if any other student has this code active right now
        const existingActive = await db.get(
          `SELECT id FROM otp_verifications 
           WHERE otp_code = ? AND is_verified = 0 AND expires_at > ?`,
          [otp, nowIso]
        );
        if (!existingActive) {
          break; // Unique and collision-free!
        }
      }
      otp = generateNumericOtp();
      collisionCheckAttempts++;
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes
    const id = `otp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Store in otp_verifications table
    await db.run(
      `INSERT INTO otp_verifications (id, phone_number, email, otp_code, purpose, expires_at, is_verified, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      [id, formattedE164, cleanEmail, otp, purpose, expiresAt, new Date().toISOString()]
    );

    // Send SMS via Ghana Telecom SMS gateway
    const smsResult = await sendSmsOtp({
      phone: formattedE164,
      otp,
      purpose,
      campusName: campus.toUpperCase(),
    });

    res.json({
      success: true,
      message: `A 6-digit security code was sent via SMS to ${formattedE164}`,
      phone: formattedE164,
      expiresInMinutes: 10,
      devOtp: otp, // Returned for instant demo/test execution
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * Verify 6-Digit SMS Code and Authenticate (Register or Login)
 */
export const verifySmsOtpHandler = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const {
      email,
      phone,
      otp,
      purpose = 'register',
      name,
      password,
      program,
      hostelLocation,
      campus = 'knust',
    } = req.body;

    if (!otp) {
      return res.status(400).json({ success: false, error: 'Please enter the 6-digit code.' });
    }

    const cleanOtp = otp.toString().trim();
    const cleanEmail = email ? email.trim().toLowerCase() : '';
    const cleanPhone = phone ? formatToGhanaE164(phone) : '';

    // Safeguard 4: Identity-Bound Active Verification Check
    const now = new Date().toISOString();
    const record = await db.get(
      `SELECT * FROM otp_verifications 
       WHERE (email = ? OR phone_number = ?) 
         AND purpose = ? 
         AND is_verified = 0 
         AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
      [cleanEmail, cleanPhone, purpose, now]
    );

    if (!record) {
      return res.status(400).json({
        success: false,
        error: 'No active verification code found for this phone/email. Please request a new code.',
      });
    }

    // Safeguard 5: Brute-Force Rate Limiting (Max 5 attempts)
    if (record.attempts >= 5) {
      await db.run('UPDATE otp_verifications SET is_verified = -2 WHERE id = ?', [record.id]);
      return res.status(429).json({
        success: false,
        error: 'Maximum verification attempts exceeded. For security, please request a new SMS code.',
      });
    }

    if (record.otp_code !== cleanOtp) {
      await db.run('UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = ?', [record.id]);
      const remaining = 5 - (record.attempts + 1);
      return res.status(400).json({
        success: false,
        error: `Incorrect verification code. ${remaining > 0 ? `${remaining} attempts remaining.` : 'Code locked out. Please request a new one.'}`,
      });
    }

    // Mark OTP as verified
    await db.run('UPDATE otp_verifications SET is_verified = 1 WHERE id = ?', [record.id]);

    if (purpose === 'register') {
      let user = await db.get('SELECT * FROM users WHERE email = ?', [cleanEmail]);
      if (user) {
        return res.status(400).json({
          success: false,
          error: 'An account with this student email already exists. Please log in.',
        });
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password || 'campus2026', salt);
      const userId = `usr_${Date.now()}`;
      const createdAt = new Date().toISOString();

      await db.run(
        `INSERT INTO users (id, name, email, password_hash, program, hostel_location, whats_app_number, campus_id, created_at, phone_verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          userId,
          name || 'Student Hustler',
          cleanEmail,
          passwordHash,
          program || 'Level 200',
          hostelLocation || 'Campus Hostel',
          record.phone_number,
          campus,
          createdAt,
        ]
      );

      const token = jwt.sign({ id: userId, email: cleanEmail, campus }, JWT_SECRET, {
        expiresIn: '7d',
      });

      return res.status(201).json({
        success: true,
        message: '🎉 Phone verified! Student account registered successfully.',
        token,
        user: {
          id: userId,
          name: name || 'Student Hustler',
          email: cleanEmail,
          program: program || 'Level 200',
          hostelLocation: hostelLocation || 'Campus Hostel',
          whatsAppNumber: record.phone_number,
          campus,
          createdAt,
          phoneVerified: true,
        },
      });
    } else {
      // Login flow with OTP
      const user = await db.get(
        'SELECT * FROM users WHERE email = ? OR whats_app_number = ?',
        [cleanEmail, cleanPhone]
      );

      if (!user) {
        return res.status(404).json({ success: false, error: 'Student account not found.' });
      }

      await db.run('UPDATE users SET phone_verified = 1 WHERE id = ?', [user.id]);

      const token = jwt.sign(
        { id: user.id, email: user.email, campus: user.campus_id },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      return res.json({
        success: true,
        message: '🔑 Phone verified! Login successful.',
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          program: user.program,
          hostelLocation: user.hostel_location,
          whatsAppNumber: user.whats_app_number,
          campus: user.campus_id,
          createdAt: user.created_at,
          phoneVerified: true,
        },
      });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

