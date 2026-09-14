import { Router } from 'express';
import {
  checkoutOrder,
  getMyOrders,
  getOrderById,
  getSellerIncomingOrders,
  updateSubOrderStatus,
  confirmSubOrderReceipt,
  cancelSubOrder,
  disputeSubOrder,
} from '../controllers/orderController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// All order endpoints require student authentication
router.use(authenticateToken);

// Buyer Routes
router.post('/checkout', checkoutOrder);
router.get('/my-orders', getMyOrders);
router.post('/sub-orders/:id/confirm-receipt', confirmSubOrderReceipt);

// Seller Routes
router.get('/seller/incoming', getSellerIncomingOrders);
router.patch('/sub-orders/:id/status', updateSubOrderStatus);

// Shared Buyer / Seller Actions
router.get('/:id', getOrderById);
router.post('/sub-orders/:id/cancel', cancelSubOrder);
router.post('/sub-orders/:id/dispute', disputeSubOrder);

export default router;
