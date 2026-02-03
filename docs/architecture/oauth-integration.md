# OAuth Integration Architecture

## Overview

Vecto-Pilot-Ultimate supports OAuth integrations with rideshare platforms to sync earnings data and provide personalized insights.

## Supported Platforms

| Platform | Status | Features |
|----------|--------|----------|
| Uber | Implemented | Trip history, earnings, payments |
| Lyft | Planned | - |
| DoorDash | Planned | - |

## Architecture

### Database Schema

```
uber_connections
├── id (UUID, PK)
├── user_id (FK → users)
├── uber_driver_id
├── access_token_encrypted
├── refresh_token_encrypted
├── token_expires_at
├── scopes[]
├── connected_at
├── last_sync_at
└── is_active

uber_trips
├── id (UUID, PK)
├── user_id (FK → users)
├── uber_trip_id (UNIQUE)
├── fare
├── distance_miles
├── pickup_time / dropoff_time
├── pickup_location / dropoff_location (JSONB)
├── vehicle_type
└── raw_data (JSONB)

uber_payments
├── id (UUID, PK)
├── user_id (FK → users)
├── uber_payment_id (UNIQUE)
├── amount
├── payment_type
├── event_time
├── related_trip_id (FK → uber_trips)
└── raw_data (JSONB)

oauth_states
├── id (UUID, PK)
├── state (UNIQUE)
├── provider
├── user_id (FK → users)
├── redirect_uri
└── expires_at
```

### Token Security

Tokens are encrypted using AES-256-GCM before storage:

```javascript
// Encryption format: iv:authTag:ciphertext (all base64)
const encrypted = encryptToken(accessToken);
// → "abc123...:def456...:ghi789..."

const decrypted = decryptToken(encrypted);
// → original token
```

**Required Environment:**
```bash
TOKEN_ENCRYPTION_KEY=<32-byte-hex-string>
# Generate with: openssl rand -hex 32
```

## OAuth Flow

### 1. Initiate Connection

```
User clicks "Connect Uber"
  ↓
GET /api/auth/uber
  ↓
Generate CSRF state, store in oauth_states
  ↓
Redirect to Uber OAuth URL
```

### 2. Authorization

```
User logs into Uber, grants permissions
  ↓
Uber redirects to callback with code + state
```

### 3. Callback

```
GET /api/auth/uber/callback?code=xxx&state=yyy
  ↓
Validate state against oauth_states
  ↓
Exchange code for tokens
  ↓
Encrypt and store tokens in uber_connections
  ↓
Redirect to signup page with success flag
```

### 4. Token Refresh

```
POST /api/auth/uber/refresh
  ↓
Check if token is expired (with 5 min buffer)
  ↓
Call Uber refresh endpoint
  ↓
Update stored tokens
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/uber` | GET | Initiate OAuth flow |
| `/api/auth/uber/callback` | GET | Handle OAuth callback |
| `/api/auth/uber/disconnect` | POST | Revoke and remove connection |
| `/api/auth/uber/refresh` | POST | Refresh access token |
| `/api/auth/uber/status` | GET | Get connection status |

## Webhook Handler

Receives real-time updates from Uber:

```
POST /api/webhooks/uber
```

**Supported Events:**
- `trips.completed` - New trip earnings
- `payments.processed` - Payment notifications
- `driver.status_changed` - Online/offline status

**Signature Verification:**
```javascript
// HMAC-SHA256 verification
const signature = req.headers['x-uber-signature'];
const isValid = verifySignature(rawBody, signature);
```

## Environment Configuration

```bash
# Uber OAuth
UBER_CLIENT_ID=your-client-id
UBER_CLIENT_SECRET=your-client-secret
UBER_REDIRECT_URI=https://yourdomain.com/api/auth/uber/callback
UBER_WEBHOOK_SECRET=your-webhook-secret

# Token Security
TOKEN_ENCRYPTION_KEY=<32-byte-hex-string>
```

## Frontend Integration

### SignUpPage

The signup page includes:
- AppSelectionChips - Select platforms you drive for
- Connect buttons for OAuth-enabled platforms
- Connected state indicators

```tsx
<AppSelectionChips
  selectedApps={['uber', 'lyft']}
  connectedApps={['uber']}  // Shows "Connected" badge
  onConnect={handleConnectApp}
  showConnectButtons={true}
/>
```

### OAuth Callback Handling

```tsx
// Check for oauth callback in URL
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('uber_connected') === 'true') {
    setConnectedApps(prev => [...prev, 'uber']);
    // Restore form data from localStorage
  }
}, []);
```

## Testing

Run OAuth tests:
```bash
npm test -- tests/auth/uber-oauth.test.js
```

## Security Considerations

1. **CSRF Protection** - State parameter validated on callback
2. **Token Encryption** - All tokens encrypted at rest
3. **Webhook Verification** - HMAC-SHA256 signature check
4. **Token Refresh** - Automatic refresh before expiration
5. **Scope Limitation** - Request only necessary scopes
