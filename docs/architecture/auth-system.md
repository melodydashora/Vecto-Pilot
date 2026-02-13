# Authentication API

This module handles the core authentication API routes, serving as the primary entry point for user registration and session management. It manages the creation of driver profiles, vehicles, and the normalization of service capabilities.

**File:** `server/api/auth/auth.js`

## Dependencies
The module relies on several shared libraries and schema definitions:
- **Schema:** `users`, `driver_profiles`, `driver_vehicles`, `platform_data`, `auth_credentials`, `verification_codes`, `oauth_states`.
- **Libraries:** `google-oauth.js`, `password.js`, `email.js`, `sms.js`, `geocode.js`, `address-validation.js`.

## Endpoints

### Register Driver
**Route:** `POST /api/auth/register`

Creates a new driver account. This endpoint processes personal details, address, and vehicle information. It specifically handles the normalization of vehicle eligibility, attributes, and service preferences into a standardized, platform-agnostic taxonomy.

- **Authentication:** Public
- **Request Body:**
    - **Account:** `firstName`, `lastName`, `email`, `phone`, `password`, `nickname`.
    - **Address:** `address1`, `address2`, `city`, `stateTerritory`, `zipCode`, `country`, `market`.
    - **Vehicle:** Accepts flat fields (`vehicleYear`, `vehicleMake`, `vehicleModel`, `seatbelts`) or a nested `vehicle` object.
    - **Platform:** `ridesharePlatforms` (Array, default: `['uber']`).
    - **Driver Eligibility (Platform-Agnostic):**
        - `eligEconomy` (Boolean, default: true)
        - `eligXl`, `eligXxl` (Boolean)
        - `eligComfort` (Boolean)
        - `eligLuxurySedan`, `eligLuxurySuv` (Boolean)
    - **Vehicle Attributes:**
        - `attrElectric`, `attrGreen`
        - `attrWav` (Wheelchair Accessible Vehicle)
        - `attrSki`, `attrCarSeat`
    - **Service Preferences:**
        - `prefPetFriendly`, `prefTeen`, `prefAssist`, `prefShared`
    - **Agreements:** `marketingOptIn`, `termsAccepted` (Boolean).
    - **Legacy Support:** Accepts legacy fields (e.g., `uberTiers`, `tierBlack`, `uberXxl`) and automatically maps them to the new eligibility taxonomy.

- **Flow:**
    1.  **Normalization:**
        -   Consolidates vehicle data from nested or flat structures.
        -   Maps incoming legacy tier flags to the new standardized boolean flags (e.g., mapping `tierBlack` to `eligLuxurySedan`).
        -   Sets defaults for attributes and preferences.
    2.  **Validation:** Validates password strength, phone number, and address (via helper libraries).
    3.  **Creation:** Hashes the password and creates related database records for the user and driver profile.
    4.  **Response:** Returns the created user object and a JWT authentication token.

---

# Uber OAuth Integration

This module handles the OAuth 2.0 flow for connecting a user's Uber Driver account. It manages state generation, token exchange, encryption, and storage.

**File:** `server/api/auth/uber.js`

## Dependencies
The module relies on shared schema definitions and specific OAuth helpers:
- **Schema:** `uber_connections`, `oauth_states`.
- **Libraries:** `uber-oauth.js`, `drizzle-orm`.

## Endpoints

### Initiate Uber OAuth
**Route:** `GET /api/auth/uber`

Initiates the OAuth flow by generating a CSRF state, storing it, and redirecting the user to Uber's authorization page.

- **Authentication:** Required (Authenticated User)
- **Flow:**
    1.  **State Generation:** Generates a random state string and stores it in `oauth_states` with a 10-minute expiration.
    2.  **Redirect:** Redirects the client to the Uber authorization URL.

### Uber OAuth Callback
**Route:** `GET /api/auth/uber/callback`

Handles the redirect from Uber after user authorization.

- **Authentication:** Public (Handled via State validation)
- **Query Parameters:** `code`, `state`, `error`, `error_description`.
- **Flow:**
    1.  **Validation:** Verifies the `state` parameter against the database to prevent CSRF.
    2.  **Token Exchange:** Exchanges the authorization `code` for access and refresh tokens.
    3.  **Storage:** Encrypts tokens and upserts a record in `uber_connections`.
    4.  **Response:** Redirects to the frontend success page (`/auth/signup?uber_connected=true`) or handles errors.

### Disconnect Uber
**Route:** `POST /api/auth/uber/disconnect`

Revokes the Uber access token and marks the connection as inactive.

- **Authentication:** Required (Authenticated User)
- **Flow:**
    1.  **Retrieval:** Finds the active Uber connection for the user.
    2.  **Revocation:** Decrypts the access token and attempts to revoke it via the Uber API.
    3.  **Update:** Sets `is_active` to `false` in the `uber_connections` table.