import rateLimit from 'express-rate-limit';

/**
 * Rate Limiter for Login Endpoint
 * Protects against credential stuffing & automated brute-force password guessing
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 attempts per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many login attempts from this IP. Please try again after 15 minutes.',
  },
});

/**
 * Rate Limiter for Student Registration
 * Protects against bot account creation
 */
export const registerRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 15, // Max 15 registrations per hour per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many registration requests from this network. Please try again in an hour.',
  },
});

/**
 * Rate Limiter for OTP Dispatch / Verification
 */
export const otpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 attempts per 15 minutes
  keyGenerator: (req) => {
    const bodyIdentifier = req.body?.email || req.body?.phone || req.body?.whatsAppNumber || '';
    const cleanId = typeof bodyIdentifier === 'string' ? bodyIdentifier.trim().toLowerCase() : '';
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return cleanId ? `${ip}_${cleanId}` : ip;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many verification attempts for this account or network. Please try again after 15 minutes.',
  },
});
