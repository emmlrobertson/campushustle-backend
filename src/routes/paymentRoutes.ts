import { Router } from 'express';
import {
  initializePayment,
  verifyPayment,
  getTransactionHistory,
} from '../controllers/paymentController';

const router = Router();

router.post('/initialize', initializePayment);
router.get('/verify/:reference', verifyPayment);
router.get('/history', getTransactionHistory);

export default router;
