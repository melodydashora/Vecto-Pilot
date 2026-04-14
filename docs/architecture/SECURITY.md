# SECURITY.md — Security Posture and Hardening Plan

> **Canonical reference** for the current security implementation and known gaps across the entire system.
> Last updated: 2026-04-10

---

## Table of Contents

1. [Authentication Security](#1-authentication-security)
2. [CORS Configuration](#2-cors-configuration)
3. [Rate Limiting](#3-rate-limiting)
4. [Input Validation](#4-input-validation)
5. [SQL Injection Prevention](#5-sql-injection-prevention)
6. [XSS Prevention](#6-xss-prevention)
7. [API Key Management](#7-api-key-management)
8. [Unauthenticated Endpoints](#8-unauthenticated-endpoints)
9. [Security Headers](#9-security-headers)
10. [HTTPS/TLS](#10-httpstls)
11. [Recent Security Fixes](#11-recent-security-fixes)
12. [Current State](#12-current-state)
13. [Known Gaps](#13-known-gaps)
14. [TODO — Hardening Work](#14-todo--hardening-work)

---

## 1. Authentication Security

See `AUTH.md` for full details. Summary of security-relevant aspects:

### Token Format

Custom `userId.hmacSha256Signature` — NOT standard JWT. No `exp`, `iat`, `iss`, `aud` claims. Verification is HMAC-only.

**Secret:** `JWT_SECRET` env var (required in prod). Dev fallback: `REPLIT_DEVSERVER_INTERNAL_ID`.

### Session TTL

| Limit | Duration | Enforcement |
|-------|----------|-------------|
| Sliding window | 60 min from `last_active_at` | Middleware check on every request |
| Hard limit | 2 hours from `session_start_at` | Middleware check on every request |

### Service Account Auth

Header: `x-vecto-agent-secret`. Validated via `crypto.timingSafeEqual()` — timing-attack safe.

### Fail-Closed

DB errors in auth middleware return **503** (not pass-through). Explicit fail-closed design.

### Password Security

- **bcrypt** with 12 rounds
- Account lockout: 5 failures = 15-min lock
- Password requirements: 8+ chars, 1 uppercase, 1 lowercase, 1 digit
- Reset: 64-char hex token (1-hr expiry) or 6-digit SMS code (15-min expiry)

### OAuth CSRF

Google OAuth uses state parameter: 64-char hex, stored in `oauth_states` table with 10-min expiry, one-time use.

---

## 2. CORS Configuration

**File:** `server/bootstrap/middleware.js` (lines 55–78)

### Allowed Origins

1. Replit deployment domains: `*.replit.dev`, `*.repl.co`, `*.replit.app`
2. Localhost: `http://localhost` or `http://localhost:PORT`
3. Production: `https://vectopilot.com`, `https://www.vectopilot.com`
4. Environment variable: `CORS_ALLOWED_ORIGINS` (comma-separated)
5. **No-origin requests: ALLOWED** — for server-to-server, Siri Shortcuts, curl

### Credentials

`credentials: true` — cookies and auth headers allowed cross-origin.

---

## 3. Rate Limiting

**File:** `server/middleware/rate-limit.js`

| Limiter | Limit | Applied To |
|---------|-------|------------|
| Global API | 100/min per IP | All `/api/*` routes |
| Expensive endpoints | 5/min | blocks-fast, briefing generate/refresh |
| Chat/streaming | 3/min | POST /api/chat |
| Translation | 30/min | POST /api/translate (composite: IP + deviceId) |
| Health monitoring | 200/min | /health, /api/health, /diagnostics |
| Concierge: profile | 20/min | GET /api/concierge/p/:token |
| Concierge: weather | 10/min | GET /api/concierge/p/:token/weather |
| Concierge: explore | 5/min | POST /api/concierge/p/:token/explore |
| Concierge: ask | 3/min | POST /api/concierge/p/:token/ask |
| Concierge: feedback | 2/min | POST /api/concierge/p/:token/feedback |

### Missing Rate Limiters

- No dedicated auth endpoint limiter (login, register use global 100/min)
- No per-user rate limiting on any endpoint

---

## 4. Input Validation

### Framework: Zod (TypeScript)

**File:** `server/middleware/validation.js`

Zod schemas defined for:
- UUID validation
- Action payloads (dwell_ms, metadata)
- Location (lat: -90–90, lng: -180–180)
- Snapshot (user_lat, user_lng)

### Coach Action Validation

**File:** `server/api/rideshare-coach/validate.js` (428 lines)

Full Zod schemas for all 11 action tag types (SAVE_NOTE, DEACTIVATE_EVENT, ZONE_INTEL, etc.) with field-level constraints.

### Intelligence Route Sanitization

`server/api/intelligence/index.js` (lines 115–127): Uses `sanitizeString()` and `sanitizeNumber()` on query params.

---

## 5. SQL Injection Prevention

### ORM: Drizzle ORM

All queries use Drizzle's typed query builder with **automatic parameterization**:

```javascript
// Safe — Drizzle parameterizes ${trimmed}
await db.execute(sql`SELECT * FROM market_cities WHERE state ILIKE ${trimmed}`);
```

### Raw SQL

Rare cases use Drizzle's `sql` template tag, which also parameterizes. **No manual string concatenation found** in any API route.

---

## 6. XSS Prevention

### Content Security Policy (CSP)

**File:** `server/bootstrap/middleware.js` (lines 37–53)

```javascript
contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", "https://maps.googleapis.com", "https://maps.gstatic.com"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com"],
    imgSrc: ["'self'", "data:", "blob:", "https://maps.googleapis.com", ...],
    objectSrc: ["'none'"],
    baseUri: ["'self'"]
  }
}
```

### React Auto-Escaping

React automatically escapes text content. No `dangerouslySetInnerHTML` usage found in core components.

### Helmet

All standard security headers enabled via Helmet middleware.

### HTML Sanitization

**No explicit DOMPurify or sanitize-html** library found. Relies on React's built-in escaping and CSP.

---

## 7. API Key Management

### External API Keys (Server-Side Only)

| Key | Provider | Notes |
|-----|----------|-------|
| `ANTHROPIC_API_KEY` | Claude | Strategy, venue filter |
| `OPENAI_API_KEY` | GPT-5, TTS | Strategy, scoring, voice |
| `GEMINI_API_KEY` | Gemini | Briefing, coach, concierge, events |
| `TOMTOM_API_KEY` | TomTom | Traffic data |
| `SENDGRID_API_KEY` | SendGrid | Password reset emails |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Twilio | Password reset SMS |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google | OAuth |
| `UBER_CLIENT_ID`, `UBER_CLIENT_SECRET` | Uber | Platform data OAuth |
| `JWT_SECRET` | Internal | Token signing |
| `VECTO_AGENT_SECRET` | Internal | Service account auth |

### Client-Side Keys

| Key | Purpose | Risk |
|-----|---------|------|
| `VITE_GOOGLE_MAPS_API_KEY` | Maps rendering | Exposed to client — restricted to Maps JS API only |

### Key Rotation

**No key rotation mechanism exists.** All keys are static environment variables.

---

## 8. Unauthenticated Endpoints

### Explicitly Public

| Endpoint | Reason | Risk Level |
|----------|--------|------------|
| Auth routes (login, register, reset) | Must be pre-auth | Low — credentials required |
| `GET /api/intelligence/markets-dropdown` | Signup dropdown | Low — public market names |
| `POST /api/intelligence/add-market` | Signup market creation | **Medium — write access without auth** |
| `POST /api/hooks/analyze-offer` | Siri Shortcuts (can't send JWT) | **HIGH — zero auth, accepts images** |
| Health endpoints | Monitoring | Low — minimal data |
| Concierge `/p/:token/*` | Passenger-facing | Medium — rate-limited, token-validated |
| Location geocode/weather/timezone | Utility | Medium — no user data, but burns API quota |
| `POST /api/location/snapshot` | Legacy path | **Medium — should require auth** |

### The Zero-Auth Siri Endpoint

**Route:** `POST /api/hooks/analyze-offer`
**Risk:** Any client with the URL can submit images for AI analysis. No authentication, no API key, no device registration.
**Mitigation:** URL obscurity only. Rate limiting by `device_id` (easily spoofed).

---

## 9. Security Headers

**Helmet** provides:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN` (via CSP `frameSrc: ["'self'"]`)
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (HSTS)
- `X-Robots-Tag: noindex, nofollow, noarchive` (prevent indexing)

### Bot Blocker

**File:** `server/middleware/bot-blocker.js`

Runs first in middleware chain. Blocks known bot user-agents and suspicious request patterns.

---

## 10. HTTPS/TLS

- **Development:** HTTP via Replit preview URL
- **Production:** HTTPS enforced via Replit deployment (automatic TLS)
- **Custom domain:** `vectopilot.com` — TLS managed by hosting infrastructure
- **No certificate files in codebase** — managed by Replit/hosting

---

## 11. Recent Security Fixes

| Fix | Date | Issue | Resolution |
|-----|------|-------|------------|
| F-1 | 2026-03-17 | Auth fail-open on DB error | Fail-closed: return 503 |
| F-2 | 2026-03-17 | CORS reflect-all origin | Whitelist-based origin check |
| F-6 | 2026-04-05 | Cross-user snapshot access | Use `req.auth.userId` not `req.body.userId` |
| F-7 | 2026-03-17 | Agent auth accepted any secret | Require configured `VECTO_AGENT_SECRET` |
| F-10 | 2026-03-17 | Hardcoded 'dev-secret' fallback | Removed |
| F-14 | 2026-03-17 | No share token revocation | Added `DELETE /api/concierge/token` |
| H-1 | 2026-04-10 | Missing token validation on public endpoints | Added `validateShareToken()` middleware |
| H-2 | 2026-04-10 | PII leak (phone in public profile) | Removed phone from public profile |
| H-2 | 2026-04-10 | Prompt injection via concierge context | Truncate + strip instructions from user context |
| H-3 | 2026-04-04 | XSS in chat bubbles | HTML escaping via `escapeHtml()` utility |

---

## 12. Current State

| Area | Status |
|------|--------|
| Auth middleware (requireAuth) | Working — fail-closed, session TTL |
| CORS whitelist | Working — Replit + production domains |
| Global rate limiting | Working — 100/min per IP |
| Zod input validation | Working — coach actions, routes |
| SQL injection prevention (Drizzle) | Working — all queries parameterized |
| XSS prevention (CSP + React) | Working |
| Helmet security headers | Working |
| HSTS | Working — 1 year max-age |
| OAuth CSRF protection | Working — state tokens |
| Bot blocker | Working |
| Uber token encryption (AES-256-GCM) | Working |

---

## 13. Known Gaps

1. **Zero-auth offer analysis endpoint** — PUBLIC endpoint accepts images for AI analysis. No auth, no API key, trivially abusable.
2. **No dedicated auth rate limiter** — Login/register use global 100/min. Brute-force at 99/min won't trigger account lockout.
3. **No per-user rate limiting** — A single authenticated user can exhaust LLM quota.
4. **Non-standard token format** — No `exp` claim, no rotation, no blacklist.
5. **No HTML sanitization library** — Relies on React + CSP only. Map info windows use template strings.
6. **No API key rotation** — Static env vars with no expiry.
7. **Location endpoints lack auth** — Geocode, weather, timezone are public — burns API quota.
8. **`'unsafe-inline'` in CSP** — Required for Google Maps, but weakens script protection.
9. **No audit log** — Auth events (login, logout, password reset) not logged to a security table.
10. **No WAF** — No web application firewall in front of the app.

---

## 14. TODO — Hardening Work

- [ ] **Add auth to offer analysis** — Device registration or API key (minimum: IP rate limit per device_id)
- [ ] **Dedicated auth rate limiter** — 10 login/min per IP, 5/min per email
- [ ] **Per-user rate limiting** — Track LLM calls per user, enforce budget
- [ ] **Migrate to standard JWT** — Add exp, iat, iss, aud claims
- [ ] **Token rotation** — Short-lived access tokens + refresh tokens
- [ ] **Add DOMPurify** — Sanitize any user-generated HTML (map info windows, chat)
- [ ] **API key rotation mechanism** — Scheduled rotation with grace period
- [ ] **Add auth to location utility endpoints** — Or at minimum rate-limit by IP
- [ ] **Remove `'unsafe-inline'` from CSP** — Use nonce-based approach for inline scripts
- [ ] **Security audit log** — Log all auth events to dedicated table
- [ ] **WAF evaluation** — Consider Cloudflare or AWS WAF in front of production

---

## Key Files

| File | Purpose |
|------|---------|
| `server/middleware/auth.js` | requireAuth, optionalAuth, token verification |
| `server/bootstrap/middleware.js` | CORS, Helmet, CSP, bot blocker |
| `server/middleware/rate-limit.js` | All rate limiters |
| `server/middleware/validation.js` | Zod validation middleware |
| `server/api/rideshare-coach/validate.js` | Action tag Zod schemas |
| `server/middleware/bot-blocker.js` | Bot detection |
| `server/api/hooks/analyze-offer.js` | Zero-auth endpoint |
