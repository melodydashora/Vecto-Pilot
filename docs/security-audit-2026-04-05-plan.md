# Security Audit Plan — CodeQL & Dependabot Findings (2026-04-05)

## Objective
Resolve 121 CodeQL alerts and 18 Dependabot vulnerabilities reported by GitHub.

## Findings Summary

| Category | Severity | Count | Status |
|----------|----------|-------|--------|
| A. Type confusion (parameter tampering) | Critical | 19 | ✅ FIXED |
| B. Server-side request forgery (SSRF) | Critical | 1 | ✅ FIXED |
| C. Missing rate limiting | High | 30+ | ✅ FIXED |
| D. Insecure Helmet configuration | High | 1 | ✅ FIXED |
| E. Polynomial ReDoS | High | 3 | ✅ FIXED |
| F. Externally-controlled format string | High | 1 | ✅ FIXED |
| Dependabot: electron/got (dev-only) | Low | 18 | DISMISSED |

## Approach

### Shared Utility: `server/lib/utils/sanitize.js` (NEW)
- `sanitizeString(val)` — coerces arrays/objects to string scalar
- `sanitizeNumber(val)` — safe numeric coercion
- `sanitizeBoolean(val)` — truthy string to boolean
- `sanitizeIp(val)` — validates IPv4/IPv6 format, rejects injection
- `sanitizeForLog(val)` — strips control chars, escapes `%`, truncates

### A. Type Confusion — Root Cause & Fix
**Root cause:** Express `qs` parser allows `?p[]=a&p[]=b` (arrays) and `?p[k]=v` (objects).
Code like `param.length < 2` checks array length, not string length.

**Fix:** Apply `sanitizeString()` at every `req.query`/`req.body` destructuring point.

**Files fixed:**
- `server/api/intelligence/index.js` (2 handlers)
- `server/api/strategy/blocks-fast.js` (GET + POST handlers)
- `server/api/location/location.js` (2 handlers)
- `server/api/platform/index.js` (1 handler)
- `server/api/health/ml-health.js` (1 handler)

Downstream functions (`strategy-utils.js`, `enhanced-smart-blocks.js`) are now safe
because the taint is removed at the entry point.

### B. SSRF — Root Cause & Fix
**Root cause:** `clientIp` from attacker-controlled headers (X-Forwarded-For)
interpolated directly into `http://ip-api.com/json/${clientIp}` URL.

**Fix:** `sanitizeIp()` validates IPv4/IPv6 format before URL construction.
Rejects path traversal (`../../`), URL injection (`@evil.com`), and non-IP strings.

### C. Rate Limiting — Root Cause & Fix
**Root cause:** `generalLimiter` existed in `rate-limit.js` but was never imported or mounted.

**Fix:**
- Added `globalApiLimiter` (100 req/min) mounted on all `/api/*` in `middleware.js`
- Added `healthLimiter` (200 req/min) for health/diagnostic endpoints
- Existing per-route limiters (`expensiveEndpointLimiter`: 5/min, `chatLimiter`: 3/min) remain as stricter overrides

### D. Helmet — Root Cause & Fix
**Root cause:** `contentSecurityPolicy: false` disabled CSP entirely.

**Fix:** Enabled CSP with SPA-compatible directives:
- `script-src: 'self' 'unsafe-inline'` (required for Vite/React)
- `connect-src`: Allows Google APIs, Replit domains, WebSocket connections
- `img-src`: Allows Google Maps tiles, Places photos, data URIs
- HSTS enabled with 1-year max-age

### E. ReDoS — Root Cause & Fix
**Root cause:** Regex pattern `\d+\.?\d*` has ambiguous quantifiers.
`\d+` and `\d*` both match digits, creating O(n²) backtracking.

**Fix:** Replaced with `\d+(?:\.\d+)?` — the decimal group is atomic (matches fully or not at all).
Added 5KB input length limit to OCR text processing functions.

### F. Format String — Root Cause & Fix
**Root cause:** `att.name` (user-controlled) interpolated into `console.warn()` first argument.
Node.js `console.warn` interprets `%s`, `%d` as format specifiers.

**Fix:** `sanitizeForLog()` strips control characters, escapes `%` → `%%`, and truncates to 100 chars.

## Dependabot (DISMISSED)
18 alerts: 17 electron + 1 got. All are dev/transitive dependencies in `package-lock.json`.
Neither `electron` nor `got` appear in `package.json` as direct dependencies.
Vecto Pilot is a web app, not an Electron app — these don't affect production.

## Test Results
- ✅ `sanitize.js` unit tests pass (type confusion, SSRF, format string vectors)
- ✅ Server starts successfully with all routes mounted
- ✅ Global rate limiting confirmed active in startup logs
