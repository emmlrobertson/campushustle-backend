import { Router } from 'express';
import {
  registerStudent,
  loginStudent,
  getCurrentUser,
  sendSmsOtpHandler,
  verifySmsOtpHandler,
} from '../controllers/authController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.post('/register', registerStudent);
router.post('/login', loginStudent);
router.post('/send-otp', sendSmsOtpHandler);
router.post('/verify-otp', verifySmsOtpHandler);
router.get('/me', authenticateToken, getCurrentUser);

export default router;
