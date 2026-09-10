import { Router } from 'express';
import {
  initializePayment,
  verifyPayment,
  getTransactionHistory,
  releaseEscrow,
} from '../controllers/paymentController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.post('/initialize', initializePayment);
router.get('/verify/:reference', verifyPayment);
router.get('/history', authenticateToken, getTransactionHistory);
router.post('/release/:reference', authenticateToken, releaseEscrow);

export default router;
