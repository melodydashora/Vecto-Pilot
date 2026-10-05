// server/api/auth/auth.js
// Complete authentication API routes

import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../../db/drizzle.js';
import { eq, and, gt, isNull } from 'drizzle-orm';
import {
  users,
  driver_profiles,
  driver_vehicles,
  auth_credentials,
  verification_codes,
  platform_data,
  oauth_states
} from '../../../shared/schema.js';
import {
  getGoogleAuthUrl,
  exchangeGoogleCode,
  verifyGoogleIdToken,
  generateState
} from '../../lib/auth/oauth/google-oauth.js';
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
import { isUniqueViolation, resolveGoogleIdentity } from '../../lib/auth/identity-policy.js';
import { ActiveDriverSessionError, createDriverSession } from '../../lib/auth/driver-session.js';
import { LoginAttemptError, validRecoveryProof, beginLoginAttempt, withLoginAttempt,
  completeLoginAttempt, failLoginAttempt, recoverLoginAttempt, cancelLoginAttempt } from '../../lib/auth/login-recovery.js';
import { ensureMarket } from '../../lib/markets/ensure-market.js';
import { matrixLog } from '../../logger/workflow.js';
import { geocodeAddress } from '../../lib/location/geocode.js';
import { validateAddress } from '../../lib/location/address-validation.js';
import { normalizeCoordinates } from '../../../shared/coordinates.js';
import { signJWT } from '../../lib/jwt.js';
import { parseEconomicPreferenceUpdates } from '../../lib/driver-preferences.js';
import { invalidateUser } from '../../lib/offers/ruleset-store.js';
import { driverProfileResponse } from '../../lib/driver-profile-response.js';
import { withDriverSettingsLock, MainRunAdmissionError, validSettingsRevision, validateSelectedServices } from '../../lib/main-run-admission.js';

const router = Router();

// 2026-03-17: SECURITY FIX (F-10) — No hardcoded fallback secret.
// REPLIT_DEVSERVER_INTERNAL_ID is per-workspace (not predictable), acceptable for dev.
// 2026-05-03: AUTH-003 — JWT signing/verification moved to server/lib/jwt.js.
// This block is the startup-time fail-fast check; runtime uses signJWT/verifyJWT.
if (!process.env.JWT_SECRET && !process.env.REPLIT_DEVSERVER_INTERNAL_ID) {
  matrixLog.error({
    category: 'AUTH',
    action: 'BOOT_FAIL',
    location: 'auth.js:module',
  }, 'JWT_SECRET (or REPLIT_DEVSERVER_INTERNAL_ID dev fallback) missing — JWT signing will fail');
}

/**
 * Generate an auth token (JWT, HS256) for a user.
 * Format: standard 3-segment JWT with claims sub/iat/exp/iss/aud (see server/lib/jwt.js).
 * Legacy 2-segment HMAC tokens (userId.signature) issued before AUTH-003 are still
 * verified during the transition window via middleware/auth.js dual-verify dispatch.
 * @param {string} userId - User UUID
 * @param {string} _email - User email (no longer used; kept for call-site signature stability)
 * @returns {Promise<string>} JWT
 */
// 2026-09-10 (security finding [9]): sessionId binds the token to the users.session_id
// created for this login; see signJWT/requireAuth.
async function generateAuthToken(userId, _email = '', sessionId = null, issuedAt = null) {
  const token = await signJWT({ sub: userId, sid: sessionId, ...(issuedAt && { issuedAt }) });
  matrixLog.info({
    category: 'AUTH',
    action: 'TOKEN_ISSUE',
    location: 'auth.js:generateAuthToken',
  }, `JWT issued for ${userId.substring(0, 8)}`);
  return token;
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
      // 2026-09-10 (Astra product finding #16): "Other" market declared at signup —
      // { market_name, state, state_abbr } — created HERE after the account exists, instead of
      // the client calling the authenticated /api/intelligence/add-market before registering.
      customMarket = null,
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
    // 2026-01-09: Removed password character logging (security)
    matrixLog.info({
      category: 'AUTH',
      action: 'PASSWORD_HASH',
      location: 'auth.js:register',
    }, 'Hashing password');
    const passwordHash = await hashPassword(password);
    matrixLog.info({
      category: 'AUTH',
      action: 'PASSWORD_HASH_COMPLETE',
      location: 'auth.js:register',
    }, 'Password hashed');

    // 2026-01-05: Validate address using Google Address Validation API
    // This provides better accuracy than geocoding alone:
    // - Verifies the address exists
    // - Corrects typos and standardizes formatting
    // - Returns precise coordinates (often ROOFTOP level)
    let addressValidation = null;
    let geocodeResult = null;
    let finalAddress = {
      address1: address1.trim(),
      address2: address2?.trim() || null,
      city: city.trim(),
      state: stateTerritory.trim(),
      zipCode: zipCode?.trim() || null,
      country: country.trim(),
    };

    try {
      addressValidation = await validateAddress({
        address1: address1.trim(),
        address2: address2?.trim(),
        city: city.trim(),
        state: stateTerritory.trim(),
        zipCode: zipCode?.trim(),
        country: country.trim(),
      });

      if (addressValidation && !addressValidation.skipped) {
        matrixLog.info({
          category: 'AUTH',
          action: 'ADDRESS_VALIDATE',
          location: 'auth.js:register',
        }, `Address validation: ${addressValidation.validationStatus}`);

        // Use corrected address if available
        if (addressValidation.valid && addressValidation.validationStatus === 'CONFIRMED' && addressValidation.corrected?.address1) {
          finalAddress = {
            address1: addressValidation.corrected.address1,
            address2: addressValidation.corrected.address2 || null,
            city: addressValidation.corrected.city,
            state: addressValidation.corrected.state,
            zipCode: addressValidation.corrected.zipCode,
            country: addressValidation.corrected.country,
          };
          matrixLog.info({
            category: 'AUTH',
            action: 'ADDRESS_STANDARDIZED',
            location: 'auth.js:register',
          }, 'Address standardized (value redacted)');
        }

        // Use validation coordinates if available (often more precise than geocoding)
        const validatedCoordinates = addressValidation.valid && addressValidation.validationStatus === 'CONFIRMED'
          ? normalizeCoordinates(addressValidation.lat, addressValidation.lng) : null;
        if (validatedCoordinates) {
          geocodeResult = {
            ...validatedCoordinates,
            formattedAddress: addressValidation.formattedAddress,
            // Note: Address Validation doesn't return timezone, will get from geocode if needed
          };
          matrixLog.info({
            category: 'AUTH',
            action: 'GEOCODE_FROM_VALIDATION',
            location: 'auth.js:register',
          }, `Coords obtained from validation (precision: ${addressValidation.geocodePrecision || 'unknown'})`);
        }

        // Log warnings if any
        if (addressValidation.warnings?.length > 0) {
          matrixLog.warn({
            category: 'AUTH',
            action: 'ADDRESS_VALIDATE_WARN',
            location: 'auth.js:register',
          }, `Address validation warnings (count: ${(addressValidation.warnings || []).length})`);
        }
      }
    } catch (validationErr) {
      matrixLog.warn({
        category: 'AUTH',
        action: 'ADDRESS_VALIDATE_FAIL',
        location: 'auth.js:register',
      }, `Address validation failed (non-fatal): ${validationErr.message}`);
    }

    // Fallback to geocoding if validation didn't provide coordinates
    if (!geocodeResult) {
      try {
        geocodeResult = await geocodeAddress({
          address1: finalAddress.address1,
          address2: finalAddress.address2,
          city: finalAddress.city,
          stateTerritory: finalAddress.state,
          zipCode: finalAddress.zipCode,
          country: finalAddress.country
        });
        const coordinates = normalizeCoordinates(geocodeResult?.lat, geocodeResult?.lng);
        geocodeResult = coordinates ? { ...geocodeResult, ...coordinates } : null;
        if (geocodeResult) {
          matrixLog.info({
            category: 'AUTH',
            action: 'GEOCODE_FALLBACK',
            location: 'auth.js:register',
          }, 'Address geocoded (fallback)');
        }
      } catch (geoErr) {
        matrixLog.warn({
          category: 'AUTH',
          action: 'GEOCODE_FAIL',
          location: 'auth.js:register',
        }, `Geocoding failed (non-fatal): ${geoErr.message}`);
      }
    }

    // Look up market from platform_data based on validated city
    let resolvedMarket = market?.trim() || null;
    try {
      const [marketData] = await db
        .select({
          market_anchor: platform_data.market_anchor,
          region_type: platform_data.region_type,
        })
        .from(platform_data)
        .where(and(
          eq(platform_data.city, finalAddress.city),
          eq(platform_data.platform, 'uber')
        ))
        .limit(1);

      if (!resolvedMarket && marketData?.market_anchor) {
        resolvedMarket = marketData.market_anchor;
        matrixLog.info({
          category: 'AUTH',
          action: 'MARKET_RESOLVE',
          location: 'auth.js:register',
        }, `Market resolved: ${resolvedMarket} (${marketData.region_type})`);
      } else {
        matrixLog.info({
          category: 'AUTH',
          action: 'MARKET_NOT_FOUND',
          location: 'auth.js:register',
        }, `No market found for provided city; using fallback: ${market}`);
      }
    } catch (marketErr) {
      matrixLog.warn({
        category: 'AUTH',
        action: 'MARKET_LOOKUP_FAIL',
        location: 'auth.js:register',
      }, `Market lookup failed (non-fatal): ${marketErr.message}`);
    }

    // 2026-01-05: Simplified session architecture - users table is session-only
    // Location data lives in snapshots, not users. See SAVE-IMPORTANT.md
    const newUserId = crypto.randomUUID();
    const newSessionId = crypto.randomUUID();
    const now = new Date();

    // 2026-09-10 (VP-003 / Astra A3a, verified + skeptic-confirmed): the four account rows
    // are written in ONE transaction. Before this, a failure after the users insert left
    // an orphan users row (one exists in the dev DB today), and a profile without
    // credentials could neither log in nor reset — while a retry hit EMAIL_EXISTS.
    // Hashing, address validation, geocoding and the market lookup stay outside the
    // transaction on purpose (external calls; no DB writes).
    const { newUser, profile, createdCreds } = await db.transaction(async (tx) => {
      const [newUser] = await tx.insert(users).values({
        user_id: newUserId,
        // Signup returns to sign-in. It must not occupy the driver's only session.
        session_id: null,
        current_snapshot_id: null, // Set when first snapshot created
        session_start_at: now,
        last_active_at: now,
        created_at: now,
        updated_at: now
      }).returning();

      // Create driver profile with validated/geocoded home coordinates
      // 2026-01-05: Using finalAddress from Address Validation API (corrected/standardized)
      const [profile] = await tx.insert(driver_profiles).values({
        user_id: newUser.user_id,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.toLowerCase().trim(),
        phone: phoneCheck.formatted,
        // Use validated/standardized address (or original if validation skipped)
        address_1: finalAddress.address1,
        address_2: finalAddress.address2,
        city: finalAddress.city,
        state_territory: finalAddress.state,
        zip_code: finalAddress.zipCode,
        country: finalAddress.country,
        // Store geocoded home coordinates (from validation or geocoding fallback)
        home_lat: geocodeResult?.lat ?? null,
        home_lng: geocodeResult?.lng ?? null,
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
      await tx.insert(driver_vehicles).values({
        driver_profile_id: profile.id,
        year: normalizedVehicle.year,
        make: normalizedVehicle.make.trim(),
        model: normalizedVehicle.model.trim(),
        color: normalizedVehicle.color?.trim() || null,
        seatbelts: normalizedVehicle.seatbelts || 4,
        is_primary: true
      });

      // Create auth credentials
      const [createdCreds] = await tx.insert(auth_credentials).values({
        user_id: newUser.user_id,
        password_hash: passwordHash
      }).returning();
      return { newUser, profile, createdCreds };
    });

    matrixLog.info({
      category: 'AUTH',
      connection: 'DB',
      action: 'CREDENTIALS_CREATED',
      tableName: 'AUTH_CREDENTIALS',
      location: 'auth.js:register',
    }, `Auth credentials created for user ${newUser.user_id.substring(0, 8)} (creds id: ${createdCreds?.id?.substring(0, 8) || 'none'})`);

    // Driver-declared market (optional): the market row is optional data for the profile, so a
    // failure here is logged and reported, never a failed registration.
    let customMarketResult = null;
    if (customMarket && typeof customMarket === 'object') {
      try {
        customMarketResult = await ensureMarket({
          market_name: customMarket.market_name,
          city: finalAddress.city,
          state: customMarket.state || finalAddress.state,
          state_abbr: customMarket.state_abbr,
          country_code: finalAddress.country || 'US',
          lat: geocodeResult?.lat,
          lng: geocodeResult?.lng,
          source_ref: 'user_signup',
        });
        matrixLog.info({ category: 'AUTH', action: 'MARKET_DECLARED', location: 'auth.js:register' },
          `Custom market ${customMarketResult.already_existed ? 'already existed' : 'created'}: ${customMarketResult.market_slug}`);
      } catch (marketErr) {
        matrixLog.warn({ category: 'AUTH', action: 'MARKET_DECLARE_FAIL', location: 'auth.js:register' },
          `Custom market not created (${marketErr.code || 'error'}): ${marketErr.message}`);
        customMarketResult = { already_existed: false, market_name: null, market_slug: null, error: marketErr.code || 'error' };
      }
    }

    // Preserve the response token shape, bound to an unused UUID. It cannot
    // authorize this account now or attach to the session created at sign-in.
    const token = await generateAuthToken(newUser.user_id, email, newSessionId);

    // Send welcome email (non-blocking)
    sendWelcomeEmail(email, firstName).catch(err => {
      matrixLog.warn({
        category: 'AUTH',
        action: 'EMAIL_SEND_FAIL',
        location: 'auth.js:register',
      }, `Welcome email failed: ${err.message}`);
    });

    // Fetch the created vehicle
    const createdVehicle = await db.query.driver_vehicles.findFirst({
      where: and(
        eq(driver_vehicles.driver_profile_id, profile.id),
        eq(driver_vehicles.is_primary, true),
        eq(driver_vehicles.is_active, true)
      )
    });

    matrixLog.info({
      category: 'AUTH',
      action: 'REGISTER_COMPLETE',
      location: 'auth.js:register',
    }, `New driver registered (user ${newUser.user_id.substring(0, 8)})`);

    // Return same structure as GET /me for auth context compatibility
    res.status(201).json({
      ok: true,
      token,
      customMarket: customMarketResult, // 2026-09-10: null unless the body declared one
      ...driverProfileResponse(profile, createdVehicle, null)
    });

  } catch (err) {
    matrixLog.error({
      category: 'AUTH',
      action: 'REGISTER_FAIL',
      location: 'auth.js:register',
    }, 'Registration failed', err);
    // 2026-09-10 (VP-003 / Astra A3b, verified): the loser of a same-email race hits the
    // unique index (SQLSTATE 23505) — that is EMAIL_EXISTS, not a server fault. Raw
    // err.message (constraint names, SQL fragments) never leaves the process.
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'EMAIL_EXISTS', message: 'An account with this email already exists' });
    }
    res.status(500).json({ error: 'REGISTRATION_FAILED', message: 'Registration failed. Please try again.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/auth/login - Authenticate driver
// ═══════════════════════════════════════════════════════════════════════════
router.post('/login', async (req, res) => {
  let recoveryAttempt = null;
  try {
    const { email, password } = req.body;

    if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
      return res.status(400).json({
        error: 'MISSING_CREDENTIALS',
        message: 'Email and password are required'
      });
    }
    res.set?.('Cache-Control', 'no-store');
    if (req.body.recoveryProof !== undefined) {
      const claim = await beginLoginAttempt(db, req.body.recoveryProof, 'password');
      if (!claim.claimed) {
        const recovered = await recoverLoginAttempt(db, req.body.recoveryProof);
        return res.status(recovered.status).json(recovered.body);
      }
      recoveryAttempt = claim.attempt;
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
      matrixLog.warn({
        category: 'AUTH',
        connection: 'DB',
        action: 'CREDENTIALS_NOT_FOUND',
        tableName: 'AUTH_CREDENTIALS',
        location: 'auth.js:login',
      }, `No credentials found for user ${profile.user_id.substring(0, 8)}`);
      return res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password'
      });
    }

    matrixLog.info({
      category: 'AUTH',
      connection: 'DB',
      action: 'CREDENTIALS_LOOKUP',
      tableName: 'AUTH_CREDENTIALS',
      location: 'auth.js:login',
    }, `Credentials found for user ${profile.user_id.substring(0, 8)} (hash length: ${creds.password_hash?.length || 0})`);

    // 2026-02-13: OAuth-only users have null password_hash — cannot log in with password
    if (!creds.password_hash) {
      matrixLog.warn({
        category: 'AUTH',
        action: 'OAUTH_ONLY_ATTEMPT',
        location: 'auth.js:login',
      }, `OAuth-only account attempted password login (user ${profile.user_id.substring(0, 8)})`);
      return res.status(401).json({
        error: 'OAUTH_ONLY',
        message: 'This account uses Google Sign-In. Please use the Google button to log in.'
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
    // 2026-01-09: Removed password character logging (security)
    matrixLog.info({
      category: 'AUTH',
      action: 'PASSWORD_VERIFY',
      location: 'auth.js:login',
    }, `Verifying password for user ${profile.user_id.substring(0, 8)}`);
    const isValid = await verifyPassword(password, creds.password_hash);
    matrixLog.info({
      category: 'AUTH',
      action: 'PASSWORD_VERIFY_RESULT',
      location: 'auth.js:login',
    }, `Password verification: ${isValid ? 'success' : 'failed'}`);

    const newSessionId = crypto.randomUUID();
    const login = await withLoginAttempt(db, recoveryAttempt, async tx => {
      const [current] = await tx.select().from(auth_credentials)
        .where(eq(auth_credentials.user_id, profile.user_id)).for('update').limit(1);
      // Verification may finish after a reset or OAuth password revocation.
      // Authorize against the credential still stored under the row lock.
      if (!current || current.password_hash !== creds.password_hash) return { invalid: true };
      const now = new Date();
      if (current.locked_until && new Date(current.locked_until) > now) return { lockedUntil: current.locked_until };
      if (!isValid) {
        const attempts = (current.failed_login_attempts || 0) + 1;
        await tx.update(auth_credentials).set({ failed_login_attempts: attempts,
          locked_until: attempts >= 5 ? new Date(now.getTime() + 15 * 60 * 1000) : null,
          updated_at: now }).where(eq(auth_credentials.user_id, profile.user_id));
        return { invalid: true };
      }
      await tx.update(auth_credentials).set({ failed_login_attempts: 0, locked_until: null,
        last_login_at: now, last_login_ip: req.ip || req.headers['x-forwarded-for'] || 'unknown', updated_at: now })
        .where(eq(auth_credentials.user_id, profile.user_id));
      const created = await createDriverSession(tx, profile.user_id, newSessionId);
      // Local signing failure must not leave a session the driver cannot use
      // or log out of. The token is returned only after the transaction commits.
      const token = await generateAuthToken(profile.user_id, email, newSessionId, created.sessionStartedAt);
      await completeLoginAttempt(tx, recoveryAttempt, { userId: profile.user_id, sessionId: newSessionId });
      return { ...created, token };
    });
    if (login.lockedUntil) return res.status(423).json({ error: 'ACCOUNT_LOCKED',
      message: 'Account is temporarily locked. Try again later.', locked_until: login.lockedUntil });
    if (login.invalid) return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });

    matrixLog.info({
      category: 'AUTH',
      connection: 'DB',
      action: 'SESSION_CREATE',
      tableName: 'USERS',
      location: 'auth.js:login',
    }, `Session created for user ${profile.user_id.substring(0, 8)} (session ${newSessionId.substring(0, 8)})`);

    matrixLog.info({
      category: 'AUTH',
      action: 'LOGIN_SUCCESS',
      location: 'auth.js:login',
    }, `Driver logged in (user ${profile.user_id.substring(0, 8)})`);

    // Return same structure as GET /me for auth context compatibility
    res.json({
      ok: true,
      token: login.token,
      ...driverProfileResponse(login.profile, login.vehicle, newSessionId)
    });

  } catch (err) {
    if (err instanceof LoginAttemptError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    if (err instanceof ActiveDriverSessionError) {
      return res.status(409).json({ error: err.code, message: err.message });
    }
    matrixLog.error({
      category: 'AUTH',
      action: 'LOGIN_FAIL_INTERNAL',
      location: 'auth.js:login',
    }, 'Login failed', err);
    res.status(500).json({ error: 'LOGIN_FAILED', message: err.message });
  } finally {
    try { await failLoginAttempt(db, recoveryAttempt); }
    catch { matrixLog.warn({ category: 'AUTH', action: 'LOGIN_ATTEMPT_STATUS_FAIL', location: 'auth.js:login' }, 'Sign-in attempt status could not be recorded'); }
  }
});

// These endpoints authenticate only the unpredictable attempt proof. They never
// run requireAuth (which updates activity), accept cookies, or replace sessions.
for (const [path, action] of [['/login/recovery', recoverLoginAttempt], ['/login/recovery/cancel', cancelLoginAttempt]]) {
  router.post(path, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!validRecoveryProof(req.body?.recoveryProof)) {
      return res.status(400).json({ error: 'invalid_recovery_proof', message: 'A valid sign-in recovery proof is required.' });
    }
    try {
      const result = await action(db, req.body.recoveryProof);
      return res.status(result.status).json(result.body);
    } catch {
      return res.status(503).json({ error: 'login_recovery_unavailable', message: 'Could not check this sign-in. Try again when your connection is ready.' });
    }
  });
}

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
      matrixLog.warn({
        category: 'AUTH',
        action: 'RESET_REQUEST_NO_USER',
        location: 'auth.js:forgotPassword',
      }, 'Password reset requested for non-existent account');
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

      matrixLog.info({
        category: 'AUTH',
        action: 'RESET_SMS_SENT',
        location: 'auth.js:forgotPassword',
      }, `Password reset SMS sent (user ${profile.user_id.substring(0, 8)})`);

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

      matrixLog.info({
        category: 'AUTH',
        action: 'RESET_EMAIL_SENT',
        location: 'auth.js:forgotPassword',
      }, `Password reset email sent (user ${profile.user_id.substring(0, 8)})`);
    }

    res.json({
      ok: true,
      method,
      message: method === 'sms'
        ? 'A verification code has been sent to your phone.'
        : 'If an account exists with this email, you will receive reset instructions.'
    });

  } catch (err) {
    matrixLog.error({
      category: 'AUTH',
      action: 'RESET_REQUEST_FAIL',
      location: 'auth.js:forgotPassword',
    }, 'Forgot password failed', err);
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
    let usedCodeId = null;

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

      // 2026-09-13: the code is consumed inside the reset transaction below (conditional
      // UPDATE … RETURNING), not here — two concurrent requests could both pass this read.
      usedCodeId = verificationCode.id;

      userId = profile.user_id;

    } else {
      return res.status(400).json({
        error: 'MISSING_CREDENTIALS',
        message: 'Either token or (code + email) is required'
      });
    }

    // Hash new password
    const passwordHash = await hashPassword(newPassword);

    // 2026-09-13: Recheck and consume the reset credential in the same transaction as the
    // password change and session revocation. The preliminary reads above can race with
    // another request; only a conditional UPDATE may authorize the reset.
    // 2026-09-10 (security finding [9], verified): a password reset left the existing session
    // (and any token issued for it) valid for up to 2 h — the users UPDATE below revokes it.
    const resetApplied = await db.transaction(async (tx) => {
      const now = new Date();
      if (usedCodeId) {
        const [claimedCode] = await tx.update(verification_codes)
          .set({ used_at: now })
          .where(and(
            eq(verification_codes.id, usedCodeId),
            eq(verification_codes.user_id, userId),
            eq(verification_codes.code, code),
            eq(verification_codes.code_type, 'password_reset_sms'),
            gt(verification_codes.expires_at, now),
            isNull(verification_codes.used_at)
          ))
          .returning({ id: verification_codes.id });
        if (!claimedCode) return false;
      }

      const [changedCredentials] = await tx.update(auth_credentials)
        .set({
          password_hash: passwordHash,
          password_reset_token: null,
          password_reset_expires: null,
          password_changed_at: new Date(),
          failed_login_attempts: 0,
          locked_until: null,
          updated_at: new Date()
        })
        .where(and(
          eq(auth_credentials.user_id, userId),
          token ? eq(auth_credentials.password_reset_token, token) : undefined,
          token ? gt(auth_credentials.password_reset_expires, now) : undefined
        ))
        .returning({ user_id: auth_credentials.user_id });
      if (!changedCredentials) {
        if (token) return false;
        // Roll back the SMS claim too if its account is no longer available.
        throw new Error('Password reset account unavailable');
      }
      await tx.update(users)
        .set({ session_id: null, current_snapshot_id: null, current_main_run_id: null, updated_at: new Date() })
        .where(eq(users.user_id, userId));
      return true;
    });

    if (!resetApplied) {
      return res.status(400).json({
        error: token ? 'INVALID_TOKEN' : 'INVALID_CODE',
        message: token ? 'Invalid or expired reset token' : 'Invalid or expired verification code'
      });
    }

    matrixLog.info({
      category: 'AUTH',
      action: 'RESET_COMPLETE',
      location: 'auth.js:resetPassword',
    }, `Password reset successful for user ${userId.substring(0, 8)}`);

    res.json({
      ok: true,
      message: 'Password has been reset successfully. You can now log in.'
    });

  } catch (err) {
    matrixLog.error({
      category: 'AUTH',
      action: 'RESET_FAIL',
      location: 'auth.js:resetPassword',
    }, 'Password reset failed', err);
    res.status(500).json({ error: 'RESET_PASSWORD_FAILED', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/auth/me - Get current user profile
// ═══════════════════════════════════════════════════════════════════════════
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;

    // Read one committed profile/vehicle revision. Settings writers take this
    // same owner row FOR UPDATE; SHARE holds their commit until both reads end.
    // Keep /me's existing driver/agent authentication semantics: this read does
    // not acquire the driver-only admission lock or create/extend a session.
    const { profile, vehicle } = await db.transaction(async tx => {
      await tx.select({ userId: users.user_id }).from(users)
        .where(eq(users.user_id, userId)).for('share').limit(1);
      const profile = await tx.query.driver_profiles.findFirst({
        where: eq(driver_profiles.user_id, userId)
      });
      const vehicle = profile ? await tx.query.driver_vehicles.findFirst({
        where: and(
          eq(driver_vehicles.driver_profile_id, profile.id),
          eq(driver_vehicles.is_primary, true),
          eq(driver_vehicles.is_active, true)
        )
      }) : null;
      return { profile, vehicle };
    });

    if (!profile) {
      return res.status(404).json({
        error: 'PROFILE_NOT_FOUND',
        message: 'Driver profile not found'
      });
    }

    res.json(driverProfileResponse(profile, vehicle, req.auth.sessionId));

  } catch (err) {
    matrixLog.error({
      category: 'AUTH',
      action: 'PROFILE_GET_FAIL',
      location: 'auth.js:getProfile',
    }, 'Get profile failed', err);
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

    if (!updates || !validSettingsRevision(updates.expectedSettingsRevision)) {
      return res.status(400).json({ error: 'settings_revision_required', message: 'Reload saved settings before saving changes.' });
    }

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

    if (profile.settings_revision !== updates.expectedSettingsRevision) {
      return res.status(409).json({ error: 'settings_conflict', settingsRevision: profile.settings_revision,
        message: 'Your settings changed elsewhere. Reload and re-apply your change.' });
    }

    // Build update object
    const economics = parseEconomicPreferenceUpdates(updates);
    if (!economics.ok) {
      return res.status(400).json({ error: 'INVALID_PREFERENCE', field: economics.field, message: economics.message });
    }
    const profileUpdates = { ...economics.values };

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

    if (updates.selectedServices !== undefined) {
      if (!validateSelectedServices(updates.selectedServices, { ...profile, ...profileUpdates })) {
        return res.status(400).json({ error: 'INVALID_SELECTED_SERVICES', message: 'Select the services you want to provide from your eligible vehicle types.' });
      }
      profileUpdates.selected_services = [...updates.selectedServices];
    } else if (profile.selected_services && !validateSelectedServices(profile.selected_services, { ...profile, ...profileUpdates })) {
      return res.status(400).json({ error: 'INVALID_SELECTED_SERVICES', message: 'Update your selected services to match the vehicle eligibility changes.' });
    }

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

    // 2026-02-13: Terms acceptance (for Google OAuth users who didn't accept during sign-up)
    if (updates.termsAccepted === true) {
      profileUpdates.terms_accepted = true;
      profileUpdates.terms_accepted_at = new Date();
      profileUpdates.terms_version = '1.0';
    }

    profileUpdates.updated_at = new Date();

    // Settings submits the full profile. Compare the normalized values actually
    // being written so an unchanged address does not trigger paid geocoding (or
    // overwrite an explicitly selected market). Omitted partial-update fields
    // retain their persisted value; clearing an optional field still counts.
    const normalizeAddressPart = value => value?.trim() || null;
    const addressFieldsChanged = [
      'address_1', 'address_2', 'city', 'state_territory', 'zip_code', 'country',
    ].some(field => Object.hasOwn(profileUpdates, field) &&
      normalizeAddressPart(profileUpdates[field]) !== normalizeAddressPart(profile[field]));

    if (addressFieldsChanged) {
      Object.assign(profileUpdates, { home_lat: null, home_lng: null,
        home_formatted_address: null, home_timezone: null });
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
        const coordinates = normalizeCoordinates(geocodeResult?.lat, geocodeResult?.lng);
        if (coordinates) {
          profileUpdates.home_lat = coordinates.lat;
          profileUpdates.home_lng = coordinates.lng;
          profileUpdates.home_formatted_address = geocodeResult.formattedAddress || null;
          profileUpdates.home_timezone = geocodeResult.timezone || null;
          matrixLog.info({
            category: 'AUTH',
            action: 'PROFILE_GEOCODE',
            location: 'auth.js:updateProfile',
          }, 'Address re-geocoded (value redacted)');
        }
      } catch (geoErr) {
        // Non-fatal - log and continue with profile update
        matrixLog.warn({
          category: 'AUTH',
          action: 'PROFILE_GEOCODE_FAIL',
          location: 'auth.js:updateProfile',
        }, `Re-geocoding failed (non-fatal): ${geoErr.message}`);
      }

      // An explicit work-market choice wins over address-derived defaults.
      if (!Object.hasOwn(profileUpdates, 'market')) {
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
            matrixLog.info({
              category: 'AUTH',
              action: 'PROFILE_MARKET_UPDATE',
              location: 'auth.js:updateProfile',
            }, `Market updated: ${marketData.market_anchor} (${marketData.region_type})`);
          }
        } catch (marketErr) {
          matrixLog.warn({
            category: 'AUTH',
            action: 'PROFILE_MARKET_FAIL',
            location: 'auth.js:updateProfile',
          }, `Market re-lookup failed (non-fatal): ${marketErr.message}`);
        }
      }
    }

    // Validate the entire vehicle before either record can change. No invented
    // year/model is written for incomplete setup; the driver finishes that setup.
    const vehicleUpdates = {};
    if (updates.vehicle !== undefined) {
      if (!updates.vehicle || typeof updates.vehicle !== 'object' || Array.isArray(updates.vehicle)) {
        return res.status(400).json({ error: 'INVALID_VEHICLE' });
      }
      for (const key of ['year', 'seatbelts']) {
        if (updates.vehicle[key] === undefined) continue;
        const value = updates.vehicle[key];
        const valid = key === 'year' ? Number.isInteger(value) && value >= 1900 && value <= new Date().getFullYear() + 2
          : Number.isInteger(value) && value >= 1 && value <= 20;
        if (!valid) return res.status(400).json({ error: 'INVALID_VEHICLE', field: key });
        vehicleUpdates[key] = value;
      }
      for (const key of ['make', 'model']) {
        if (updates.vehicle[key] === undefined) continue;
        if (typeof updates.vehicle[key] !== 'string' || !updates.vehicle[key].trim()) {
          return res.status(400).json({ error: 'INVALID_VEHICLE', field: key });
        }
        vehicleUpdates[key] = updates.vehicle[key].trim();
      }
      if (updates.vehicle.color !== undefined) {
        if (updates.vehicle.color !== null && typeof updates.vehicle.color !== 'string') return res.status(400).json({ error: 'INVALID_VEHICLE', field: 'color' });
        vehicleUpdates.color = updates.vehicle.color?.trim() || null;
      }
    }

    const canonical = await withDriverSettingsLock(req.auth, async tx => {
      const [current] = await tx.select().from(driver_profiles).where(eq(driver_profiles.user_id, userId)).limit(1);
      if (current?.settings_revision !== updates.expectedSettingsRevision) {
        throw new MainRunAdmissionError(409, 'settings_conflict', 'Your settings changed elsewhere. Reload and re-apply your change.',
          { settingsRevision: current?.settings_revision });
      }
      const vehicles = await tx.select().from(driver_vehicles).where(and(
        eq(driver_vehicles.driver_profile_id, profile.id), eq(driver_vehicles.is_primary, true), eq(driver_vehicles.is_active, true),
      )).limit(2);
      if (vehicles.length > 1) throw new MainRunAdmissionError(409, 'multiple_primary_vehicles', 'Your primary vehicle needs review before saving.');
      let vehicle = vehicles[0] ?? null;
      if (updates.vehicle !== undefined) {
        if (vehicle) {
          [vehicle] = await tx.update(driver_vehicles).set({ ...vehicleUpdates, updated_at: new Date() })
            .where(eq(driver_vehicles.id, vehicle.id)).returning();
        } else {
          if (!['year', 'make', 'model', 'seatbelts'].every(key => Object.hasOwn(vehicleUpdates, key))) {
            throw new MainRunAdmissionError(400, 'INVALID_VEHICLE', 'Year, make, model and seatbelts are required for a new vehicle.');
          }
          [vehicle] = await tx.insert(driver_vehicles).values({ ...vehicleUpdates, driver_profile_id: profile.id, is_primary: true, is_active: true }).returning();
        }
      }
      const [saved] = await tx.update(driver_profiles).set({ ...profileUpdates, settings_revision: current.settings_revision + 1 })
        .where(and(eq(driver_profiles.user_id, userId), eq(driver_profiles.settings_revision, updates.expectedSettingsRevision))).returning();
      return driverProfileResponse(saved, vehicle, req.auth.sessionId);
    });
    invalidateUser(userId);

    matrixLog.info({
      category: 'AUTH',
      action: 'PROFILE_UPDATE',
      location: 'auth.js:updateProfile',
    }, `Profile updated for user ${profile.user_id.substring(0, 8)}`);

    res.json({
      ok: true,
      message: 'Profile updated successfully',
      ...canonical,
    });

  } catch (err) {
    if (err instanceof MainRunAdmissionError) return res.status(err.status).json({ error: err.code, message: err.message, ...err.details });
    matrixLog.error({
      category: 'AUTH',
      action: 'PROFILE_UPDATE_FAIL',
      location: 'auth.js:updateProfile',
    }, 'Update profile failed', err);
    res.status(500).json({ error: 'UPDATE_PROFILE_FAILED', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/auth/logout - Logout (clears session, preserves user data)
// ═══════════════════════════════════════════════════════════════════════════
router.post('/logout', requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;

    // 2026-01-05: CRITICAL FIX - Use UPDATE instead of DELETE!
    // DELETE causes CASCADE delete of driver_profiles and auth_credentials.
    // This was destroying all user data on logout!
    // Instead, we clear the session_id to invalidate the session while preserving user data.
    // 2026-09-13: Match the session captured by requireAuth — a delayed logout must not
    // clear a newer login that completed after this request was authenticated.
    await db.update(users)
      .set({
        session_id: null,
        current_snapshot_id: null,
        current_main_run_id: null,
        updated_at: new Date()
      })
      .where(and(eq(users.user_id, userId), eq(users.session_id, req.auth.sessionId)));

    matrixLog.info({
      category: 'AUTH',
      connection: 'DB',
      action: 'LOGOUT',
      tableName: 'USERS',
      location: 'auth.js:logout',
    }, `Logout completed for requested session (user ${userId.substring(0, 8)})`);
    res.json({ ok: true, message: 'Logged out successfully' });
  } catch (err) {
    matrixLog.error({
      category: 'AUTH',
      action: 'LOGOUT_FAIL',
      location: 'auth.js:logout',
    }, 'Logout failed', err);
    res.status(500).json({ error: 'LOGOUT_FAILED', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/auth/google - Initiate Google OAuth 2.0 Authorization Code flow
// 2026-02-13: Replaced stub with real Google OAuth implementation
// Flow: Client clicks Google → this endpoint → redirect to Google consent
// ═══════════════════════════════════════════════════════════════════════════
router.get('/google', async (req, res) => {
  try {
    // Check that Google OAuth is configured
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      matrixLog.error({
        category: 'AUTH',
        action: 'OAUTH_CONFIG_MISSING',
        location: 'auth.js:googleOAuthInit',
      }, 'Google OAuth not configured: missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
      const clientUrl = process.env.CLIENT_URL || '';
      return res.redirect(`${clientUrl}/auth/sign-in?error=google_not_configured`);
    }

    // Generate CSRF state and store in oauth_states table
    const state = generateState();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minute expiry

    await db.insert(oauth_states).values({
      state,
      provider: 'google',
      user_id: '00000000-0000-0000-0000-000000000000', // Nil UUID - user not authenticated yet
      redirect_uri: req.query.mode === 'signup' ? 'signup' : 'login',
      expires_at: expiresAt,
    });

    // 2026-02-13: Derive base URL for redirect_uri.
    // Priority: CLIENT_URL env > request origin (handles both dev and prod)
    const baseUrl = process.env.CLIENT_URL || `${req.protocol}://${req.get('host')}`;
    const authUrl = getGoogleAuthUrl({ state, mode: req.query.mode, baseUrl });
    matrixLog.info({
      category: 'AUTH',
      connection: 'API',
      action: 'OAUTH_INITIATE',
      location: 'auth.js:googleOAuthInit',
    }, `Google OAuth initiated (mode: ${req.query.mode || 'login'})`);
    res.redirect(authUrl);
  } catch (err) {
    matrixLog.error({
      category: 'AUTH',
      action: 'OAUTH_INITIATE_FAIL',
      location: 'auth.js:googleOAuthInit',
    }, 'Google OAuth initiation failed', err);
    const clientUrl = process.env.CLIENT_URL || '';
    res.redirect(`${clientUrl}/auth/sign-in?error=google_init_failed`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/auth/google/exchange - Complete Google OAuth (code → session)
// 2026-02-13: Client callback page sends code + state, server exchanges
// for tokens, verifies identity, finds/creates user, returns app token
// ═══════════════════════════════════════════════════════════════════════════
router.post('/google/exchange', async (req, res) => {
  let recoveryAttempt = null;
  try {
    const { code, state } = req.body;

    if (typeof code !== 'string' || !code || typeof state !== 'string' || !state) {
      return res.status(400).json({
        error: 'MISSING_PARAMS',
        message: 'Authorization code and state are required'
      });
    }
    res.set?.('Cache-Control', 'no-store');
    if (req.body.recoveryProof !== undefined) {
      const claim = await beginLoginAttempt(db, req.body.recoveryProof, 'google');
      if (!claim.claimed) {
        const recovered = await recoverLoginAttempt(db, req.body.recoveryProof);
        return res.status(recovered.status).json(recovered.body);
      }
      recoveryAttempt = claim.attempt;
    }

    // 1. Validate AND consume the CSRF state in ONE statement (2026-09-10, VP-005 / Astra
    //    A5a, verified): the former select-then-delete let two concurrent exchanges both
    //    pass the SELECT before either DELETE. DELETE … RETURNING is atomic — exactly one
    //    request can ever own a given state row.
    const [storedState] = await db
      .delete(oauth_states)
      .where(and(
        eq(oauth_states.state, state),
        eq(oauth_states.provider, 'google'),
        gt(oauth_states.expires_at, new Date())
      ))
      .returning();

    if (!storedState) {
      matrixLog.warn({
        category: 'AUTH',
        action: 'OAUTH_STATE_INVALID',
        location: 'auth.js:googleOAuthCallback',
      }, 'Google OAuth: invalid, expired, or already-consumed state parameter');
      return res.status(400).json({
        error: 'INVALID_STATE',
        message: 'Invalid or expired OAuth state. Please try again.'
      });
    }

    // 2. Exchange authorization code for tokens
    // 2026-02-13: baseUrl must match exactly what was used in the auth URL
    const baseUrl = process.env.CLIENT_URL || `${req.protocol}://${req.get('host')}`;
    matrixLog.info({
      category: 'AUTH',
      connection: 'API',
      action: 'OAUTH_EXCHANGE',
      location: 'auth.js:googleOAuthCallback',
    }, 'Google OAuth: exchanging code for tokens');
    const tokens = await exchangeGoogleCode(code, baseUrl);

    if (!tokens.id_token) {
      throw new Error('Google did not return an ID token');
    }

    // 3. Verify ID token and extract user info
    matrixLog.info({
      category: 'AUTH',
      connection: 'API',
      action: 'OAUTH_VERIFY',
      location: 'auth.js:googleOAuthCallback',
    }, 'Google OAuth: verifying ID token');
    const googleUser = await verifyGoogleIdToken(tokens.id_token);
    matrixLog.info({
      category: 'AUTH',
      action: 'OAUTH_VERIFIED',
      location: 'auth.js:googleOAuthCallback',
    }, `Google OAuth: verified user (sub: ${googleUser.sub.substring(0, 8)})`);

    // 4. Resolve identity — SUBJECT FIRST, then verified email (2026-09-10, VP-004 /
    //    Astra A4a–A4c, each verified and skeptic-confirmed). The decision itself is pure
    //    and unit-tested (server/lib/auth/identity-policy.js); this route only performs
    //    the lookups and applies the verdict. The old single `google_id = sub OR email =`
    //    query had no priority rule and authenticated an email-matched profile even when
    //    it was bound to a DIFFERENT Google subject.
    const googleEmail = googleUser.email.toLowerCase().trim();
    const bySubject = await db.query.driver_profiles.findFirst({
      where: eq(driver_profiles.google_id, googleUser.sub)
    });
    const byEmail = bySubject ? null : await db.query.driver_profiles.findFirst({
      where: eq(driver_profiles.email, googleEmail)
    });
    let byEmailHasPassword = false;
    if (byEmail) {
      const [creds] = await db
        .select({ password_hash: auth_credentials.password_hash })
        .from(auth_credentials)
        .where(eq(auth_credentials.user_id, byEmail.user_id))
        .limit(1);
      byEmailHasPassword = Boolean(creds?.password_hash);
    }
    const verdict = resolveGoogleIdentity({ bySubject, byEmail, sub: googleUser.sub, byEmailHasPassword });

    if (verdict.kind === 'conflict') {
      matrixLog.warn({
        category: 'AUTH',
        action: 'OAUTH_IDENTITY_CONFLICT',
        location: 'auth.js:googleOAuthCallback',
      }, `Google OAuth: email matches profile ${verdict.profile.user_id.substring(0, 8)} bound to a different Google subject — refused`);
      return res.status(409).json({
        error: 'ACCOUNT_CONFLICT',
        message: 'This email is already linked to a different Google account. Sign in with that Google account, or use your password.'
      });
    }

    const profile = verdict.profile; // null when this is a brand-new account
    let activeProfile = profile;
    let passwordRevoked = false;
    const newSessionId = crypto.randomUUID();

    const login = await withLoginAttempt(db, recoveryAttempt, async tx => {
      if (verdict.kind === 'new') {
        // Account creation and first session must commit together so a failed
        // admission cannot strand a profile that can neither sign in nor reset.
        const newUserId = crypto.randomUUID();
        const now = new Date();
        await tx.insert(users).values({
          user_id: newUserId,
          session_id: null,
          current_snapshot_id: null,
          session_start_at: now,
          last_active_at: now,
          created_at: now,
          updated_at: now
        });
        const [newProfile] = await tx.insert(driver_profiles).values({
          user_id: newUserId,
          first_name: googleUser.given_name || googleUser.name.split(' ')[0] || 'Driver',
          last_name: googleUser.family_name || googleUser.name.split(' ').slice(1).join(' ') || '',
          driver_nickname: googleUser.given_name || googleUser.name.split(' ')[0] || null,
          email: googleEmail,
          google_id: googleUser.sub,
          // Fields user must complete later (nullable since 2026-02-13)
          phone: null,
          address_1: null,
          city: null,
          state_territory: null,
          market: null,
          // Email is verified by Google
          email_verified: true,
          profile_complete: false,
          // 2026-02-13: Do NOT auto-accept terms — user must explicitly accept
          terms_accepted: false,
          terms_accepted_at: null,
          terms_version: null,
        }).returning();
        await tx.insert(auth_credentials).values({
          user_id: newUserId,
          password_hash: null, // OAuth-only: no password
          last_login_at: now,
        });
        activeProfile = newProfile;
      } else if (verdict.kind === 'link') {
        // Google proves email ownership. An unverified registrant's password,
        // phone and session cannot survive adoption by the verified owner;
        // the owner can set a password through the email reset flow.
        // Match password/reset lock order, then serialize with profile saves.
        // Recheck the adoption decision after waiting: a concurrent Google login
        // may already own this account and its session must not be revoked again.
        const [currentCredentials] = await tx.select().from(auth_credentials)
          .where(eq(auth_credentials.user_id, activeProfile.user_id)).for('update').limit(1);
        await tx.select().from(users).where(eq(users.user_id, activeProfile.user_id)).for('update').limit(1);
        const currentProfile = await tx.query.driver_profiles.findFirst({ where: eq(driver_profiles.user_id, activeProfile.user_id) });
        if (!currentProfile) throw new Error('Driver profile disappeared during Google account linking');
        const currentVerdict = resolveGoogleIdentity({
          bySubject: currentProfile.google_id === googleUser.sub ? currentProfile : null,
          byEmail: currentProfile, sub: googleUser.sub,
          byEmailHasPassword: Boolean(currentCredentials?.password_hash),
        });
        if (currentVerdict.kind === 'conflict') return { identityConflict: true };
        if (currentVerdict.kind === 'link') {
          await tx.update(driver_profiles)
            .set({ google_id: googleUser.sub, email_verified: true, updated_at: new Date() })
            .where(eq(driver_profiles.id, activeProfile.id));
          if (currentVerdict.revokePassword) {
            await tx.update(auth_credentials)
              .set({ password_hash: null })
              .where(eq(auth_credentials.user_id, activeProfile.user_id));
            await tx.update(driver_profiles)
              .set({ phone: null, phone_verified: false })
              .where(eq(driver_profiles.id, activeProfile.id));
            await tx.update(users)
              .set({ session_id: null, current_snapshot_id: null, current_main_run_id: null, updated_at: new Date() })
              .where(eq(users.user_id, activeProfile.user_id));
          }
        }
        passwordRevoked = currentVerdict.revokePassword;
      }
      // Account/link writes and admission commit together. If a prior session is
      // live, refusal also rolls back a verified existing account's Google link.
      const created = await createDriverSession(tx, activeProfile.user_id, newSessionId);
      const token = await generateAuthToken(activeProfile.user_id, activeProfile.email, newSessionId, created.sessionStartedAt);
      await completeLoginAttempt(tx, recoveryAttempt, { userId: activeProfile.user_id, sessionId: newSessionId,
        isNewUser: !profile, passwordRevoked });
      return { ...created, token };
    });
    if (login.identityConflict) return res.status(409).json({
      error: 'ACCOUNT_CONFLICT',
      message: 'This email is already linked to a different Google account. Sign in with that Google account, or use your password.'
    });

    matrixLog.info({
      category: 'AUTH',
      action: 'OAUTH_LOGIN_SUCCESS',
      location: 'auth.js:googleOAuthCallback',
    }, `Google OAuth: user ${activeProfile.user_id.substring(0, 8)} (${profile ? 'existing' : 'new'} account)`);

    // Return same structure as /login for auth context compatibility
    res.json({
      ok: true,
      token: login.token,
      isNewUser: !profile, // Let client know this is a new sign-up
      passwordRevoked, // 2026-09-10: true when an unproven password was revoked on Google link
      ...driverProfileResponse(login.profile, login.vehicle, newSessionId)
    });
  } catch (err) {
    if (err instanceof LoginAttemptError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    if (err instanceof ActiveDriverSessionError) {
      return res.status(409).json({ error: err.code, message: err.message });
    }
    matrixLog.error({
      category: 'AUTH',
      action: 'OAUTH_EXCHANGE_FAIL',
      location: 'auth.js:googleOAuthCallback',
    }, 'Google OAuth exchange failed', err);
    // 2026-09-10 (VP-003 / Astra A3c): a unique-index loser in the new-account race is an
    // existing account, and Google's raw token-exchange body is never relayed to the browser.
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'ACCOUNT_EXISTS', message: 'An account for this Google identity already exists. Please sign in again.' });
    }
    res.status(500).json({
      error: 'GOOGLE_AUTH_FAILED',
      message: 'Google authentication failed. Please try again.'
    });
  } finally {
    try { await failLoginAttempt(db, recoveryAttempt); }
    catch { matrixLog.warn({ category: 'AUTH', action: 'LOGIN_ATTEMPT_STATUS_FAIL', location: 'auth.js:googleOAuthCallback' }, 'Sign-in attempt status could not be recorded'); }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/auth/apple - Apple Sign In (stub - not yet implemented)
// 2026-01-06: Added stub to prevent 404 when social login buttons clicked
// TODO: Implement full Apple Sign In with passport-apple
// ═══════════════════════════════════════════════════════════════════════════
router.get('/apple', (req, res) => {
  matrixLog.warn({
    category: 'AUTH',
    action: 'APPLE_OAUTH_STUB',
    location: 'auth.js:appleOAuth',
  }, 'Apple Sign In requested but not yet implemented');
  const clientUrl = process.env.CLIENT_URL || '';
  res.redirect(`${clientUrl}/auth/sign-in?error=social_not_implemented&provider=apple`);
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

  // Bind the dev token to the user's current session when one exists (same rule as real logins).
  const [devSession] = await db.select({ session_id: users.session_id }).from(users).where(eq(users.user_id, user_id)).limit(1);
  const token = await generateAuthToken(user_id, 'dev-token', devSession?.session_id || null);

  res.json({
    token,
    user_id,
    expires_in: 86400,
    _dev_warning: 'This endpoint is disabled in production. Use /api/auth/login instead.'
  });
});

export default router;
