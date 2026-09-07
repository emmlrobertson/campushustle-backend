import { Router } from 'express';
import {
  getAllHustles,
  getHustleById,
  createHustle,
  deleteHustle,
} from '../controllers/hustleController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// Public routes (anyone can browse and view hustles)
router.get('/', getAllHustles);
router.get('/:id', getHustleById);

// Protected routes (requires valid KNUST student JWT token)
router.post('/', authenticateToken, createHustle);
router.delete('/:id', authenticateToken, deleteHustle);

export default router;
