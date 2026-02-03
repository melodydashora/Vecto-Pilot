/**
 * Uber OAuth API Routes
 * Handles OAuth flow for Uber Driver integration
 */

import { Router } from 'express';
import { db } from '../../db.js';
import { uber_connections, oauth_states } from '../../../shared/schema.js';
import { eq, and, gt } from 'drizzle-orm';
import {
  generateState,
  getAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  revokeToken,
  encryptToken,
  decryptToken,
  calculateExpiresAt,
  isTokenExpired,
} from '../../lib/auth/oauth/uber-oauth.js';

const router = Router();

// State expiration time (10 minutes)
const STATE_EXPIRY_MS = 10 * 60 * 1000;

/**
 * GET /api/auth/uber
 * Initiate Uber OAuth flow - redirects to Uber login
 */
router.get('/', async (req, res) => {
  try {
    // Require authenticated user
    if (!req.user?.user_id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Generate CSRF state
    const state = generateState();

    // Store state in database for validation on callback
    await db.insert(oauth_states).values({
      state,
      provider: 'uber',
      user_id: req.user.user_id,
      redirect_uri: process.env.UBER_REDIRECT_URI,
      expires_at: new Date(Date.now() + STATE_EXPIRY_MS),
    });

    // Build and redirect to Uber authorization URL
    const authUrl = getAuthorizationUrl({ state });
    res.redirect(authUrl);

  } catch (error) {
    console.error('Uber OAuth initiation error:', error);
    res.status(500).json({ error: 'Failed to initiate OAuth flow' });
  }
});

/**
 * GET /api/auth/uber/callback
 * Handle OAuth callback from Uber
 */
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  // Handle OAuth errors from Uber
  if (error) {
    console.error('Uber OAuth error:', error, error_description);
    return res.redirect(`/auth/signup?error=${encodeURIComponent(error_description || error)}`);
  }

  if (!code || !state) {
    return res.redirect('/auth/signup?error=missing_params');
  }

  try {
    // Validate state parameter
    const [storedState] = await db.select()
      .from(oauth_states)
      .where(and(
        eq(oauth_states.state, state),
        eq(oauth_states.provider, 'uber'),
        gt(oauth_states.expires_at, new Date())
      ))
      .limit(1);

    if (!storedState) {
      return res.redirect('/auth/signup?error=invalid_state');
    }

    const userId = storedState.user_id;

    // Clean up used state
    await db.delete(oauth_states).where(eq(oauth_states.id, storedState.id));

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);

    // Encrypt tokens for storage
    const encryptedAccessToken = encryptToken(tokens.access_token);
    const encryptedRefreshToken = tokens.refresh_token
      ? encryptToken(tokens.refresh_token)
      : null;

    // Calculate expiration
    const expiresAt = calculateExpiresAt(tokens.expires_in);

    // Parse scopes
    const scopes = tokens.scope ? tokens.scope.split(' ') : [];

    // Upsert connection record
    await db.insert(uber_connections)
      .values({
        user_id: userId,
        access_token_encrypted: encryptedAccessToken,
        refresh_token_encrypted: encryptedRefreshToken,
        token_expires_at: expiresAt,
        scopes,
        connected_at: new Date(),
        is_active: true,
      })
      .onConflictDoUpdate({
        target: uber_connections.user_id,
        set: {
          access_token_encrypted: encryptedAccessToken,
          refresh_token_encrypted: encryptedRefreshToken,
          token_expires_at: expiresAt,
          scopes,
          connected_at: new Date(),
          is_active: true,
          updated_at: new Date(),
        },
      });

    // Redirect to success page
    res.redirect('/auth/signup?uber_connected=true');

  } catch (error) {
    console.error('Uber OAuth callback error:', error);
    res.redirect(`/auth/signup?error=${encodeURIComponent('oauth_failed')}`);
  }
});

/**
 * POST /api/auth/uber/disconnect
 * Disconnect Uber integration
 */
router.post('/disconnect', async (req, res) => {
  try {
    if (!req.user?.user_id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get existing connection
    const [connection] = await db.select()
      .from(uber_connections)
      .where(and(
        eq(uber_connections.user_id, req.user.user_id),
        eq(uber_connections.is_active, true)
      ))
      .limit(1);

    if (!connection) {
      return res.status(404).json({ error: 'No Uber connection found' });
    }

    // Revoke token with Uber (best effort)
    try {
      const accessToken = decryptToken(connection.access_token_encrypted);
      await revokeToken(accessToken);
    } catch (revokeError) {
      console.warn('Token revocation warning:', revokeError.message);
    }

    // Mark connection as inactive
    await db.update(uber_connections)
      .set({
        is_active: false,
        updated_at: new Date(),
      })
      .where(eq(uber_connections.id, connection.id));

    res.json({ success: true, message: 'Uber disconnected successfully' });

  } catch (error) {
    console.error('Uber disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect Uber' });
  }
});

/**
 * POST /api/auth/uber/refresh
 * Refresh Uber access token
 */
router.post('/refresh', async (req, res) => {
  try {
    if (!req.user?.user_id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get existing connection
    const [connection] = await db.select()
      .from(uber_connections)
      .where(and(
        eq(uber_connections.user_id, req.user.user_id),
        eq(uber_connections.is_active, true)
      ))
      .limit(1);

    if (!connection) {
      return res.status(404).json({ error: 'No Uber connection found' });
    }

    if (!connection.refresh_token_encrypted) {
      return res.status(400).json({ error: 'No refresh token available' });
    }

    // Decrypt refresh token
    const refreshToken = decryptToken(connection.refresh_token_encrypted);

    // Get new tokens
    const tokens = await refreshAccessToken(refreshToken);

    // Encrypt new tokens
    const encryptedAccessToken = encryptToken(tokens.access_token);
    const encryptedRefreshToken = tokens.refresh_token
      ? encryptToken(tokens.refresh_token)
      : connection.refresh_token_encrypted;

    // Update connection
    await db.update(uber_connections)
      .set({
        access_token_encrypted: encryptedAccessToken,
        refresh_token_encrypted: encryptedRefreshToken,
        token_expires_at: calculateExpiresAt(tokens.expires_in),
        updated_at: new Date(),
      })
      .where(eq(uber_connections.id, connection.id));

    res.json({
      success: true,
      expires_at: calculateExpiresAt(tokens.expires_in),
    });

  } catch (error) {
    console.error('Uber token refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

/**
 * GET /api/auth/uber/status
 * Get current Uber connection status
 */
router.get('/status', async (req, res) => {
  try {
    if (!req.user?.user_id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const [connection] = await db.select({
      connected_at: uber_connections.connected_at,
      last_sync_at: uber_connections.last_sync_at,
      token_expires_at: uber_connections.token_expires_at,
      scopes: uber_connections.scopes,
      is_active: uber_connections.is_active,
    })
      .from(uber_connections)
      .where(eq(uber_connections.user_id, req.user.user_id))
      .limit(1);

    if (!connection || !connection.is_active) {
      return res.json({ connected: false });
    }

    res.json({
      connected: true,
      connected_at: connection.connected_at,
      last_sync_at: connection.last_sync_at,
      token_valid: !isTokenExpired(connection.token_expires_at),
      token_expires_at: connection.token_expires_at,
      scopes: connection.scopes,
    });

  } catch (error) {
    console.error('Uber status error:', error);
    res.status(500).json({ error: 'Failed to get connection status' });
  }
});

export default router;
