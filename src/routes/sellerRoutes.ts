import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import {
  getPayoutAccount,
  updatePayoutAccount,
} from '../controllers/sellerController';

const router = Router();

// All seller payout routes require authentication
router.use(authenticateToken);

// GET /api/seller/payout-account - View payout destination
router.get('/payout-account', getPayoutAccount);

// PUT /api/seller/payout-account - Configure or update Mobile Money payout destination
router.put('/payout-account', updatePayoutAccount);

export default router;
