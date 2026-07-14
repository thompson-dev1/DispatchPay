import argon2 from 'argon2';
import crypto from 'crypto';

/**
 * Hash a password using Argon2id with recommended parameters.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64MB
    timeCost: 3,       // 3 iterations
    parallelism: 4,    // 4 threads
  });
}

/**
 * Verify a password against an Argon2id hash.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * Generate a cryptographically secure 6-digit numeric OTP.
 */
export function generateOtp(): string {
  // Generates integer between 100,000 and 999,999 inclusive
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Hash an OTP using SHA-256 for secure DB comparisons.
 */
export function hashOtp(otpCode: string): string {
  return crypto.createHash('sha256').update(otpCode).digest('hex');
}
