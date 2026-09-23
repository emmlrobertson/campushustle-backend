import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import hustleRoutes from './routes/hustleRoutes';
import authRoutes from './routes/authRoutes';
import paymentRoutes from './routes/paymentRoutes';
import orderRoutes from './routes/orderRoutes';
import cartRoutes from './routes/cartRoutes';
import adminRoutes from './routes/adminRoutes';
import sellerRoutes from './routes/sellerRoutes';
import { prisma } from './db/prisma';

const app = express();
const PORT = process.env.PORT || 5000;

// Trust reverse proxy (Render, Heroku, Cloudflare) for accurate client IP
app.set('trust proxy', 1);

import path from 'path';

// Middleware
app.use(cors());
// Parse JSON and preserve raw body for Paystack HMAC SHA512 signature verification
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Serve local upload assets (development & offline fallback)
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

// Routes
app.use('/api/hustles', hustleRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/seller', sellerRoutes);

// Health Check
app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'online',
      database: 'PostgreSQL (Prisma Connected)',
      message: '🚀 CampusHustle Backend API Server Running!',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({
      status: 'degraded',
      database: 'Database connection failed',
      error: err.message,
    });
  }
});

// Root Welcome Endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'CampusHustle API Server',
    version: '1.0.0',
    database: 'PostgreSQL + Prisma',
    endpoints: {
      health: '/api/health',
      hustles: '/api/hustles',
      register: '/api/auth/register',
      login: '/api/auth/login',
      initializePayment: '/api/payments/initialize',
      verifyPayment: '/api/payments/verify/:reference',
    },
  });
});

function assertProductionSecurityConfig() {
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '') {
    console.error('❌ FATAL: DATABASE_URL environment variable is required.');
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production') {
    if (
      !process.env.JWT_SECRET ||
      process.env.JWT_SECRET.length < 32 ||
      process.env.JWT_SECRET.includes('dev_secret') ||
      process.env.JWT_SECRET.includes('secret_key_2026')
    ) {
      console.error('❌ FATAL: A secure, high-entropy JWT_SECRET (minimum 32 characters) is required in production.');
      process.exit(1);
    }

    if (!process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET_KEY.trim() === '') {
      console.error('❌ FATAL: PAYSTACK_SECRET_KEY environment variable is required in production.');
      process.exit(1);
    }

    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      console.error(
        '❌ FATAL: Cloudinary CDN credentials (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET) are required in production.'
      );
      process.exit(1);
    }

    if (!process.env.MNOTIFY_API_KEY || process.env.MNOTIFY_API_KEY.trim() === '') {
      console.error('❌ FATAL: MNOTIFY_API_KEY environment variable is required in production for SMS OTP delivery.');
      process.exit(1);
    }
  }
}

// Start Server & Initialize Database
async function startServer() {
  try {
    assertProductionSecurityConfig();

    // 1. Connect to PostgreSQL via Prisma
    await prisma.$connect();
    console.log('🐘 PostgreSQL Database Connected via Prisma!');

    const server = app.listen(PORT, () => {
      console.log(`\n==================================================`);
      console.log(`🚀 CampusHustle Backend API Server Live!`);
      console.log(`📡 URL: http://localhost:${PORT}`);
      console.log(`🐘 Database: PostgreSQL (campushustle) via Prisma`);
      console.log(`🏥 Health Check: http://localhost:${PORT}/api/health`);
      console.log(`🔐 Auth Endpoints: http://localhost:${PORT}/api/auth`);
      console.log(`💳 Payments Endpoint: http://localhost:${PORT}/api/payments`);
      console.log(`🛍️ Hustles Endpoint: http://localhost:${PORT}/api/hustles`);
      console.log(`==================================================\n`);
    });

    const shutdown = async () => {
      console.log('\n🛑 Gracefully shutting down...');
      await prisma.$disconnect();
      server.close(() => {
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    console.error('❌ Failed to start backend server:', error);
    process.exit(1);
  }
}

startServer();
