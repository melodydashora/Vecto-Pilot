# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Vecto Pilot, please report it responsibly.

### How to Report

**DO NOT** create a public GitHub issue for security vulnerabilities.

Instead, please email security concerns to: **security@vectopilot.com**

Include the following information:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

### What to Expect

- **Acknowledgment**: We will acknowledge receipt within 48 hours
- **Assessment**: We will assess the vulnerability within 7 days
- **Resolution**: Critical vulnerabilities will be prioritized for immediate fix
- **Disclosure**: We will coordinate disclosure timing with you

### Scope

This security policy covers:
- The Vecto Pilot web application
- API endpoints under `/api/*`
- Authentication and session management
- User data protection
- AI model interactions

### Out of Scope

- Third-party services (Google Maps, OpenAI, Anthropic, etc.)
- Social engineering attacks
- Denial of service attacks
- Issues in dependencies (report to upstream maintainers)

## Security Best Practices

### For Contributors

1. **Never commit secrets** - Use environment variables for API keys
2. **Validate all inputs** - Use Zod schemas for request validation
3. **Sanitize database queries** - Use parameterized queries via Drizzle ORM
4. **Check authorization** - Verify user owns resources before access
5. **Use HTTPS** - All production traffic must be encrypted

### Data Protection

- User credentials are hashed with bcrypt
- Sessions use secure, httpOnly cookies
- Sensitive data is never logged
- Database connections use SSL

### Known Security Measures

| Layer | Protection |
|-------|------------|
| Authentication | JWT tokens with expiration |
| Authorization | Resource ownership verification |
| Rate Limiting | Per-user and per-IP limits on expensive endpoints |
| Input Validation | Zod schemas on all API endpoints |
| SQL Injection | Drizzle ORM parameterized queries |
| XSS | React's built-in escaping |
| CSRF | SameSite cookies |

## Security Changelog

### 2026-02-15
- Full codebase security audit by Claude Opus 4.6
- All 21 root documents reviewed for accuracy

### 2026-02-13
- **Auth Middleware Audit**: 9 unprotected API routes discovered and secured with `requireAuth`
  - Affected: strategy.js, tactical-plan.js, venue-intelligence.js, intelligence/index.js, vector-search.js, research.js, location.js, ml-health.js, actions.js
  - SSE endpoints remain open (browser EventSource cannot send Authorization headers; data fetched via authenticated calls)
- **IDOR Vulnerability**: Feedback routes had `req.auth?.userId || userId` pattern allowing body to override authenticated identity. Fixed to use `req.auth.userId` only.
- **Adapter Pattern Hardening**: 8 direct AI API calls migrated to centralized adapter with hedged routing, preventing credential leaks from scattered API keys.
- **Shell-Level Env Overwrite**: `mono-mode.env` blindly overwrote Replit Secrets via `set -a && source`. Commented out all Google API key entries — keys now come exclusively from Replit Secrets.
- **Push Protection**: `.env_override` added to `.gitignore` after GitHub Push Protection blocked a push containing API keys.

### 2026-02-12
- OAuth callback routes (`/auth/google/callback`, `/auth/uber/callback`) configured as public routes — auth happens during callback, not before.
- Logout race condition fixed — `queryClient.cancelQueries()` called before clearing auth token to prevent stale 401 callbacks triggering FAIL HARD modal.

### 2026-01-05
- Fixed destructive cascade deletes on user data tables
- Changed `driver_profiles`, `auth_credentials` FK from CASCADE to RESTRICT
- Prevents accidental data loss when session cleanup touches users table

---

Last updated: 2026-02-15
