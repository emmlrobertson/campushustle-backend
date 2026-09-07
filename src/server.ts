import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import hustleRoutes from './routes/hustleRoutes';
import authRoutes from './routes/authRoutes';
import paymentRoutes from './routes/paymentRoutes';
import { initializeDatabase } from './db/initDb';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/hustles', hustleRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/payments', paymentRoutes);

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    message: '🚀 CampusHustle KNUST Backend API Server Running!',
    timestamp: new Date().toISOString(),
  });
});

// Root Welcome Endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'CampusHustle KNUST API Server',
    version: '1.0.0',
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

// Start Server & Initialize Database
async function startServer() {
  try {
    await initializeDatabase();

    app.listen(PORT, () => {
      console.log(`\n==================================================`);
      console.log(`🚀 CampusHustle Backend API Server Live!`);
      console.log(`📡 URL: http://localhost:${PORT}`);
      console.log(`🏥 Health Check: http://localhost:${PORT}/api/health`);
      console.log(`🔐 Auth Endpoints: http://localhost:${PORT}/api/auth`);
      console.log(`💳 Payments Endpoint: http://localhost:${PORT}/api/payments`);
      console.log(`🛍️ Hustles Endpoint: http://localhost:${PORT}/api/hustles`);
      console.log(`==================================================\n`);
    });
  } catch (error) {
    console.error('❌ Failed to start backend server:', error);
    process.exit(1);
  }
}

startServer();
