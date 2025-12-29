// server/lib/auth/sms.js
// Twilio SMS service for password reset and phone verification

import twilio from 'twilio';

// Initialize Twilio with credentials
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const APP_NAME = 'EngelPilot';

let twilioClient = null;

if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

/**
 * Check if SMS service is configured
 * @returns {boolean}
 */
export function isSmsConfigured() {
  return !!(twilioClient && TWILIO_PHONE_NUMBER);
}

/**
 * Format phone number to E.164 format
 * @param {string} phone - Phone number in various formats
 * @returns {string} Phone in E.164 format (+1XXXXXXXXXX)
 */
export function formatPhoneE164(phone) {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');

  // If already has country code (11 digits starting with 1)
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // If 10 digits (US number without country code)
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // If already in E.164 format
  if (phone.startsWith('+')) {
    return phone;
  }

  // Default: assume US and add +1
  return `+1${digits}`;
}

/**
 * Send password reset code via SMS
 * @param {string} phone - Recipient phone number
 * @param {string} code - 6-digit verification code
 */
export async function sendPasswordResetSMS(phone, code) {
  if (!isSmsConfigured()) {
    console.warn('[sms] Twilio not configured - skipping password reset SMS');
    return { sent: false, reason: 'not_configured' };
  }

  const formattedPhone = formatPhoneE164(phone);
  const message = `Your ${APP_NAME} password reset code is: ${code}\n\nThis code expires in 15 minutes.`;

  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: TWILIO_PHONE_NUMBER,
      to: formattedPhone
    });

    console.log('[sms] Password reset SMS sent:', { to: formattedPhone, sid: result.sid });
    return { sent: true, sid: result.sid };
  } catch (error) {
    console.error('[sms] Failed to send password reset SMS:', error.message);
    throw new Error('Failed to send password reset SMS');
  }
}

/**
 * Send phone verification code via SMS
 * @param {string} phone - Recipient phone number
 * @param {string} code - 6-digit verification code
 */
export async function sendPhoneVerificationSMS(phone, code) {
  if (!isSmsConfigured()) {
    console.warn('[sms] Twilio not configured - skipping phone verification SMS');
    return { sent: false, reason: 'not_configured' };
  }

  const formattedPhone = formatPhoneE164(phone);
  const message = `Your ${APP_NAME} verification code is: ${code}\n\nThis code expires in 15 minutes.`;

  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: TWILIO_PHONE_NUMBER,
      to: formattedPhone
    });

    console.log('[sms] Verification SMS sent:', { to: formattedPhone, sid: result.sid });
    return { sent: true, sid: result.sid };
  } catch (error) {
    console.error('[sms] Failed to send verification SMS:', error.message);
    throw new Error('Failed to send verification SMS');
  }
}

/**
 * Send a generic SMS message
 * @param {string} phone - Recipient phone number
 * @param {string} message - Message text
 */
export async function sendSMS(phone, message) {
  if (!isSmsConfigured()) {
    console.warn('[sms] Twilio not configured - skipping SMS');
    return { sent: false, reason: 'not_configured' };
  }

  const formattedPhone = formatPhoneE164(phone);

  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: TWILIO_PHONE_NUMBER,
      to: formattedPhone
    });

    console.log('[sms] SMS sent:', { to: formattedPhone, sid: result.sid });
    return { sent: true, sid: result.sid };
  } catch (error) {
    console.error('[sms] Failed to send SMS:', error.message);
    throw new Error('Failed to send SMS');
  }
}

/**
 * Validate phone number format
 * @param {string} phone - Phone number to validate
 * @returns {{ valid: boolean, formatted: string | null, error?: string }}
 */
export function validatePhoneNumber(phone) {
  if (!phone) {
    return { valid: false, formatted: null, error: 'Phone number is required' };
  }

  const digits = phone.replace(/\D/g, '');

  if (digits.length < 10) {
    return { valid: false, formatted: null, error: 'Phone number must be at least 10 digits' };
  }

  if (digits.length > 15) {
    return { valid: false, formatted: null, error: 'Phone number too long' };
  }

  return { valid: true, formatted: formatPhoneE164(phone) };
}
