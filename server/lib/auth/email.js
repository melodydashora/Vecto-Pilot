// server/lib/auth/email.js
// SendGrid email service for password reset and verification

import sgMail from '@sendgrid/mail';

// Initialize SendGrid with API key
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@vectopilot.com';
const APP_NAME = 'VectoPilot';
const APP_URL = process.env.APP_URL || 'https://vectopilot.com';

// Brand colors (amber/gold theme)
const BRAND_COLOR = '#f59e0b'; // amber-500

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

/**
 * Check if email service is configured
 * @returns {boolean}
 */
export function isEmailConfigured() {
  return !!SENDGRID_API_KEY;
}

/**
 * Send password reset email with link
 * @param {string} email - Recipient email
 * @param {string} resetToken - Password reset token
 * @param {string} firstName - User's first name
 */
export async function sendPasswordResetEmail(email, resetToken, firstName = 'Driver') {
  if (!isEmailConfigured()) {
    console.warn('[email] SendGrid not configured - skipping password reset email');
    return { sent: false, reason: 'not_configured' };
  }

  const resetLink = `${APP_URL}/auth/reset-password/${resetToken}`;

  const msg = {
    to: email,
    from: FROM_EMAIL,
    subject: `Reset your ${APP_NAME} password`,
    text: `
Hi ${firstName},

You requested to reset your password for ${APP_NAME}.

Click this link to reset your password (expires in 1 hour):
${resetLink}

If you didn't request this, you can safely ignore this email.

- The ${APP_NAME} Team
    `.trim(),
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc;">
  <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-radius: 12px; padding: 30px; margin-bottom: 20px;">
    <div style="text-align: center; margin-bottom: 20px;">
      <h1 style="color: #f59e0b; margin: 0; font-size: 28px;">${APP_NAME}</h1>
      <p style="color: #94a3b8; margin: 5px 0 0 0; font-size: 14px;">Your Guardian on the Road</p>
    </div>

    <div style="background-color: #334155; border-radius: 8px; padding: 24px;">
      <p style="color: #e2e8f0; margin-top: 0;">Hi ${firstName},</p>

      <p style="color: #cbd5e1;">You requested to reset your password for ${APP_NAME}.</p>

      <div style="text-align: center; margin: 24px 0;">
        <a href="${resetLink}" style="display: inline-block; background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">Reset Password</a>
      </div>

      <p style="color: #94a3b8; font-size: 14px;">This link expires in 1 hour.</p>

      <p style="color: #94a3b8; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
    </div>

    <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 20px; margin-bottom: 0;">
      &copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
    </p>
  </div>
</body>
</html>
    `.trim()
  };

  try {
    await sgMail.send(msg);
    console.log('[email] Password reset email sent to:', email);
    return { sent: true };
  } catch (error) {
    console.error('[email] Failed to send password reset email:', error.message);
    throw new Error('Failed to send password reset email');
  }
}

/**
 * Send email verification with code
 * @param {string} email - Recipient email
 * @param {string} code - Verification code
 * @param {string} firstName - User's first name
 */
export async function sendEmailVerification(email, code, firstName = 'Driver') {
  if (!isEmailConfigured()) {
    console.warn('[email] SendGrid not configured - skipping email verification');
    return { sent: false, reason: 'not_configured' };
  }

  const msg = {
    to: email,
    from: FROM_EMAIL,
    subject: `Verify your ${APP_NAME} email`,
    text: `
Hi ${firstName},

Your ${APP_NAME} verification code is: ${code}

This code expires in 15 minutes.

If you didn't request this, you can safely ignore this email.

- The ${APP_NAME} Team
    `.trim(),
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc;">
  <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-radius: 12px; padding: 30px; margin-bottom: 20px;">
    <div style="text-align: center; margin-bottom: 20px;">
      <h1 style="color: #f59e0b; margin: 0; font-size: 28px;">${APP_NAME}</h1>
      <p style="color: #94a3b8; margin: 5px 0 0 0; font-size: 14px;">Your Guardian on the Road</p>
    </div>

    <div style="background-color: #334155; border-radius: 8px; padding: 24px;">
      <p style="color: #e2e8f0; margin-top: 0;">Hi ${firstName},</p>

      <p style="color: #cbd5e1;">Your verification code is:</p>

      <div style="text-align: center; margin: 24px 0;">
        <span style="display: inline-block; background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); padding: 16px 32px; font-size: 32px; font-weight: bold; letter-spacing: 8px; border-radius: 8px; font-family: monospace; color: white;">${code}</span>
      </div>

      <p style="color: #94a3b8; font-size: 14px;">This code expires in 15 minutes.</p>

      <p style="color: #94a3b8; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
    </div>

    <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 20px; margin-bottom: 0;">
      &copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
    </p>
  </div>
</body>
</html>
    `.trim()
  };

  try {
    await sgMail.send(msg);
    console.log('[email] Verification email sent to:', email);
    return { sent: true };
  } catch (error) {
    console.error('[email] Failed to send verification email:', error.message);
    throw new Error('Failed to send verification email');
  }
}

/**
 * Send welcome email after registration
 * @param {string} email - Recipient email
 * @param {string} firstName - User's first name
 */
export async function sendWelcomeEmail(email, firstName = 'Driver') {
  if (!isEmailConfigured()) {
    console.warn('[email] SendGrid not configured - skipping welcome email');
    return { sent: false, reason: 'not_configured' };
  }

  const msg = {
    to: email,
    from: FROM_EMAIL,
    subject: `Welcome to ${APP_NAME}!`,
    text: `
Hi ${firstName},

Welcome to ${APP_NAME}! Your account has been created successfully.

${APP_NAME} uses AI to help rideshare drivers find the best staging spots and maximize their earnings.

Get started: ${APP_URL}

- The ${APP_NAME} Team
    `.trim(),
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc;">
  <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-radius: 12px; padding: 30px; margin-bottom: 20px;">
    <div style="text-align: center; margin-bottom: 20px;">
      <h1 style="color: #f59e0b; margin: 0; font-size: 28px;">${APP_NAME}</h1>
      <p style="color: #94a3b8; margin: 5px 0 0 0; font-size: 14px;">Your Guardian on the Road</p>
    </div>

    <div style="background-color: #334155; border-radius: 8px; padding: 24px;">
      <p style="color: #e2e8f0; margin-top: 0;">Hi ${firstName},</p>

      <p style="color: #cbd5e1;">Welcome to ${APP_NAME}! Your account has been created successfully.</p>

      <p style="color: #cbd5e1;">${APP_NAME} uses AI to help rideshare drivers find the best staging spots and maximize their earnings safely.</p>

      <div style="text-align: center; margin: 24px 0;">
        <a href="${APP_URL}" style="display: inline-block; background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">Get Started</a>
      </div>
    </div>

    <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 20px; margin-bottom: 0;">
      &copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
    </p>
  </div>
</body>
</html>
    `.trim()
  };

  try {
    await sgMail.send(msg);
    console.log('[email] Welcome email sent to:', email);
    return { sent: true };
  } catch (error) {
    console.error('[email] Failed to send welcome email:', error.message);
    // Don't throw - welcome email is not critical
    return { sent: false, reason: error.message };
  }
}
