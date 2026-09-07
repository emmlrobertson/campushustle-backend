import { Router } from 'express';
import {
  registerStudent,
  loginStudent,
  getCurrentUser,
} from '../controllers/authController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.post('/register', registerStudent);
router.post('/login', loginStudent);
router.get('/me', authenticateToken, getCurrentUser);

export default router;
