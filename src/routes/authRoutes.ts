import { Router } from 'express';
import {
  registerStudent,
  loginStudent,
  logoutStudent,
  getCurrentUser,
  verifySmsOtpHandler,
  resendOtpHandler,
} from '../controllers/authController';
import { authenticateToken } from '../middleware/authMiddleware';
import {
  loginRateLimiter,
  registerRateLimiter,
  otpRateLimiter,
} from '../middleware/rateLimiter';

const router = Router();

// Registration & OTP verification with rate limiting
router.post('/register', registerRateLimiter, registerStudent);
router.post('/verify-otp', otpRateLimiter, verifySmsOtpHandler);
router.post('/resend-otp', otpRateLimiter, resendOtpHandler);
router.post('/send-otp', otpRateLimiter, resendOtpHandler); // Backward-compatible alias

// Authentication
router.post('/login', loginRateLimiter, loginStudent);
router.post('/logout', authenticateToken, logoutStudent);
router.get('/me', authenticateToken, getCurrentUser);

export default router;
