import { Router } from 'express';
import {
  getAllHustles,
  getHustleById,
  getMyHustles,
  createHustle,
  deleteHustle,
  toggleHustleStatus,
  getHustleReviews,
  createHustleReview,
} from '../controllers/hustleController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// Protected routes (requires valid KNUST student JWT token)
router.get('/my/listings', authenticateToken, getMyHustles);
router.post('/', authenticateToken, createHustle);
router.delete('/:id', authenticateToken, deleteHustle);
router.patch('/:id/status', authenticateToken, toggleHustleStatus);
router.post('/:id/reviews', authenticateToken, createHustleReview);

// Public routes
router.get('/', getAllHustles);
router.get('/:id', getHustleById);
router.get('/:id/reviews', getHustleReviews);

export default router;


