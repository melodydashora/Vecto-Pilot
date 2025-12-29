// server/api/auth/auth.js
// Complete authentication API routes

import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../../db/drizzle.js';
import { eq, and, gt } from 'drizzle-orm';
import {
  users,
  driver_profiles,
  driver_vehicles,
  auth_credentials,
  verification_codes
} from '../../../shared/schema.js';
import {
  hashPassword,
  verifyPassword,
  generateResetToken,
  generateVerificationCode,
  validatePasswordStrength,
  getResetTokenExpiry,
  getVerificationCodeExpiry
} from '../../lib/auth/password.js';
import { sendPasswordResetEmail, sendEmailVerification, sendWelcomeEmail, isEmailConfigured } from '../../lib/auth/email.js';
import { sendPasswordResetSMS, isSmsConfigured, validatePhoneNumber } from '../../lib/auth/sms.js';
import { requireAuth } from '../../middleware/auth.js';
import { authLog } from '../../logger/workflow.js';
import { geocodeAddress } from '../../lib/location/geocode.js';

const router = Router();

// JWT secret for token generation
const JWT_SECRET = process.env.JWT_SECRET || process.env.REPLIT_DEVSERVER_INTERNAL_ID || 'dev-secret-change-in-production';

/**
 * Generate a JWT token for a user
 * @param {string} userId - User UUID
 * @param {string} email - User email (optional, for logging)
 * @returns {string} JWT token
 */
function generateAuthToken(userId, email = '') {
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(userId).digest('hex');
  authLog.done(1, `Token generated for: ${email || userId.substring(0, 8)}`);
  return `${userId}.${signature}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/auth/register - Create new driver account
// ═══════════════════════════════════════════════════════════════════════════
router.post('/register', async (req, res) => {
  try {
    const {
      // Account
      firstName,
      lastName,
      email,
      phone,
      password,
      // Address
      address1,
      address2,
      city,
      stateTerritory,
      zipCode,
      country = 'US',
      market,
      // Vehicle
      vehicle,
      // Rideshare
      ridesharePlatforms = ['uber'],
      uberTiers = {},
      // Preferences
      marketingOptIn = false,
      termsAccepted = false
    } = req.body;

    // Validate required fields
    const missing = [];
    if (!firstName) missing.push('firstName');
    if (!lastName) missing.push('lastName');
    if (!email) missing.push('email');
    if (!phone) missing.push('phone');
    if (!password) missing.push('password');
    if (!address1) missing.push('address1');
    if (!city) missing.push('city');
    if (!stateTerritory) missing.push('stateTerritory');
    if (!market) missing.push('market');
    if (!vehicle?.year) missing.push('vehicle.year');
    if (!vehicle?.make) missing.push('vehicle.make');
    if (!vehicle?.model) missing.push('vehicle.model');
    if (!termsAccepted) missing.push('termsAccepted');

    if (missing.length > 0) {
      return res.status(400).json({
        error: 'MISSING_FIELDS',
        missing,
        message: `Missing required fields: ${missing.join(', ')}`
      });
    }

    // Validate password strength
    const passwordCheck = validatePasswordStrength(password);
    if (!passwordCheck.valid) {
      return res.status(400).json({
        error: 'WEAK_PASSWORD',
        errors: passwordCheck.errors
      });
    }

    // Validate phone number
    const phoneCheck = validatePhoneNumber(phone);
    if (!phoneCheck.valid) {
      return res.status(400).json({
        error: 'INVALID_PHONE',
        message: phoneCheck.error
      });
    }

    // Check if email already exists
    const existingProfile = await db.query.driver_profiles.findFirst({
      where: eq(driver_profiles.email, email.toLowerCase().trim())
    });

    if (existingProfile) {
      return res.status(409).json({
        error: 'EMAIL_EXISTS',
        message: 'An account with this email already exists'
      });
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Geocode the address to get lat/lng (non-blocking, don't fail registration if this fails)
    let geocodeResult = null;
    try {
      geocodeResult = await geocodeAddress({
        address1: address1.trim(),
        address2: address2?.trim(),
        city: city.trim(),
        stateTerritory: stateTerritory.trim(),
        zipCode: zipCode?.trim(),
        country: country.trim()
      });
      if (geocodeResult) {
        authLog.done(1, `Address geocoded: ${geocodeResult.lat}, ${geocodeResult.lng}`);
      }
    } catch (geoErr) {
      console.warn('[auth] Geocoding failed (non-fatal):', geoErr.message);
    }

    // Create user record with geocoded coordinates if available
    const [newUser] = await db.insert(users).values({
      user_id: crypto.randomUUID(),
      device_id: `web-${crypto.randomUUID().substring(0, 8)}`,
      lat: geocodeResult?.lat || 0,
      lng: geocodeResult?.lng || 0,
      coord_source: geocodeResult ? 'geocoded' : 'pending',
      city: geocodeResult ? city.trim() : null,
      state: geocodeResult ? stateTerritory.trim() : null,
      country: geocodeResult ? country.trim() : null,
      timezone: geocodeResult?.timezone || null,
      formatted_address: geocodeResult?.formattedAddress || null
    }).returning();

    // Create driver profile with geocoded home coordinates
    const [profile] = await db.insert(driver_profiles).values({
      user_id: newUser.user_id,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.toLowerCase().trim(),
      phone: phoneCheck.formatted,
      address_1: address1.trim(),
      address_2: address2?.trim() || null,
      city: city.trim(),
      state_territory: stateTerritory.trim(),
      zip_code: zipCode?.trim() || null,
      country: country.trim(),
      // Store geocoded home coordinates
      home_lat: geocodeResult?.lat || null,
      home_lng: geocodeResult?.lng || null,
      home_formatted_address: geocodeResult?.formattedAddress || null,
      home_timezone: geocodeResult?.timezone || null,
      market: market.trim(),
      rideshare_platforms: ridesharePlatforms,
      uber_black: uberTiers.uberBlack || false,
      uber_xxl: uberTiers.uberXXL || false,
      uber_comfort: uberTiers.uberComfort || false,
      uber_x: uberTiers.uberX || false,
      uber_x_share: uberTiers.uberXShare || false,
      marketing_opt_in: marketingOptIn,
      terms_accepted_at: new Date(),
      terms_version: '1.0',
      profile_complete: true
    }).returning();

    // Create driver vehicle
    await db.insert(driver_vehicles).values({
      driver_profile_id: profile.id,
      year: vehicle.year,
      make: vehicle.make.trim(),
      model: vehicle.model.trim(),
      color: vehicle.color?.trim() || null,
      seatbelts: vehicle.seatbelts || 4,
      is_primary: true
    });

    // Create auth credentials
    await db.insert(auth_credentials).values({
      user_id: newUser.user_id,
      password_hash: passwordHash
    });

    // Generate auth token
    const token = generateAuthToken(newUser.user_id, email);

    // Send welcome email (non-blocking)
    sendWelcomeEmail(email, firstName).catch(err => {
      console.warn('[auth] Welcome email failed:', err.message);
    });

    authLog.done(1, `New driver registered: ${email}`);

    res.status(201).json({
      ok: true,
      token,
      user: {
        user_id: newUser.user_id,
        email: profile.email,
        firstName: profile.first_name,
        lastName: profile.last_name,
        market: profile.market
      }
    });

  } catch (err) {
    authLog.error(1, `Registration failed`, err);
    res.status(500).json({ error: 'REGISTRATION_FAILED', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/auth/login - Authenticate driver
// ═══════════════════════════════════════════════════════════════════════════
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'MISSING_CREDENTIALS',
        message: 'Email and password are required'
      });
    }

    // Find driver profile by email
    const profile = await db.query.driver_profiles.findFirst({
      where: eq(driver_profiles.email, email.toLowerCase().trim())
    });

    if (!profile) {
      return res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password'
      });
    }

    // Get auth credentials
    const creds = await db.query.auth_credentials.findFirst({
      where: eq(auth_credentials.user_id, profile.user_id)
    });

    if (!creds) {
      return res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password'
      });
    }

    // Check if account is locked
    if (creds.locked_until && new Date(creds.locked_until) > new Date()) {
      return res.status(423).json({
        error: 'ACCOUNT_LOCKED',
        message: 'Account is temporarily locked. Try again later.',
        locked_until: creds.locked_until
      });
    }

    // Verify password
    const isValid = await verifyPassword(password, creds.password_hash);

    if (!isValid) {
      // Increment failed attempts
      const newAttempts = (creds.failed_login_attempts || 0) + 1;
      const lockUntil = newAttempts >= 5
        ? new Date(Date.now() + 15 * 60 * 1000) // Lock for 15 mins after 5 failures
        : null;

      await db.update(auth_credentials)
        .set({
          failed_login_attempts: newAttempts,
          locked_until: lockUntil,
          updated_at: new Date()
        })
        .where(eq(auth_credentials.user_id, profile.user_id));

      authLog.warn(1, `Failed login attempt for: ${email} (${newAttempts} attempts)`);

      return res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password'
      });
    }

    // Successful login - reset failed attempts
    await db.update(auth_credentials)
      .set({
        failed_login_attempts: 0,
        locked_until: null,
        last_login_at: new Date(),
        last_login_ip: req.ip || req.headers['x-forwarded-for'] || 'unknown',
        updated_at: new Date()
      })
      .where(eq(auth_credentials.user_id, profile.user_id));

    // Generate token
    const token = generateAuthToken(profile.user_id, email);

    authLog.done(1, `Driver logged in: ${email}`);

    res.json({
      ok: true,
      token,
      user: {
        user_id: profile.user_id,
        email: profile.email,
        firstName: profile.first_name,
        lastName: profile.last_name,
        market: profile.market
      }
    });

  } catch (err) {
    authLog.error(1, `Login failed`, err);
    res.status(500).json({ error: 'LOGIN_FAILED', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/auth/forgot-password - Request password reset
// ═══════════════════════════════════════════════════════════════════════════
router.post('/forgot-password', async (req, res) => {
  try {
    const { email, method = 'email' } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'MISSING_EMAIL',
        message: 'Email is required'
      });
    }

    // Find driver profile
    const profile = await db.query.driver_profiles.findFirst({
      where: eq(driver_profiles.email, email.toLowerCase().trim())
    });

    // Always return success to prevent email enumeration
    if (!profile) {
      authLog.warn(1, `Password reset requested for non-existent email: ${email}`);
      return res.json({
        ok: true,
        message: 'If an account exists with this email, you will receive reset instructions.'
      });
    }

    if (method === 'sms') {
      // SMS reset with 6-digit code
      if (!isSmsConfigured()) {
        return res.status(503).json({
          error: 'SMS_NOT_CONFIGURED',
          message: 'SMS service is not configured. Please use email reset.'
        });
      }

      const code = generateVerificationCode();
      const expiresAt = getVerificationCodeExpiry();

      // Store verification code
      await db.insert(verification_codes).values({
        user_id: profile.user_id,
        code,
        code_type: 'password_reset_sms',
        destination: profile.phone,
        expires_at: expiresAt
      });

      // Send SMS
      await sendPasswordResetSMS(profile.phone, code);

      authLog.done(1, `Password reset SMS sent to: ${profile.phone}`);

    } else {
      // Email reset with token link
      if (!isEmailConfigured()) {
        return res.status(503).json({
          error: 'EMAIL_NOT_CONFIGURED',
          message: 'Email service is not configured. Please try again later.'
        });
      }

      const token = generateResetToken();
      const expiresAt = getResetTokenExpiry();

      // Store reset token
      await db.update(auth_credentials)
        .set({
          password_reset_token: token,
          password_reset_expires: expiresAt,
          updated_at: new Date()
        })
        .where(eq(auth_credentials.user_id, profile.user_id));

      // Send email
      await sendPasswordResetEmail(email, token, profile.first_name);

      authLog.done(1, `Password reset email sent to: ${email}`);
    }

    res.json({
      ok: true,
      method,
      message: method === 'sms'
        ? 'A verification code has been sent to your phone.'
        : 'If an account exists with this email, you will receive reset instructions.'
    });

  } catch (err) {
    authLog.error(1, `Forgot password failed`, err);
    res.status(500).json({ error: 'FORGOT_PASSWORD_FAILED', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/auth/reset-password - Reset password with token or code
// ═══════════════════════════════════════════════════════════════════════════
router.post('/reset-password', async (req, res) => {
  try {
    const { token, code, email, newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({
        error: 'MISSING_PASSWORD',
        message: 'New password is required'
      });
    }

    // Validate password strength
    const passwordCheck = validatePasswordStrength(newPassword);
    if (!passwordCheck.valid) {
      return res.status(400).json({
        error: 'WEAK_PASSWORD',
        errors: passwordCheck.errors
      });
    }

    let userId;

    if (token) {
      // Token-based reset (email link)
      const creds = await db.query.auth_credentials.findFirst({
        where: and(
          eq(auth_credentials.password_reset_token, token),
          gt(auth_credentials.password_reset_expires, new Date())
        )
      });

      if (!creds) {
        return res.status(400).json({
          error: 'INVALID_TOKEN',
          message: 'Invalid or expired reset token'
        });
      }

      userId = creds.user_id;

    } else if (code && email) {
      // Code-based reset (SMS)
      const profile = await db.query.driver_profiles.findFirst({
        where: eq(driver_profiles.email, email.toLowerCase().trim())
      });

      if (!profile) {
        return res.status(400).json({
          error: 'INVALID_CODE',
          message: 'Invalid verification code'
        });
      }

      const verificationCode = await db.query.verification_codes.findFirst({
        where: and(
          eq(verification_codes.user_id, profile.user_id),
          eq(verification_codes.code, code),
          eq(verification_codes.code_type, 'password_reset_sms'),
          gt(verification_codes.expires_at, new Date())
        )
      });

      if (!verificationCode || verificationCode.used_at) {
        return res.status(400).json({
          error: 'INVALID_CODE',
          message: 'Invalid or expired verification code'
        });
      }

      // Mark code as used
      await db.update(verification_codes)
        .set({ used_at: new Date() })
        .where(eq(verification_codes.id, verificationCode.id));

      userId = profile.user_id;

    } else {
      return res.status(400).json({
        error: 'MISSING_CREDENTIALS',
        message: 'Either token or (code + email) is required'
      });
    }

    // Hash new password
    const passwordHash = await hashPassword(newPassword);

    // Update credentials
    await db.update(auth_credentials)
      .set({
        password_hash: passwordHash,
        password_reset_token: null,
        password_reset_expires: null,
        password_changed_at: new Date(),
        failed_login_attempts: 0,
        locked_until: null,
        updated_at: new Date()
      })
      .where(eq(auth_credentials.user_id, userId));

    authLog.done(1, `Password reset successful for user: ${userId.substring(0, 8)}`);

    res.json({
      ok: true,
      message: 'Password has been reset successfully. You can now log in.'
    });

  } catch (err) {
    authLog.error(1, `Password reset failed`, err);
    res.status(500).json({ error: 'RESET_PASSWORD_FAILED', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/auth/me - Get current user profile
// ═══════════════════════════════════════════════════════════════════════════
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;

    // Get driver profile
    const profile = await db.query.driver_profiles.findFirst({
      where: eq(driver_profiles.user_id, userId)
    });

    if (!profile) {
      return res.status(404).json({
        error: 'PROFILE_NOT_FOUND',
        message: 'Driver profile not found'
      });
    }

    // Get vehicle
    const vehicle = await db.query.driver_vehicles.findFirst({
      where: and(
        eq(driver_vehicles.driver_profile_id, profile.id),
        eq(driver_vehicles.is_primary, true)
      )
    });

    res.json({
      user_id: profile.user_id,
      email: profile.email,
      firstName: profile.first_name,
      lastName: profile.last_name,
      phone: profile.phone,
      address: {
        address1: profile.address_1,
        address2: profile.address_2,
        city: profile.city,
        stateTerritory: profile.state_territory,
        zipCode: profile.zip_code,
        country: profile.country
      },
      market: profile.market,
      ridesharePlatforms: profile.rideshare_platforms,
      uberTiers: {
        uberBlack: profile.uber_black,
        uberXXL: profile.uber_xxl,
        uberComfort: profile.uber_comfort,
        uberX: profile.uber_x,
        uberXShare: profile.uber_x_share
      },
      marketingOptIn: profile.marketing_opt_in,
      emailVerified: profile.email_verified,
      phoneVerified: profile.phone_verified,
      vehicle: vehicle ? {
        id: vehicle.id,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        color: vehicle.color,
        seatbelts: vehicle.seatbelts
      } : null,
      createdAt: profile.created_at
    });

  } catch (err) {
    authLog.error(1, `Get profile failed`, err);
    res.status(500).json({ error: 'GET_PROFILE_FAILED', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/auth/profile - Update driver profile
// ═══════════════════════════════════════════════════════════════════════════
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const updates = req.body;

    // Get existing profile
    const profile = await db.query.driver_profiles.findFirst({
      where: eq(driver_profiles.user_id, userId)
    });

    if (!profile) {
      return res.status(404).json({
        error: 'PROFILE_NOT_FOUND',
        message: 'Driver profile not found'
      });
    }

    // Build update object
    const profileUpdates = {};

    if (updates.firstName) profileUpdates.first_name = updates.firstName.trim();
    if (updates.lastName) profileUpdates.last_name = updates.lastName.trim();
    if (updates.phone) {
      const phoneCheck = validatePhoneNumber(updates.phone);
      if (!phoneCheck.valid) {
        return res.status(400).json({ error: 'INVALID_PHONE', message: phoneCheck.error });
      }
      profileUpdates.phone = phoneCheck.formatted;
    }
    if (updates.address1) profileUpdates.address_1 = updates.address1.trim();
    if (updates.address2 !== undefined) profileUpdates.address_2 = updates.address2?.trim() || null;
    if (updates.city) profileUpdates.city = updates.city.trim();
    if (updates.stateTerritory) profileUpdates.state_territory = updates.stateTerritory.trim();
    if (updates.zipCode !== undefined) profileUpdates.zip_code = updates.zipCode?.trim() || null;
    if (updates.market) profileUpdates.market = updates.market.trim();
    if (updates.ridesharePlatforms) profileUpdates.rideshare_platforms = updates.ridesharePlatforms;
    if (updates.uberTiers) {
      if (updates.uberTiers.uberBlack !== undefined) profileUpdates.uber_black = updates.uberTiers.uberBlack;
      if (updates.uberTiers.uberXXL !== undefined) profileUpdates.uber_xxl = updates.uberTiers.uberXXL;
      if (updates.uberTiers.uberComfort !== undefined) profileUpdates.uber_comfort = updates.uberTiers.uberComfort;
      if (updates.uberTiers.uberX !== undefined) profileUpdates.uber_x = updates.uberTiers.uberX;
      if (updates.uberTiers.uberXShare !== undefined) profileUpdates.uber_x_share = updates.uberTiers.uberXShare;
    }
    if (updates.marketingOptIn !== undefined) profileUpdates.marketing_opt_in = updates.marketingOptIn;

    profileUpdates.updated_at = new Date();

    // Update profile
    await db.update(driver_profiles)
      .set(profileUpdates)
      .where(eq(driver_profiles.user_id, userId));

    // Update vehicle if provided
    if (updates.vehicle) {
      const vehicleUpdates = {};
      if (updates.vehicle.year) vehicleUpdates.year = updates.vehicle.year;
      if (updates.vehicle.make) vehicleUpdates.make = updates.vehicle.make.trim();
      if (updates.vehicle.model) vehicleUpdates.model = updates.vehicle.model.trim();
      if (updates.vehicle.color !== undefined) vehicleUpdates.color = updates.vehicle.color?.trim() || null;
      if (updates.vehicle.seatbelts) vehicleUpdates.seatbelts = updates.vehicle.seatbelts;
      vehicleUpdates.updated_at = new Date();

      await db.update(driver_vehicles)
        .set(vehicleUpdates)
        .where(and(
          eq(driver_vehicles.driver_profile_id, profile.id),
          eq(driver_vehicles.is_primary, true)
        ));
    }

    authLog.done(1, `Profile updated for: ${profile.email}`);

    res.json({
      ok: true,
      message: 'Profile updated successfully'
    });

  } catch (err) {
    authLog.error(1, `Update profile failed`, err);
    res.status(500).json({ error: 'UPDATE_PROFILE_FAILED', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/auth/logout - Logout (client-side token removal)
// ═══════════════════════════════════════════════════════════════════════════
router.post('/logout', requireAuth, async (req, res) => {
  // With stateless JWT, logout is client-side (remove token from localStorage)
  // This endpoint exists for future session invalidation if needed
  authLog.done(1, `User logged out: ${req.auth.userId.substring(0, 8)}`);
  res.json({ ok: true, message: 'Logged out successfully' });
});

// ═══════════════════════════════════════════════════════════════════════════
// Legacy dev token endpoint (kept for backward compatibility)
// ═══════════════════════════════════════════════════════════════════════════
const IS_REPLIT = Boolean(process.env.REPL_ID || process.env.REPLIT_DB_URL);
const IS_PRODUCTION = IS_REPLIT
  ? process.env.REPLIT_DEPLOYMENT === '1'
  : process.env.NODE_ENV === 'production';

router.post('/token', async (req, res) => {
  if (IS_PRODUCTION) {
    return res.status(403).json({
      error: 'token_minting_disabled',
      message: 'Token minting is disabled in production. Use /api/auth/login instead.'
    });
  }

  const { user_id } = req.body || req.query;
  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' });
  }

  const token = generateAuthToken(user_id, 'dev-token');

  res.json({
    token,
    user_id,
    expires_in: 86400,
    _dev_warning: 'This endpoint is disabled in production. Use /api/auth/login instead.'
  });
});

export default router;
