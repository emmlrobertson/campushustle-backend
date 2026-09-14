/**
 * Centralized JWT Secret & Configuration
 * Ensures authentication secrets strictly come from environment variables.
 * Never allows a hardcoded fallback string.
 */

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim() === '') {
    throw new Error('FATAL SECURITY ERROR: JWT_SECRET environment variable is missing.');
  }
  if (secret.length < 32 && process.env.NODE_ENV === 'production') {
    throw new Error('FATAL SECURITY ERROR: JWT_SECRET must be at least 32 characters in production.');
  }
  return secret;
}

export const JWT_EXPIRES_IN = '7d';
