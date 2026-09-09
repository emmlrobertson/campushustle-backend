import { Router } from 'express';
import {
  getAllHustles,
  getHustleById,
  createHustle,
  deleteHustle,
  clearAllHustles,
} from '../controllers/hustleController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// Public routes
router.get('/', getAllHustles);
router.get('/:id', getHustleById);
router.post('/clear-all', clearAllHustles);

// Protected routes (requires valid KNUST student JWT token)
router.post('/', authenticateToken, createHustle);
router.delete('/:id', authenticateToken, deleteHustle);

export default router;
