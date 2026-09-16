import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/prisma';
import { getJwtSecret } from '../config/jwt';

export interface AuthenticatedUser {
  id: string;
  email: string;
  universityId: string;
  role: string;
  tokenVersion: number;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access Denied: Missing Authorization Bearer token.',
    });
  }

  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret) as AuthenticatedUser;

    // Verify user is active AND tokenVersion is still valid (Revocation Check)
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        phoneVerified: true,
        tokenVersion: true,
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'Account not found or has been deactivated.',
      });
    }

    if (!user.phoneVerified) {
      return res.status(403).json({
        success: false,
        error: 'Please verify your phone number to access this feature.',
      });
    }

    // Token Invalidation Check: If user logged out or changed password, tokenVersion changed
    if (decoded.tokenVersion && decoded.tokenVersion !== user.tokenVersion) {
      return res.status(401).json({
        success: false,
        error: 'Session has expired or has been logged out. Please sign in again.',
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
      universityId: decoded.universityId,
      role: user.role,
      tokenVersion: user.tokenVersion,
    };

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Authorization token has expired. Please log in again.',
      });
    }
    return res.status(403).json({
      success: false,
      error: 'Invalid Authorization token.',
    });
  }
};

/**
 * Middleware: Require ADMIN role
 */
export const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      error: 'Access Denied: Administrator privileges required.',
    });
  }
  next();
};

/**
 * Middleware: Require ADMIN or MODERATOR role
 */
export const requireAdminOrModerator = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user || (req.user.role !== 'ADMIN' && req.user.role !== 'MODERATOR')) {
    return res.status(403).json({
      success: false,
      error: 'Access Denied: Moderator or Administrator privileges required.',
    });
  }
  next();
};
