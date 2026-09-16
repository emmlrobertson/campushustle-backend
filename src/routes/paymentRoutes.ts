import { Router } from 'express';
import {
  initializePayment,
  verifyPayment,
  getTransactionHistory,
  releaseEscrow,
  handlePaystackWebhook,
} from '../controllers/paymentController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// Paystack Webhook (signature verified via HMAC SHA512, no JWT)
router.post('/webhook', handlePaystackWebhook);

router.post('/initialize', authenticateToken, initializePayment);
router.get('/verify/:reference', verifyPayment);
router.get('/history', authenticateToken, getTransactionHistory);
router.post('/release/:reference', authenticateToken, releaseEscrow);

export default router;
