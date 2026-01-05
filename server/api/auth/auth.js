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
  verification_codes,
  platform_data
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
      nickname, // Optional custom greeting name
      // Address
      address1,
      address2,
      city,
      stateTerritory,
      zipCode,
      country = 'US',
      market,
      // Vehicle - accept both nested and flat formats
      vehicle,
      vehicleYear,  // Flat format from client
      vehicleMake,  // Flat format from client
      vehicleModel, // Flat format from client
      seatbelts,    // Flat format from client
      // Rideshare
      ridesharePlatforms = ['uber'],

      // ═══════════════════════════════════════════════════════════════════════
      // DRIVER ELIGIBILITY - Platform-agnostic taxonomy
      // ═══════════════════════════════════════════════════════════════════════

      // Vehicle Class (base tier)
      eligEconomy = true,
      eligXl,
      eligXxl,
      eligComfort,
      eligLuxurySedan,
      eligLuxurySuv,

      // Vehicle Attributes
      attrElectric,
      attrGreen,
      attrWav,
      attrSki,
      attrCarSeat,

      // Service Preferences
      prefPetFriendly,
      prefTeen,
      prefAssist,
      prefShared,

      // Legacy fields (backward compatibility)
      uberTiers,
      tierBlack,
      tierXl,
      tierComfort,
      tierStandard,
      tierShare,
      uberBlack,
      uberXxl,
      uberComfort,
      uberX,
      uberXShare,

      // Preferences
      marketingOptIn = false,
      termsAccepted = false
    } = req.body;

    // Normalize vehicle: support both nested and flat formats
    const normalizedVehicle = vehicle || {
      year: vehicleYear,
      make: vehicleMake,
      model: vehicleModel,
      seatbelts: seatbelts || 4
    };

    // ═══════════════════════════════════════════════════════════════════════
    // Normalize eligibility - support new fields with legacy fallback
    // ═══════════════════════════════════════════════════════════════════════

    // Vehicle Class (default economy to true for new users)
    const normalizedEligibility = {
      economy: eligEconomy ?? true,
      xl: eligXl ?? tierXl ?? uberXxl ?? uberTiers?.uberXXL ?? false,
      xxl: eligXxl ?? false,
      comfort: eligComfort ?? tierComfort ?? uberComfort ?? uberTiers?.uberComfort ?? false,
      luxurySedan: eligLuxurySedan ?? tierBlack ?? uberBlack ?? uberTiers?.uberBlack ?? false,
      luxurySuv: eligLuxurySuv ?? false,
    };

    // Vehicle Attributes
    const normalizedAttributes = {
      electric: attrElectric ?? false,
      green: attrGreen ?? false,
      wav: attrWav ?? false,
      ski: attrSki ?? false,
      carSeat: attrCarSeat ?? false,
    };

    // Service Preferences (unchecked = avoid these rides)
    const normalizedPreferences = {
      petFriendly: prefPetFriendly ?? false,
      teen: prefTeen ?? false,
      assist: prefAssist ?? false,
      shared: prefShared ?? tierShare ?? uberXShare ?? uberTiers?.uberXShare ?? false,
    };

    // Legacy tiers (for backward compatibility)
    const normalizedTiers = {
      black: tierBlack ?? uberBlack ?? uberTiers?.uberBlack ?? false,
      xl: tierXl ?? uberXxl ?? uberTiers?.uberXXL ?? false,
      comfort: tierComfort ?? uberComfort ?? uberTiers?.uberComfort ?? false,
      standard: tierStandard ?? uberX ?? uberTiers?.uberX ?? false,
      share: tierShare ?? uberXShare ?? uberTiers?.uberXShare ?? false
    };

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
    if (!normalizedVehicle?.year) missing.push('vehicleYear');
    if (!normalizedVehicle?.make) missing.push('vehicleMake');
    if (!normalizedVehicle?.model) missing.push('vehicleModel');
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
    authLog.phase(1, `Hashing password for: ${email} (input length: ${password?.length}, first char: ${password?.[0]}, last char: ${password?.[password.length-1]})`);
    const passwordHash = await hashPassword(password);
    authLog.phase(1, `Password hashed for: ${email} (hash length: ${passwordHash.length})`);

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

    // Look up market from platform_data based on city
    let resolvedMarket = market?.trim() || null;
    try {
      const [marketData] = await db
        .select({
          market_anchor: platform_data.market_anchor,
          region_type: platform_data.region_type,
        })
        .from(platform_data)
        .where(and(
          eq(platform_data.city, city.trim()),
          eq(platform_data.platform, 'uber')
        ))
        .limit(1);

      if (marketData?.market_anchor) {
        resolvedMarket = marketData.market_anchor;
        authLog.done(1, `Market resolved: ${resolvedMarket} (${marketData.region_type})`);
      } else {
        console.log(`[auth] No market found for city: ${city.trim()}, using provided: ${market}`);
      }
    } catch (marketErr) {
      console.warn('[auth] Market lookup failed (non-fatal):', marketErr.message);
    }

    // 2026-01-05: Simplified session architecture - users table is session-only
    // Location data lives in snapshots, not users. See SAVE-IMPORTANT.md
    const newUserId = crypto.randomUUID();
    const newSessionId = crypto.randomUUID();
    const newDeviceId = `web-${crypto.randomUUID().substring(0, 8)}`;
    const now = new Date();

    const [newUser] = await db.insert(users).values({
      user_id: newUserId,
      device_id: newDeviceId,
      session_id: newSessionId,
      current_snapshot_id: null, // Set when first snapshot created
      session_start_at: now,
      last_active_at: now,
      created_at: now,
      updated_at: now
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
      market: resolvedMarket, // Looked up from platform_data based on city
      driver_nickname: nickname?.trim() || firstName.trim(), // Custom greeting name, defaults to first name
      rideshare_platforms: ridesharePlatforms,

      // New eligibility fields
      elig_economy: normalizedEligibility.economy,
      elig_xl: normalizedEligibility.xl,
      elig_xxl: normalizedEligibility.xxl,
      elig_comfort: normalizedEligibility.comfort,
      elig_luxury_sedan: normalizedEligibility.luxurySedan,
      elig_luxury_suv: normalizedEligibility.luxurySuv,

      attr_electric: normalizedAttributes.electric,
      attr_green: normalizedAttributes.green,
      attr_wav: normalizedAttributes.wav,
      attr_ski: normalizedAttributes.ski,
      attr_car_seat: normalizedAttributes.carSeat,

      pref_pet_friendly: normalizedPreferences.petFriendly,
      pref_teen: normalizedPreferences.teen,
      pref_assist: normalizedPreferences.assist,
      pref_shared: normalizedPreferences.shared,

      // Legacy columns (backward compatibility)
      uber_black: normalizedTiers.black,
      uber_xxl: normalizedTiers.xl,
      uber_comfort: normalizedTiers.comfort,
      uber_x: normalizedTiers.standard,
      uber_x_share: normalizedTiers.share,

      marketing_opt_in: marketingOptIn,
      terms_accepted: true, // Boolean flag - must be true to complete registration
      terms_accepted_at: new Date(),
      terms_version: '1.0',
      profile_complete: true
    }).returning();

    // Create driver vehicle
    await db.insert(driver_vehicles).values({
      driver_profile_id: profile.id,
      year: normalizedVehicle.year,
      make: normalizedVehicle.make.trim(),
      model: normalizedVehicle.model.trim(),
      color: normalizedVehicle.color?.trim() || null,
      seatbelts: normalizedVehicle.seatbelts || 4,
      is_primary: true
    });

    // Create auth credentials
    const [createdCreds] = await db.insert(auth_credentials).values({
      user_id: newUser.user_id,
      password_hash: passwordHash
    }).returning();

    authLog.phase(1, `Auth credentials created for user: ${newUser.user_id.substring(0, 8)} (creds id: ${createdCreds?.id?.substring(0, 8) || 'none'})`);

    // Generate auth token
    const token = generateAuthToken(newUser.user_id, email);

    // Send welcome email (non-blocking)
    sendWelcomeEmail(email, firstName).catch(err => {
      console.warn('[auth] Welcome email failed:', err.message);
    });

    // Fetch the created vehicle
    const createdVehicle = await db.query.driver_vehicles.findFirst({
      where: and(
        eq(driver_vehicles.driver_profile_id, profile.id),
        eq(driver_vehicles.is_primary, true)
      )
    });

    authLog.done(1, `New driver registered: ${email}`);

    // Return same structure as GET /me for auth context compatibility
    res.status(201).json({
      ok: true,
      token,
      user: {
        userId: newUser.user_id,
        email: profile.email
      },
      profile: {
        id: profile.id,
        userId: profile.user_id,
        firstName: profile.first_name,
        lastName: profile.last_name,
        nickname: profile.driver_nickname || profile.first_name,
        email: profile.email,
        phone: profile.phone,
        address1: profile.address_1,
        address2: profile.address_2,
        city: profile.city,
        stateTerritory: profile.state_territory,
        zipCode: profile.zip_code,
        country: profile.country,
        market: profile.market,
        ridesharePlatforms: profile.rideshare_platforms || [],
        // Home location (from registration geocoding)
        homeLat: profile.home_lat,
        homeLng: profile.home_lng,
        homeTimezone: profile.home_timezone,
        homeFormattedAddress: profile.home_formatted_address,
        // New eligibility fields
        eligEconomy: profile.elig_economy ?? true,
        eligXl: profile.elig_xl || false,
        eligXxl: profile.elig_xxl || false,
        eligComfort: profile.elig_comfort || false,
        eligLuxurySedan: profile.elig_luxury_sedan || false,
        eligLuxurySuv: profile.elig_luxury_suv || false,
        attrElectric: profile.attr_electric || false,
        attrGreen: profile.attr_green || false,
        attrWav: profile.attr_wav || false,
        attrSki: profile.attr_ski || false,
        attrCarSeat: profile.attr_car_seat || false,
        prefPetFriendly: profile.pref_pet_friendly || false,
        prefTeen: profile.pref_teen || false,
        prefAssist: profile.pref_assist || false,
        prefShared: profile.pref_shared || false,
        marketingOptIn: profile.marketing_opt_in || false,
        termsAccepted: true, // Always true for new registrations
        emailVerified: false,
        phoneVerified: false,
        profileComplete: true,
        createdAt: profile.created_at
      },
      vehicle: createdVehicle ? {
        id: createdVehicle.id,
        driverProfileId: createdVehicle.driver_profile_id,
        year: createdVehicle.year,
        make: createdVehicle.make,
        model: createdVehicle.model,
        seatbelts: createdVehicle.seatbelts,
        isPrimary: createdVehicle.is_primary
      } : null
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
      authLog.warn(1, `No credentials found for user_id: ${profile.user_id.substring(0, 8)}`);
      return res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password'
      });
    }

    authLog.phase(1, `Found credentials for: ${email} (hash length: ${creds.password_hash?.length || 0})`);

    // Check if account is locked
    if (creds.locked_until && new Date(creds.locked_until) > new Date()) {
      return res.status(423).json({
        error: 'ACCOUNT_LOCKED',
        message: 'Account is temporarily locked. Try again later.',
        locked_until: creds.locked_until
      });
    }

    // Verify password
    authLog.phase(1, `Verifying password for: ${email} (input length: ${password?.length}, first char: ${password?.[0]}, last char: ${password?.[password.length-1]})`);
    const isValid = await verifyPassword(password, creds.password_hash);
    authLog.phase(1, `Password verification result: ${isValid}`);

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

    // 2026-01-05: Session Architecture - Create/reset users row on login
    // Highlander Rule: one session per user. Delete any existing row, insert fresh.
    // This handles multiple devices/tabs - new login supersedes old session.
    const newSessionId = crypto.randomUUID();
    const now = new Date();

    // Delete existing session (if any) - Highlander rule
    await db.delete(users).where(eq(users.user_id, profile.user_id));

    // Create fresh session row
    await db.insert(users).values({
      user_id: profile.user_id,
      device_id: `web-${crypto.randomUUID().substring(0, 8)}`,
      session_id: newSessionId,
      current_snapshot_id: null, // Set when first snapshot created
      session_start_at: now,
      last_active_at: now,
      created_at: now,
      updated_at: now
    });

    authLog.phase(1, `Session created for user: ${profile.user_id.substring(0, 8)} (session: ${newSessionId.substring(0, 8)})`);

    // Generate token
    const token = generateAuthToken(profile.user_id, email);

    // Fetch vehicle
    const vehicle = await db.query.driver_vehicles.findFirst({
      where: and(
        eq(driver_vehicles.driver_profile_id, profile.id),
        eq(driver_vehicles.is_primary, true)
      )
    });

    authLog.done(1, `Driver logged in: ${email}`);

    // Return same structure as GET /me for auth context compatibility
    res.json({
      ok: true,
      token,
      user: {
        userId: profile.user_id,
        email: profile.email
      },
      profile: {
        id: profile.id,
        userId: profile.user_id,
        firstName: profile.first_name,
        lastName: profile.last_name,
        nickname: profile.driver_nickname || profile.first_name,
        email: profile.email,
        phone: profile.phone,
        address1: profile.address_1,
        address2: profile.address_2,
        city: profile.city,
        stateTerritory: profile.state_territory,
        zipCode: profile.zip_code,
        country: profile.country,
        market: profile.market,
        ridesharePlatforms: profile.rideshare_platforms || [],
        // Home location (from registration geocoding)
        homeLat: profile.home_lat,
        homeLng: profile.home_lng,
        homeTimezone: profile.home_timezone,
        homeFormattedAddress: profile.home_formatted_address,
        // New eligibility fields
        eligEconomy: profile.elig_economy ?? true,
        eligXl: profile.elig_xl || false,
        eligXxl: profile.elig_xxl || false,
        eligComfort: profile.elig_comfort || false,
        eligLuxurySedan: profile.elig_luxury_sedan || false,
        eligLuxurySuv: profile.elig_luxury_suv || false,
        attrElectric: profile.attr_electric || false,
        attrGreen: profile.attr_green || false,
        attrWav: profile.attr_wav || false,
        attrSki: profile.attr_ski || false,
        attrCarSeat: profile.attr_car_seat || false,
        prefPetFriendly: profile.pref_pet_friendly || false,
        prefTeen: profile.pref_teen || false,
        prefAssist: profile.pref_assist || false,
        prefShared: profile.pref_shared || false,
        marketingOptIn: profile.marketing_opt_in || false,
        termsAccepted: profile.terms_accepted || false,
        emailVerified: profile.email_verified || false,
        phoneVerified: profile.phone_verified || false,
        profileComplete: profile.profile_complete || false,
        createdAt: profile.created_at
      },
      vehicle: vehicle ? {
        id: vehicle.id,
        driverProfileId: vehicle.driver_profile_id,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        seatbelts: vehicle.seatbelts,
        isPrimary: vehicle.is_primary
      } : null
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

    // Return structured response matching AuthApiResponse interface
    res.json({
      user: {
        userId: profile.user_id,
        email: profile.email
      },
      profile: {
        id: profile.id,
        userId: profile.user_id,
        firstName: profile.first_name,
        lastName: profile.last_name,
        nickname: profile.driver_nickname || profile.first_name, // Fallback to first name
        email: profile.email,
        phone: profile.phone,
        address1: profile.address_1,
        address2: profile.address_2,
        city: profile.city,
        stateTerritory: profile.state_territory,
        zipCode: profile.zip_code,
        country: profile.country,
        market: profile.market,
        ridesharePlatforms: profile.rideshare_platforms || [],

        // Home location (from registration geocoding)
        homeLat: profile.home_lat,
        homeLng: profile.home_lng,
        homeTimezone: profile.home_timezone,
        homeFormattedAddress: profile.home_formatted_address,

        // New eligibility fields
        eligEconomy: profile.elig_economy ?? true,
        eligXl: profile.elig_xl || false,
        eligXxl: profile.elig_xxl || false,
        eligComfort: profile.elig_comfort || false,
        eligLuxurySedan: profile.elig_luxury_sedan || false,
        eligLuxurySuv: profile.elig_luxury_suv || false,

        attrElectric: profile.attr_electric || false,
        attrGreen: profile.attr_green || false,
        attrWav: profile.attr_wav || false,
        attrSki: profile.attr_ski || false,
        attrCarSeat: profile.attr_car_seat || false,

        prefPetFriendly: profile.pref_pet_friendly || false,
        prefTeen: profile.pref_teen || false,
        prefAssist: profile.pref_assist || false,
        prefShared: profile.pref_shared || false,
        marketingOptIn: profile.marketing_opt_in || false,
        termsAccepted: profile.terms_accepted || false,

        // Legacy fields (backward compatibility)
        tierBlack: profile.uber_black || false,
        tierXl: profile.uber_xxl || false,
        tierComfort: profile.uber_comfort || false,
        tierStandard: profile.uber_x || false,
        tierShare: profile.uber_x_share || false,
        uberBlack: profile.uber_black || false,
        uberXxl: profile.uber_xxl || false,
        uberComfort: profile.uber_comfort || false,
        uberX: profile.uber_x || false,
        uberXShare: profile.uber_x_share || false,

        emailVerified: profile.email_verified || false,
        phoneVerified: profile.phone_verified || false,
        profileComplete: profile.profile_complete || false,
        createdAt: profile.created_at
      },
      vehicle: vehicle ? {
        id: vehicle.id,
        driverProfileId: vehicle.driver_profile_id,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        seatbelts: vehicle.seatbelts,
        isPrimary: vehicle.is_primary
      } : null
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

    // Personal info (note: firstName/lastName intentionally not editable via profile update)
    if (updates.nickname !== undefined) profileUpdates.driver_nickname = updates.nickname?.trim() || null;
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

    // ═══════════════════════════════════════════════════════════════════════
    // Handle new eligibility fields
    // ═══════════════════════════════════════════════════════════════════════

    // Vehicle Class
    if (updates.eligEconomy !== undefined) profileUpdates.elig_economy = updates.eligEconomy;
    if (updates.eligXl !== undefined) profileUpdates.elig_xl = updates.eligXl;
    if (updates.eligXxl !== undefined) profileUpdates.elig_xxl = updates.eligXxl;
    if (updates.eligComfort !== undefined) profileUpdates.elig_comfort = updates.eligComfort;
    if (updates.eligLuxurySedan !== undefined) profileUpdates.elig_luxury_sedan = updates.eligLuxurySedan;
    if (updates.eligLuxurySuv !== undefined) profileUpdates.elig_luxury_suv = updates.eligLuxurySuv;

    // Vehicle Attributes
    if (updates.attrElectric !== undefined) profileUpdates.attr_electric = updates.attrElectric;
    if (updates.attrGreen !== undefined) profileUpdates.attr_green = updates.attrGreen;
    if (updates.attrWav !== undefined) profileUpdates.attr_wav = updates.attrWav;
    if (updates.attrSki !== undefined) profileUpdates.attr_ski = updates.attrSki;
    if (updates.attrCarSeat !== undefined) profileUpdates.attr_car_seat = updates.attrCarSeat;

    // Service Preferences
    if (updates.prefPetFriendly !== undefined) profileUpdates.pref_pet_friendly = updates.prefPetFriendly;
    if (updates.prefTeen !== undefined) profileUpdates.pref_teen = updates.prefTeen;
    if (updates.prefAssist !== undefined) profileUpdates.pref_assist = updates.prefAssist;
    if (updates.prefShared !== undefined) profileUpdates.pref_shared = updates.prefShared;

    // Legacy tier fields (backward compatibility)
    if (updates.tierBlack !== undefined) profileUpdates.uber_black = updates.tierBlack;
    if (updates.tierXl !== undefined) profileUpdates.uber_xxl = updates.tierXl;
    if (updates.tierComfort !== undefined) profileUpdates.uber_comfort = updates.tierComfort;
    if (updates.tierStandard !== undefined) profileUpdates.uber_x = updates.tierStandard;
    if (updates.tierShare !== undefined) profileUpdates.uber_x_share = updates.tierShare;

    // Legacy nested uberTiers format (backward compatibility)
    if (updates.uberTiers) {
      if (updates.uberTiers.uberBlack !== undefined) profileUpdates.uber_black = updates.uberTiers.uberBlack;
      if (updates.uberTiers.uberXXL !== undefined) profileUpdates.uber_xxl = updates.uberTiers.uberXXL;
      if (updates.uberTiers.uberComfort !== undefined) profileUpdates.uber_comfort = updates.uberTiers.uberComfort;
      if (updates.uberTiers.uberX !== undefined) profileUpdates.uber_x = updates.uberTiers.uberX;
      if (updates.uberTiers.uberXShare !== undefined) profileUpdates.uber_x_share = updates.uberTiers.uberXShare;
    }
    if (updates.marketingOptIn !== undefined) profileUpdates.marketing_opt_in = updates.marketingOptIn;
    if (updates.country) profileUpdates.country = updates.country.trim();

    profileUpdates.updated_at = new Date();

    // Check if any address fields changed - if so, re-geocode
    const addressFieldsChanged =
      updates.address1 || updates.address2 !== undefined ||
      updates.city || updates.stateTerritory ||
      updates.zipCode !== undefined || updates.country;

    if (addressFieldsChanged) {
      // Build complete address from updates + existing profile data
      const addressToGeocode = {
        address1: (updates.address1?.trim() || profile.address_1),
        address2: (updates.address2 !== undefined ? updates.address2?.trim() : profile.address_2) || undefined,
        city: (updates.city?.trim() || profile.city),
        stateTerritory: (updates.stateTerritory?.trim() || profile.state_territory),
        zipCode: (updates.zipCode !== undefined ? updates.zipCode?.trim() : profile.zip_code) || undefined,
        country: (updates.country?.trim() || profile.country)
      };

      // Geocode address (non-blocking - don't fail update if geocoding fails)
      try {
        const geocodeResult = await geocodeAddress(addressToGeocode);
        if (geocodeResult) {
          profileUpdates.home_lat = geocodeResult.lat;
          profileUpdates.home_lng = geocodeResult.lng;
          profileUpdates.home_formatted_address = geocodeResult.formattedAddress;
          profileUpdates.home_timezone = geocodeResult.timezone;
          authLog.done(1, `Re-geocoded address: ${geocodeResult.formattedAddress}`);
        }
      } catch (geoErr) {
        // Non-fatal - log and continue with profile update
        console.warn('[auth] Re-geocoding failed (non-fatal):', geoErr.message);
      }

      // Re-lookup market based on new city
      const newCity = updates.city?.trim() || profile.city;
      try {
        const [marketData] = await db
          .select({
            market_anchor: platform_data.market_anchor,
            region_type: platform_data.region_type,
          })
          .from(platform_data)
          .where(and(
            eq(platform_data.city, newCity),
            eq(platform_data.platform, 'uber')
          ))
          .limit(1);

        if (marketData?.market_anchor) {
          profileUpdates.market = marketData.market_anchor;
          authLog.done(1, `Market updated: ${marketData.market_anchor} (${marketData.region_type})`);
        }
      } catch (marketErr) {
        console.warn('[auth] Market re-lookup failed (non-fatal):', marketErr.message);
      }
    }

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
// POST /api/auth/logout - Logout (deletes session row)
// ═══════════════════════════════════════════════════════════════════════════
router.post('/logout', requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;

    // 2026-01-05: Session Architecture - Delete users row on logout
    // This immediately invalidates the session. User must re-login.
    await db.delete(users).where(eq(users.user_id, userId));

    authLog.done(1, `User logged out, session deleted: ${userId.substring(0, 8)}`);
    res.json({ ok: true, message: 'Logged out successfully' });
  } catch (err) {
    authLog.error(1, `Logout failed`, err);
    res.status(500).json({ error: 'LOGOUT_FAILED', message: err.message });
  }
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
