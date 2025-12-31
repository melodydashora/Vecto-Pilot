# Authentication System Documentation

## Overview

VectoPilot uses a multi-layer authentication system supporting:
- **Email/password** authentication with bcrypt hashing
- **Social login** (Google, Apple) via OAuth 2.0
- **SMS verification** via Twilio for password reset
- **Email verification** via SendGrid

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Client (React)                             │
├─────────────────────────────────────────────────────────────────────┤
│  SignInPage ─────────┐                                              │
│  SignUpPage ─────────┼──▶ auth-context.tsx ──▶ /api/auth/*          │
│  ForgotPasswordPage ─┤                                              │
│  ResetPasswordPage ──┘                                              │
│                                                                     │
│  Social Login: Google/Apple buttons ──▶ /api/auth/google|apple      │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Server (Express)                           │
├─────────────────────────────────────────────────────────────────────┤
│  server/api/auth/auth.js                                            │
│  ├── POST /api/auth/register                                        │
│  ├── POST /api/auth/login                                           │
│  ├── POST /api/auth/forgot-password                                 │
│  ├── POST /api/auth/reset-password                                  │
│  ├── GET  /api/auth/me                                              │
│  ├── GET  /api/auth/google (OAuth redirect)                         │
│  └── GET  /api/auth/apple (OAuth redirect)                          │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Server Libraries                             │
├─────────────────────────────────────────────────────────────────────┤
│  server/lib/auth/                                                   │
│  ├── password.js ──▶ bcrypt hash/verify, JWT token generation       │
│  ├── email.js ────▶ SendGrid: welcome email, password reset         │
│  └── sms.js ──────▶ Twilio: SMS verification codes                  │
│                                                                     │
│  server/lib/location/                                               │
│  └── geocode.js ──▶ Google Geocoding API for address → lat/lng      │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Database (PostgreSQL)                      │
├─────────────────────────────────────────────────────────────────────┤
│  users                 │ Base user record (device_id, last location)│
│  auth_credentials      │ Password hash, login attempts, reset tokens│
│  driver_profiles       │ Personal info, address, market, geocoded   │
│  driver_vehicles       │ Year, make, model, seatbelts               │
│  verification_codes    │ SMS/email verification codes               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### `auth_credentials`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | FK → users.id (unique) |
| password_hash | TEXT | bcrypt hash (12 rounds) |
| failed_login_attempts | INTEGER | Lockout counter |
| locked_until | TIMESTAMP | Account lock expiry |
| last_login_at | TIMESTAMP | Last successful login |
| password_reset_token | TEXT | Email reset token (hashed) |
| password_reset_expires | TIMESTAMP | Token expiry |
| created_at, updated_at | TIMESTAMP | Audit timestamps |

### `driver_profiles`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | FK → users.id (unique) |
| first_name, last_name | TEXT | Driver name |
| email | TEXT | Unique email address |
| phone | TEXT | Phone number |
| address_1, address_2 | TEXT | Street address |
| city, state_territory | TEXT | City/State |
| zip_code, country | TEXT | Postal/Country |
| market | TEXT | Driving market (required) |
| home_lat, home_lng | DOUBLE PRECISION | Geocoded coordinates |
| home_formatted_address | TEXT | Google-formatted address |
| home_timezone | TEXT | IANA timezone (e.g., "America/Chicago") |
| rideshare_platforms | JSONB | ['uber', 'lyft', 'private'] |
| uber_black, uber_xxl, uber_comfort, uber_x, uber_x_share | BOOLEAN | Uber tiers |
| marketing_opt_in | BOOLEAN | Email marketing consent |
| terms_accepted_at | TIMESTAMP | When terms were accepted |
| email_verified, phone_verified | BOOLEAN | Verification status |
| created_at, updated_at | TIMESTAMP | Audit timestamps |

### `driver_vehicles`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| driver_profile_id | UUID | FK → driver_profiles.id |
| year | INTEGER | Vehicle year (2005-2025) |
| make | TEXT | Vehicle make (e.g., "Toyota") |
| model | TEXT | Vehicle model (e.g., "Camry") |
| seatbelts | INTEGER | Passenger capacity (1-15) |
| is_primary | BOOLEAN | Primary vehicle flag |
| created_at, updated_at | TIMESTAMP | Audit timestamps |

### `verification_codes`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | FK → users.id |
| code | TEXT | 6-digit verification code |
| code_type | TEXT | 'password_reset_email' or 'password_reset_sms' |
| destination | TEXT | Email or phone number |
| expires_at | TIMESTAMP | Code expiry (15 minutes) |
| used_at | TIMESTAMP | When code was used |
| attempts | INTEGER | Failed attempt counter |
| created_at | TIMESTAMP | Creation timestamp |

---

## API Endpoints

### `POST /api/auth/register`
Creates new user with driver profile and vehicle.

**Request Body:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phone": "5551234567",
  "password": "SecurePass123",
  "address1": "123 Main St",
  "address2": "Apt 4B",
  "city": "Dallas",
  "stateTerritory": "Texas",
  "zipCode": "75201",
  "country": "US",
  "market": "dallas-fort-worth",
  "vehicleYear": 2022,
  "vehicleMake": "Toyota",
  "vehicleModel": "Camry",
  "seatbelts": 4,
  "ridesharePlatforms": ["uber", "lyft"],
  "uberBlack": false,
  "uberComfort": true,
  "marketingOptIn": false,
  "termsAccepted": true
}
```

**Response (201):**
```json
{
  "user": { "id": "uuid", "email": "john@example.com" },
  "token": "jwt_token_here"
}
```

**Errors:**
- 400: Missing required fields
- 409: Email already exists

---

### `POST /api/auth/login`
Authenticates user with email/password.

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "SecurePass123"
}
```

**Response (200):**
```json
{
  "user": { "id": "uuid", "email": "john@example.com" },
  "token": "jwt_token_here"
}
```

**Errors:**
- 401: Invalid credentials
- 403: Account locked (after 5 failed attempts)

---

### `POST /api/auth/forgot-password`
Initiates password reset via email or SMS.

**Request Body:**
```json
{
  "email": "john@example.com",
  "method": "email"  // or "sms"
}
```

**Response (200):**
```json
{
  "message": "Password reset email sent"
}
```

---

### `POST /api/auth/reset-password`
Resets password with token (email) or code (SMS).

**Request Body (Email flow):**
```json
{
  "token": "reset_token_from_email",
  "newPassword": "NewSecurePass456"
}
```

**Request Body (SMS flow):**
```json
{
  "email": "john@example.com",
  "code": "123456",
  "newPassword": "NewSecurePass456"
}
```

**Response (200):**
```json
{
  "message": "Password reset successfully"
}
```

---

### `GET /api/auth/me`
Returns current user profile (requires auth token).

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "user": { "id": "uuid", "email": "..." },
  "profile": { "firstName": "...", "market": "..." },
  "vehicle": { "year": 2022, "make": "Toyota", "model": "Camry" }
}
```

---

### Social OAuth Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/auth/google` | Redirects to Google OAuth |
| `GET /api/auth/google/callback` | Handles Google OAuth callback |
| `GET /api/auth/apple` | Redirects to Apple Sign-In |
| `GET /api/auth/apple/callback` | Handles Apple callback |

**Query Parameters:**
- `mode=signup` - Indicate signup intent (vs login)

---

## Client Pages

### `/auth/sign-in`
**File:** `client/src/pages/auth/SignInPage.tsx`

Features:
- Email/password form with Zod validation
- Google sign-in button (white bg, colored G logo)
- Apple sign-in button (black bg, Apple logo)
- "Forgot password?" link
- "Sign up" link

---

### `/auth/sign-up`
**File:** `client/src/pages/auth/SignUpPage.tsx`

**4-Step Registration Flow:**

| Step | Fields |
|------|--------|
| 1. Account | First Name, Last Name, Email, Phone, Password, Confirm Password + Social Login buttons |
| 2. Address | Address 1, Address 2, City, State, ZIP, Market (dropdown from API) |
| 3. Vehicle | Year, Make, Model (NHTSA API), Seatbelts |
| 4. Services | Rideshare Platforms, Uber Tiers (optional), Marketing opt-in, Terms checkbox |

Features:
- Progress indicator (steps 1-4)
- Per-step validation before proceeding
- Geocoding of address on submit (non-blocking)
- Social sign-up on Step 1

---

### `/auth/forgot-password`
**File:** `client/src/pages/auth/ForgotPasswordPage.tsx`

Features:
- Email input field
- Method choice: "Send Email" or "Send SMS Code"
- Success confirmation with next steps

---

### `/auth/reset-password`
**File:** `client/src/pages/auth/ResetPasswordPage.tsx`

Features:
- Handles both token (email) and code (SMS) flows
- Token flow: only shows password fields
- Code flow: shows email + 6-digit OTP input + password fields
- Password validation (8+ chars, uppercase, lowercase, number)

---

### `/auth/terms`
**File:** `client/src/pages/auth/TermsPage.tsx`

Displays Terms of Use with sections:
1. Service Description
2. No Platform Affiliation (NOT affiliated with Uber/Lyft)
3. No Guarantees (earnings, availability)
4. Data Privacy (no data selling)
5. Account Termination
6. Limitation of Liability

---

## Security Features

### Password Security
- **bcrypt** with 12 salt rounds
- Password requirements: 8+ chars, 1 uppercase, 1 lowercase, 1 number
- Password hash stored separately from profile data

### Account Lockout
- 5 failed login attempts → 15-minute lockout
- Counter resets on successful login

### JWT Tokens
- HMAC-SHA256 signing
- 30-day expiration
- Stored in localStorage (client)

### Verification Codes
- 6-digit numeric codes
- 15-minute expiration
- Max 5 attempts per code
- Rate limited: 1 code per minute

---

## Environment Variables

```bash
# JWT
JWT_SECRET=your-secret-key

# SendGrid (Email)
SENDGRID_API_KEY=SG.xxx
SENDGRID_FROM_EMAIL=noreply@vectopilot.com

# Twilio (SMS)
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=+1xxxxx

# Google OAuth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx

# Apple Sign-In
APPLE_CLIENT_ID=com.vectopilot.app
APPLE_TEAM_ID=xxx
APPLE_KEY_ID=xxx
APPLE_PRIVATE_KEY=xxx

# Google Maps (Geocoding)
GOOGLE_MAPS_API_KEY=xxx
```

---

## Test Cases

### Unit Tests

#### Password Hashing
```javascript
// server/lib/auth/password.test.js
describe('hashPassword', () => {
  test('returns different hash than plaintext', async () => {
    const hash = await hashPassword('Test123!');
    expect(hash).not.toBe('Test123!');
  });

  test('different hashes for same password (salt)', async () => {
    const hash1 = await hashPassword('Test123!');
    const hash2 = await hashPassword('Test123!');
    expect(hash1).not.toBe(hash2);
  });
});

describe('verifyPassword', () => {
  test('returns true for correct password', async () => {
    const hash = await hashPassword('Test123!');
    const result = await verifyPassword('Test123!', hash);
    expect(result).toBe(true);
  });

  test('returns false for wrong password', async () => {
    const hash = await hashPassword('Test123!');
    const result = await verifyPassword('Wrong123!', hash);
    expect(result).toBe(false);
  });
});
```

#### JWT Token Generation
```javascript
// server/lib/auth/password.test.js
describe('generateAuthToken', () => {
  test('generates valid JWT format', () => {
    const token = generateAuthToken('user-123', 'test@example.com');
    const parts = token.split('.');
    expect(parts.length).toBe(3);
  });

  test('token contains correct payload', () => {
    const token = generateAuthToken('user-123', 'test@example.com');
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    expect(payload.sub).toBe('user-123');
    expect(payload.email).toBe('test@example.com');
  });
});
```

---

### Integration Tests

#### Registration Flow
```javascript
// tests/auth/register.test.js
describe('POST /api/auth/register', () => {
  test('creates user with valid data', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        firstName: 'Test',
        lastName: 'Driver',
        email: 'test@example.com',
        phone: '5551234567',
        password: 'SecurePass123',
        address1: '123 Main St',
        city: 'Dallas',
        stateTerritory: 'Texas',
        market: 'dallas-fort-worth',
        vehicleYear: 2022,
        vehicleMake: 'Toyota',
        vehicleModel: 'Camry',
        seatbelts: 4,
        ridesharePlatforms: ['uber'],
        termsAccepted: true
      });

    expect(response.status).toBe(201);
    expect(response.body.token).toBeDefined();
    expect(response.body.user.email).toBe('test@example.com');
  });

  test('rejects duplicate email', async () => {
    // Create first user
    await request(app).post('/api/auth/register').send({ /* valid data */ });

    // Try duplicate
    const response = await request(app)
      .post('/api/auth/register')
      .send({ /* same email */ });

    expect(response.status).toBe(409);
  });

  test('rejects missing required fields', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@example.com' });

    expect(response.status).toBe(400);
    expect(response.body.missing).toContain('firstName');
  });

  test('geocodes address on registration', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ /* valid data with full address */ });

    // Check profile has geocoded coords
    const profile = await db.query.driverProfiles.findFirst({
      where: eq(driverProfiles.email, 'test@example.com')
    });

    expect(profile.home_lat).toBeDefined();
    expect(profile.home_lng).toBeDefined();
    expect(profile.home_timezone).toBeDefined();
  });
});
```

#### Login Flow
```javascript
// tests/auth/login.test.js
describe('POST /api/auth/login', () => {
  test('returns token for valid credentials', async () => {
    // Setup: create user first
    await createTestUser({ email: 'test@example.com', password: 'Test123!' });

    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'Test123!'
      });

    expect(response.status).toBe(200);
    expect(response.body.token).toBeDefined();
  });

  test('rejects invalid password', async () => {
    await createTestUser({ email: 'test@example.com', password: 'Test123!' });

    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'WrongPassword!'
      });

    expect(response.status).toBe(401);
  });

  test('locks account after 5 failed attempts', async () => {
    await createTestUser({ email: 'test@example.com', password: 'Test123!' });

    // Fail 5 times
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'wrong' });
    }

    // 6th attempt should be locked
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'Test123!' });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('locked');
  });
});
```

#### Password Reset Flow
```javascript
// tests/auth/reset-password.test.js
describe('Password Reset', () => {
  test('forgot-password sends email', async () => {
    await createTestUser({ email: 'test@example.com' });

    const response = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'test@example.com', method: 'email' });

    expect(response.status).toBe(200);
    // Verify SendGrid was called (mock)
    expect(mockSendGrid.send).toHaveBeenCalled();
  });

  test('reset-password with valid token works', async () => {
    await createTestUser({ email: 'test@example.com' });

    // Request reset
    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'test@example.com', method: 'email' });

    // Get token from DB (in real test, extract from email mock)
    const cred = await db.query.authCredentials.findFirst({ ... });

    // Reset password
    const response = await request(app)
      .post('/api/auth/reset-password')
      .send({
        token: cred.password_reset_token,
        newPassword: 'NewPass456!'
      });

    expect(response.status).toBe(200);

    // Verify new password works
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'NewPass456!' });

    expect(loginResponse.status).toBe(200);
  });
});
```

---

### E2E Tests (Playwright/Cypress)

#### Sign Up Flow
```javascript
// tests/e2e/signup.spec.ts
test('complete signup flow', async ({ page }) => {
  await page.goto('/auth/sign-up');

  // Step 1: Account
  await page.fill('[name="firstName"]', 'Test');
  await page.fill('[name="lastName"]', 'Driver');
  await page.fill('[name="email"]', 'test@example.com');
  await page.fill('[name="phone"]', '5551234567');
  await page.fill('[name="password"]', 'SecurePass123');
  await page.fill('[name="confirmPassword"]', 'SecurePass123');
  await page.click('button:has-text("Next")');

  // Step 2: Address
  await page.fill('[name="address1"]', '123 Main St');
  await page.fill('[name="city"]', 'Dallas');
  await page.click('[name="stateTerritory"]');
  await page.click('text=Texas');
  await page.click('[name="market"]');
  await page.click('text=Dallas-Fort Worth');
  await page.click('button:has-text("Next")');

  // Step 3: Vehicle
  await page.click('[name="vehicleYear"]');
  await page.click('text=2022');
  await page.click('[name="vehicleMake"]');
  await page.click('text=Toyota');
  await page.waitForSelector('[name="vehicleModel"]:not([disabled])');
  await page.click('[name="vehicleModel"]');
  await page.click('text=Camry');
  await page.click('button:has-text("Next")');

  // Step 4: Services
  await page.check('input#uber');
  await page.check('input#termsAccepted');
  await page.click('button:has-text("Create Account")');

  // Verify redirect to strategy page
  await expect(page).toHaveURL('/co-pilot/strategy');
});

test('social signup redirects to Google', async ({ page }) => {
  await page.goto('/auth/sign-up');

  // Click Google button
  await page.click('button:has-text("Continue with Google")');

  // Should redirect to Google OAuth
  await expect(page.url()).toContain('accounts.google.com');
});
```

#### Sign In Flow
```javascript
// tests/e2e/signin.spec.ts
test('sign in with valid credentials', async ({ page }) => {
  await page.goto('/auth/sign-in');

  await page.fill('[name="email"]', 'existing@example.com');
  await page.fill('[name="password"]', 'Test123!');
  await page.click('button:has-text("Sign In")');

  await expect(page).toHaveURL('/co-pilot/strategy');
});

test('shows error for invalid credentials', async ({ page }) => {
  await page.goto('/auth/sign-in');

  await page.fill('[name="email"]', 'test@example.com');
  await page.fill('[name="password"]', 'wrongpassword');
  await page.click('button:has-text("Sign In")');

  await expect(page.locator('[role="alert"]')).toContainText('Invalid');
});
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `shared/schema.js` | Database schema (Drizzle ORM) |
| `server/api/auth/auth.js` | Auth API routes |
| `server/lib/auth/password.js` | Password hashing, JWT tokens |
| `server/lib/auth/email.js` | SendGrid email service |
| `server/lib/auth/sms.js` | Twilio SMS service |
| `server/lib/location/geocode.js` | Google Geocoding API |
| `server/api/vehicle/vehicle.js` | NHTSA vehicle API proxy |
| `server/api/platform/index.js` | Markets dropdown endpoint |
| `client/src/contexts/auth-context.tsx` | React auth state |
| `client/src/types/auth.ts` | TypeScript types |
| `client/src/pages/auth/SignInPage.tsx` | Sign in page |
| `client/src/pages/auth/SignUpPage.tsx` | Multi-step sign up |
| `client/src/pages/auth/ForgotPasswordPage.tsx` | Password reset request |
| `client/src/pages/auth/ResetPasswordPage.tsx` | Password reset form |
| `client/src/pages/auth/TermsPage.tsx` | Terms and conditions |
| `client/src/components/auth/ProtectedRoute.tsx` | Route guard |
| `client/src/routes.tsx` | Router configuration |

---

## Enabling Auth Protection

When ready to require authentication, wrap routes in `ProtectedRoute`:

```tsx
// client/src/routes.tsx
import ProtectedRoute from '@/components/auth/ProtectedRoute';

// Change this:
{ path: 'strategy', element: <StrategyPage /> }

// To this:
{ path: 'strategy', element: <ProtectedRoute><StrategyPage /></ProtectedRoute> }
```

---

## OAuth Setup (Future)

### Google OAuth
1. Create project at console.cloud.google.com
2. Enable OAuth 2.0 credentials
3. Set authorized redirect URI: `https://vectopilot.com/api/auth/google/callback`
4. Add env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

### Apple Sign-In
1. Register app at developer.apple.com
2. Create Services ID with Sign in with Apple capability
3. Set return URL: `https://vectopilot.com/api/auth/apple/callback`
4. Add env vars: `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`

---

*Last updated: December 2024*
