import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDatabase } from '../db/database';
import { AuthenticatedRequest } from '../middleware/authMiddleware';

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
