# Auth Utilities

Authentication and verification utilities for the VectoPilot driver authentication system.

## Files

| File | Purpose |
|------|---------|
| `password.js` | Password hashing (bcrypt), token generation, validation |
| `email.js` | SendGrid email service (password reset, verification, welcome) |
| `sms.js` | Twilio SMS service (password reset, phone verification) |
| `index.js` | Barrel export |

## Usage

```javascript
import {
  // Password utilities
  hashPassword,
  verifyPassword,
  generateResetToken,
  generateVerificationCode,
  validatePasswordStrength,

  // Email utilities
  sendPasswordResetEmail,
  sendEmailVerification,
  sendWelcomeEmail,
  isEmailConfigured,

  // SMS utilities
  sendPasswordResetSMS,
  sendPhoneVerificationSMS,
  isSmsConfigured,
  validatePhoneNumber
} from '../lib/auth/index.js';
```

## Environment Variables

```bash
# SendGrid (Email)
SENDGRID_API_KEY=SG.xxx
SENDGRID_FROM_EMAIL=noreply@vectopilot.com

# Twilio (SMS)
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=+1xxxxx

# App
APP_URL=https://vectopilot.com
```

## Password Requirements

- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number

## Token Expiry

| Type | Expiry |
|------|--------|
| Password reset link (email) | 1 hour |
| Verification code (SMS) | 15 minutes |

## See Also

- [server/api/auth/](../../api/auth/) - Auth API endpoints
- [shared/schema.js](../../../shared/schema.js) - Database tables
