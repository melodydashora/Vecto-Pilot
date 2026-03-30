> **Last Verified:** 2026-01-06

# Auth Pages

Authentication pages for the VectoPilot driver portal.

## Pages

| Page | Route | Purpose |
|------|-------|---------|
| `SignInPage.tsx` | `/auth/sign-in` | Email + password login |
| `SignUpPage.tsx` | `/auth/sign-up` | Multi-step registration (4 steps) |
| `ForgotPasswordPage.tsx` | `/auth/forgot-password` | Choose email or SMS reset |
| `ResetPasswordPage.tsx` | `/auth/reset-password` | Enter new password (token or code) |
| `TermsPage.tsx` | `/auth/terms` | Terms and Conditions display |

## Sign Up Flow (4 Steps)

### Step 1: Account
- First Name (required)
- Last Name (required)
- Email (required)
- Phone Number (required)
- Password (required)
- Confirm Password (required)

### Step 2: Address
- Address Line 1 (required)
- Address Line 2 (optional)
- City (required)
- State/Territory (required)
- ZIP Code (optional)
- Market (required, fetched from `/api/platform/markets-dropdown`)

### Step 3: Vehicle
- Year (required, fetched from `/api/vehicle/years`)
- Make (required, fetched from `/api/vehicle/makes`)
- Model (required, fetched from `/api/vehicle/models`)
- Seatbelts (required, 1-15)

### Step 4: Services & Terms
- Rideshare Platforms (required): Uber, Lyft, Private
- Uber Service Tiers (optional, shown if Uber selected):
  - Uber Black, Uber XXL, Uber Comfort, Uber X, UberX Share
- Marketing Opt-in (optional)
- Terms Acceptance (required)

## Password Reset Flow

### Email Method
1. User enters email on ForgotPasswordPage
2. Backend sends reset link via SendGrid
3. User clicks link → ResetPasswordPage with `?token=xxx`
4. User enters new password

### SMS Method
1. User enters email on ForgotPasswordPage
2. Backend sends 6-digit code via Twilio
3. User navigates to ResetPasswordPage
4. User enters email, code, and new password

## Password Requirements

- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number

## Related Files

- `client/src/contexts/auth-context.tsx` - Auth state management
- `client/src/types/auth.ts` - TypeScript types
- `client/src/components/auth/ProtectedRoute.tsx` - Route guard
- `server/api/auth/auth.js` - Backend auth endpoints
- `server/lib/auth/` - Auth utilities (password, email, SMS)
