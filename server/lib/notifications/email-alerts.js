// server/lib/notifications/email-alerts.js
// Email alerts for model errors and system notifications using Resend

import { Resend } from 'resend';

// Initialize Resend client (API key from environment)
const resend = new Resend(process.env.RESEND_API_KEY);

// Alert recipient
const ALERT_EMAIL = 'melodydashora@gmail.com';

/**
 * Send an email alert when a model error occurs
 * @param {Object} params - Alert parameters
 * @param {string} params.model - The model that failed (e.g., 'claude-opus-4-5', 'gpt-5.2')
 * @param {string} params.errorType - Type of error (e.g., 'credit_exhaustion', 'rate_limit', 'api_error')
 * @param {string} params.errorMessage - The error message
 * @param {string} params.context - Where the error occurred (e.g., 'traffic_analysis', 'strategy_generation')
 * @param {boolean} params.fallbackSucceeded - Whether fallback to another model worked
 * @param {string} params.fallbackModel - The fallback model used (if any)
 */
export async function sendModelErrorAlert({
  model,
  errorType,
  errorMessage,
  context,
  fallbackSucceeded = false,
  fallbackModel = null
}) {
  // NOTE: This is an intentional hardcoded timezone for INTERNAL developer alerts.
  // This is NOT user-facing location data - it's for consistent alert timestamps.
  // All system alerts use the same timezone for easy comparison in the dev team.
  const timestamp = new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago', // Internal alert timezone (intentional - not user data)
    dateStyle: 'medium',
    timeStyle: 'medium'
  });

  const statusEmoji = fallbackSucceeded ? '⚠️' : '🚨';
  const statusText = fallbackSucceeded
    ? `Fallback to ${fallbackModel} succeeded`
    : 'No fallback available - feature degraded';

  const subject = `${statusEmoji} Vecto Pilot: ${model} Error - ${errorType}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: ${fallbackSucceeded ? '#f59e0b' : '#dc2626'};">
        ${statusEmoji} Model Error Alert
      </h2>

      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold; width: 140px;">Model:</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">${model}</code></td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Error Type:</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><span style="color: #dc2626;">${errorType}</span></td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Context:</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${context}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Timestamp:</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${timestamp}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Status:</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; color: ${fallbackSucceeded ? '#16a34a' : '#dc2626'};">${statusText}</td>
        </tr>
      </table>

      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px; margin: 16px 0;">
        <strong style="color: #991b1b;">Error Message:</strong>
        <pre style="margin: 8px 0 0 0; white-space: pre-wrap; word-break: break-word; font-size: 13px; color: #7f1d1d;">${errorMessage}</pre>
      </div>

      ${fallbackSucceeded ? `
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px; margin: 16px 0;">
        <strong style="color: #166534;">Fallback Success:</strong>
        <p style="margin: 8px 0 0 0; color: #15803d;">The system automatically switched to <code style="background: #dcfce7; padding: 2px 6px; border-radius: 4px;">${fallbackModel}</code> and the request completed successfully.</p>
      </div>
      ` : ''}

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />

      <p style="color: #6b7280; font-size: 12px;">
        This is an automated alert from Vecto Pilot monitoring system.
      </p>
    </div>
  `;

  try {
    const result = await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: ALERT_EMAIL,
      subject,
      html
    });

    console.log(`📧 [EMAIL] Alert sent for ${model} error:`, result);
    return { success: true, id: result.id };
  } catch (err) {
    console.error(`📧 [EMAIL] Failed to send alert:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send a test email to verify the notification system works
 */
export async function sendTestEmail() {
  // NOTE: Intentional hardcoded timezone for internal test alerts (not user data)
  const timestamp = new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago', // Internal alert timezone (intentional - not user data)
    dateStyle: 'medium',
    timeStyle: 'medium'
  });

  try {
    const result = await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: ALERT_EMAIL,
      subject: '✅ Vecto Pilot Email Alerts - Test Successful',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #16a34a;">✅ Email Alerts Working!</h2>
          <p>Your Vecto Pilot email notification system is configured correctly.</p>
          <p><strong>Test sent at:</strong> ${timestamp}</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="color: #6b7280; font-size: 12px;">
            You will receive alerts when model errors occur (credit exhaustion, rate limits, API failures).
          </p>
        </div>
      `
    });

    console.log(`📧 [EMAIL] Test email sent successfully:`, result);
    return { success: true, id: result.id };
  } catch (err) {
    console.error(`📧 [EMAIL] Test email failed:`, err.message);
    return { success: false, error: err.message };
  }
}
