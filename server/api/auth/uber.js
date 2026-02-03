// server/api/auth/uber.js
// 2026-02-03: Uber OAuth and Webhook integration
// Handles OAuth authentication flow and webhook events from Uber

import { Router } from 'express';
import crypto from 'crypto';
import { authLog } from '../../logger/workflow.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════
const UBER_CLIENT_ID = process.env.UBER_CLIENT_ID;
const UBER_CLIENT_SECRET = process.env.UBER_CLIENT_SECRET;
const UBER_REDIRECT_URI = process.env.UBER_REDIRECT_URI || 'https://vectopilot.com/api/auth/uber/callback';
// Dedicated webhook signing key (separate from client secret for security)
const UBER_WEBHOOK_SECRET = process.env.UBER_WEBHOOK_SECRET;

// Uber OAuth URLs
const UBER_AUTH_URL = 'https://login.uber.com/oauth/v2/authorize';
const UBER_TOKEN_URL = 'https://login.uber.com/oauth/v2/token';

// ═══════════════════════════════════════════════════════════════════════════
// OAuth Flow
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/auth/uber
 * Initiates Uber OAuth flow - redirects user to Uber login
 */
router.get('/', (req, res) => {
  if (!UBER_CLIENT_ID) {
    authLog.error(1, 'Uber OAuth: Missing UBER_CLIENT_ID');
    return res.redirect('/auth/sign-in?error=uber_not_configured');
  }

  // Generate state for CSRF protection
  const state = crypto.randomBytes(16).toString('hex');

  // Store state in session/cookie for verification (simplified - use proper session in production)
  res.cookie('uber_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000 // 10 minutes
  });

  // Scopes for driver data access
  // See: https://developer.uber.com/docs/drivers/references/api
  const scopes = [
    'profile',           // Basic profile info
    'partner.accounts',  // Driver account info
    'partner.payments',  // Earnings data
    'partner.trips',     // Trip history
  ].join(' ');

  const authUrl = new URL(UBER_AUTH_URL);
  authUrl.searchParams.set('client_id', UBER_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', UBER_REDIRECT_URI);
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', state);

  authLog.phase(1, `Uber OAuth: Redirecting to Uber login`);
  res.redirect(authUrl.toString());
});

/**
 * GET /api/auth/uber/callback
 * Handles OAuth callback from Uber after user authorizes
 */
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  // Handle OAuth errors
  if (error) {
    authLog.error(1, `Uber OAuth error: ${error} - ${error_description}`);
    return res.redirect(`/auth/sign-in?error=uber_oauth_error&message=${encodeURIComponent(error_description || error)}`);
  }

  // Verify state for CSRF protection
  const storedState = req.cookies?.uber_oauth_state;
  if (!storedState || storedState !== state) {
    authLog.error(1, 'Uber OAuth: State mismatch (CSRF protection)');
    return res.redirect('/auth/sign-in?error=uber_state_mismatch');
  }

  // Clear the state cookie
  res.clearCookie('uber_oauth_state');

  if (!code) {
    authLog.error(1, 'Uber OAuth: No authorization code received');
    return res.redirect('/auth/sign-in?error=uber_no_code');
  }

  try {
    // Exchange authorization code for access token
    const tokenResponse = await fetch(UBER_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: UBER_CLIENT_ID,
        client_secret: UBER_CLIENT_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: UBER_REDIRECT_URI,
        code,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      authLog.error(1, `Uber OAuth: Token exchange failed - ${errorData}`);
      return res.redirect('/auth/sign-in?error=uber_token_failed');
    }

    const tokenData = await tokenResponse.json();
    const { access_token, refresh_token, expires_in, scope } = tokenData;

    authLog.done(1, `Uber OAuth: Token received (expires in ${expires_in}s, scopes: ${scope})`);

    // TODO: Fetch user profile from Uber API
    // TODO: Create/link user account in database
    // TODO: Store tokens securely for API access

    // For now, redirect with success (implement full flow later)
    authLog.warn(1, 'Uber OAuth: Token exchange successful but user creation not yet implemented');
    res.redirect('/auth/sign-in?success=uber_connected&message=Uber+account+linked+successfully');

  } catch (err) {
    authLog.error(1, `Uber OAuth callback failed: ${err.message}`);
    res.redirect(`/auth/sign-in?error=uber_callback_failed&message=${encodeURIComponent(err.message)}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Webhooks
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify Uber webhook signature
 * Uber uses HMAC-SHA256 with dedicated webhook signing key
 * @param {string} payload - Raw request body
 * @param {string} signature - X-Uber-Signature header value
 * @returns {boolean} - Whether signature is valid
 */
function verifyUberSignature(payload, signature) {
  if (!UBER_WEBHOOK_SECRET || !signature) {
    authLog.warn(1, `Uber Webhook: Missing ${!UBER_WEBHOOK_SECRET ? 'UBER_WEBHOOK_SECRET' : 'signature'}`);
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', UBER_WEBHOOK_SECRET)
    .update(payload, 'utf8')
    .digest('hex');

  // Timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * POST /api/auth/uber/webhook
 * Receives webhook events from Uber
 *
 * Uber webhooks documentation:
 * - Signature verification via X-Uber-Signature header (HMAC-SHA256)
 * - Must return 200 OK within 5 seconds
 * - Retry policy: 3 attempts with exponential backoff
 */
router.post('/webhook', async (req, res) => {
  const signature = req.headers['x-uber-signature'];
  const rawBody = JSON.stringify(req.body); // Note: Need raw body middleware for production

  // Verify webhook signature
  if (!verifyUberSignature(rawBody, signature)) {
    authLog.warn(1, 'Uber Webhook: Invalid signature - rejecting request');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { event_type, event_id, event_time, resource_href, meta } = req.body;

  authLog.phase(1, `Uber Webhook received: ${event_type} (${event_id})`);

  try {
    // Process different event types
    switch (event_type) {
      // ─────────────────────────────────────────────────────────────────────
      // Trip Events
      // ─────────────────────────────────────────────────────────────────────
      case 'trips.status_changed':
        await handleTripStatusChanged(req.body);
        break;

      case 'trips.completed':
        await handleTripCompleted(req.body);
        break;

      // ─────────────────────────────────────────────────────────────────────
      // Driver Events
      // ─────────────────────────────────────────────────────────────────────
      case 'driver.status_changed':
        await handleDriverStatusChanged(req.body);
        break;

      case 'driver.online':
      case 'driver.offline':
        await handleDriverOnlineStatus(req.body);
        break;

      // ─────────────────────────────────────────────────────────────────────
      // Earnings Events
      // ─────────────────────────────────────────────────────────────────────
      case 'payments.trip_payment':
        await handleTripPayment(req.body);
        break;

      // ─────────────────────────────────────────────────────────────────────
      // Default - Log unknown events
      // ─────────────────────────────────────────────────────────────────────
      default:
        authLog.warn(1, `Uber Webhook: Unhandled event type: ${event_type}`);
        console.log('[Uber Webhook] Unhandled event:', JSON.stringify(req.body, null, 2));
    }

    // Always return 200 OK to acknowledge receipt
    // Uber will retry if we don't respond quickly
    authLog.done(1, `Uber Webhook processed: ${event_type}`);
    res.status(200).json({ received: true, event_id });

  } catch (err) {
    authLog.error(1, `Uber Webhook processing error: ${err.message}`);
    // Still return 200 to prevent retries for application errors
    // Log the error for investigation
    res.status(200).json({ received: true, event_id, warning: 'Processing error logged' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Webhook Event Handlers
// ═══════════════════════════════════════════════════════════════════════════

async function handleTripStatusChanged(event) {
  const { resource_href, meta } = event;
  authLog.phase(1, `Trip status changed: ${meta?.status || 'unknown'}`);
  // TODO: Update trip status in database
  // TODO: Trigger real-time notification to driver
}

async function handleTripCompleted(event) {
  const { resource_href, meta } = event;
  authLog.phase(1, `Trip completed`);
  // TODO: Fetch trip details from Uber API
  // TODO: Store trip data for analytics
  // TODO: Update driver statistics
}

async function handleDriverStatusChanged(event) {
  const { meta } = event;
  authLog.phase(1, `Driver status: ${meta?.status || 'unknown'}`);
  // TODO: Update driver status in real-time
}

async function handleDriverOnlineStatus(event) {
  const { event_type, meta } = event;
  const isOnline = event_type === 'driver.online';
  authLog.phase(1, `Driver ${isOnline ? 'online' : 'offline'}`);
  // TODO: Track driver session for analytics
}

async function handleTripPayment(event) {
  const { meta } = event;
  authLog.phase(1, `Payment received: ${meta?.amount || 'unknown'}`);
  // TODO: Store payment for earnings tracking
  // TODO: Update daily/weekly earnings summary
}

export default router;
