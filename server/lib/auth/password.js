// server/lib/auth/password.js
// Password hashing and token generation utilities

import crypto from 'node:crypto';
import bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

/**
 * Hash a password using bcrypt
 * @param {string} plaintext - The plain text password
 * @returns {Promise<string>} The hashed password
 */
export async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a hash
 * @param {string} plaintext - The plain text password
 * @param {string} hash - The bcrypt hash
 * @returns {Promise<boolean>} True if password matches
 */
export async function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash);
}

/**
 * Generate a secure random token for password reset links
 * @returns {string} 64-character hex token
 */
export function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a 6-digit numeric verification code for SMS
 * @returns {string} 6-digit code
 */
export function generateVerificationCode() {
  // Generate number between 100000 and 999999
  return String(Math.floor(100000 + crypto.randomInt(900000)));
}

/**
 * Generate a secure session token
 * @returns {string} 32-character hex token
 */
export function generateSessionToken() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Check password strength requirements
 * @param {string} password - Password to validate
 * @returns {{ valid: boolean, errors: string[] }} Validation result
 */
export function validatePasswordStrength(password) {
  const errors = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Calculate password reset token expiry (1 hour from now)
 * @returns {Date} Expiry timestamp
 */
export function getResetTokenExpiry() {
  return new Date(Date.now() + 60 * 60 * 1000); // 1 hour
}

/**
 * Calculate verification code expiry (15 minutes from now)
 * @returns {Date} Expiry timestamp
 */
export function getVerificationCodeExpiry() {
  return new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
}
