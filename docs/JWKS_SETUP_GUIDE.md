# JWKS Setup Guide - RS256 Authentication for Neon RLS

**Status:** ✅ Infrastructure Ready  
**Purpose:** Production-ready JWT authentication with Neon Row Level Security

---

## 🎯 Quick Start

### What You Have Now

✅ **RS256 Keypair** → `keys/private.pem` (secret) + `keys/public.pem`  
✅ **JWKS File** → `public/.well-known/jwks.json` (public key in JSON Web Key format)  
✅ **Token Signing Script** → `scripts/sign-token.mjs` (create test JWTs)  
✅ **JWT Helper Functions** → `migrations/004_jwt_helpers.sql` (SQL functions for RLS)  
✅ **Security** → `.gitignore` protects private.pem from accidental commits

---

## 📋 Step-by-Step: Deploy to Production

### Step 1: Deploy Your Application

Deploy Vecto Pilot™ to get a public URL (e.g., via Replit Deployment):

```bash
# Your app will be available at:
https://<your-domain>.replit.app
```

**JWKS URL will be:**
```
https://<your-domain>.replit.app/.well-known/jwks.json
```

### Step 2: Verify JWKS is Accessible

```bash
# Test that your JWKS is publicly accessible
curl -s https://<your-domain>.replit.app/.well-known/jwks.json | jq

# Expected output:
{
  "keys": [
    {
      "kty": "RSA",
      "n": "tiYstL_s8kL5rG...",
      "e": "AQAB",
      "kid": "vectopilot-rs256-k1",
      "alg": "RS256",
      "use": "sig"
    }
  ]
}
```

### Step 3: Register JWKS in Neon Console

1. **Open Neon Console:** https://console.neon.tech
2. **Navigate to:** Your Project → Settings → Authentication
3. **Add Auth Provider:**
   - **JWKS URL:** `https://<your-domain>.replit.app/.well-known/jwks.json`
   - **Issuer:** `https://vectopilot.app`
   - **Audience:** `vectopilot-api`
4. **Save Configuration**

### Step 4: Apply JWT Helper Functions to Database

```bash
# Connect to your database and run the migration
psql "$DATABASE_URL_UNPOOLED" -f migrations/004_jwt_helpers.sql

# Verify functions were created
psql "$DATABASE_URL_UNPOOLED" -c "
  SELECT routine_name, routine_type 
  FROM information_schema.routines 
  WHERE routine_schema = 'app' 
  ORDER BY routine_name;
"

# Expected output:
#  routine_name    | routine_type 
# -----------------+--------------
#  is_authenticated | FUNCTION
#  jwt_claims       | FUNCTION
#  jwt_role         | FUNCTION
#  jwt_sub          | FUNCTION
#  jwt_tenant       | FUNCTION
```

### Step 5: Enable RLS on Your Tables

For each table that needs user-scoped security:

```sql
-- Example: Protect snapshots table
ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only SELECT their own data
CREATE POLICY p_snapshots_select ON snapshots
  FOR SELECT TO PUBLIC
  USING (app.is_authenticated() AND user_id = app.jwt_sub());

-- Policy: Users can only INSERT/UPDATE/DELETE their own data
CREATE POLICY p_snapshots_write ON snapshots
  FOR ALL TO PUBLIC
  USING (user_id = app.jwt_sub())
  WITH CHECK (user_id = app.jwt_sub());
```

**Apply to all user-scoped tables:**
- `snapshots`
- `blocks`
- `venues`
- `feedback_venues`
- `feedback_strategies`
- `feedback_app`
- `ml_*` tables (if user-scoped)

### Step 6: Test Authentication Flow

**Generate a test JWT:**
```bash
# Create a token for user_123
node scripts/sign-token.mjs user_123

# Output:
# eyJhbGciOiJSUzI1NiIsImtpZCI6InZlY3RvcGlsb3QtcnMyNTYtazEifQ...
```

**Test with valid JWT:**
```bash
# Copy the token from above
TOKEN="eyJhbGciOiJSUzI1NiIsImtpZCI6InZlY3RvcGlsb3QtcnMyNTYtazEifQ..."

# Query with authentication
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  "https://api.neon.tech/sql/v2?query=SELECT%20app.jwt_sub()%20as%20user_id" | jq

# Expected: { "user_id": "user_123" }
```

**Test without JWT (should fail):**
```bash
# Query without authentication
curl -s \
  "https://api.neon.tech/sql/v2?query=SELECT%20*%20FROM%20snapshots" | jq

# Expected: Error or 0 rows (RLS blocks access)
```

### Step 7: Enable RLS Protection

```bash
# Enable RLS on all 19 tables
npm run rls:enable

# Verify RLS is active
npm run rls:status

# Expected output:
# RLS Status Report:
# ==================
# ✅ snapshots (enabled)
# ✅ blocks (enabled)
# ✅ venues (enabled)
# ... (all 19 tables)
```

---

## 🔐 Security Architecture

### Key Security Layers

1. **Asymmetric Cryptography (RS256)**
   - Private key (`keys/private.pem`) signs tokens → NEVER expose
   - Public key (in JWKS) verifies tokens → Safe to publish
   - Key rotation supported via multiple kids in JWKS

2. **JWT Claims Structure**
   ```json
   {
     "sub": "user_123",           // User ID (required)
     "tenant_id": "acme_corp",    // Multi-tenant support (optional)
     "role": "authenticated",     // Role-based access (optional)
     "iss": "https://vectopilot.app",
     "aud": "vectopilot-api",
     "iat": 1761407116,
     "exp": 1761408016            // 15-minute expiry
   }
   ```

3. **Row Level Security Policies**
   - **User-scoped:** `user_id = app.jwt_sub()`
   - **Tenant-scoped:** `tenant_id = app.jwt_tenant()`
   - **Role-based:** `app.jwt_role() IN ('admin', 'user')`
   - **Public-read:** Allow SELECT without auth, protect writes

4. **Defense in Depth**
   - **Layer 1:** Application auth (Express middleware)
   - **Layer 2:** Database RLS (automatic via Neon)
   - **Layer 3:** Network isolation (VPC/firewall)

---

## 🔄 Key Rotation Strategy

### Why Rotate Keys?

- **Security best practice:** Limit blast radius if key is compromised
- **Compliance:** Many standards require regular rotation (90-180 days)
- **Zero downtime:** JWKS supports multiple keys simultaneously

### Rotation Process

**Step 1: Generate new keypair**
```bash
# Generate k2 keypair
openssl genrsa -out keys/private-k2.pem 2048
openssl rsa -in keys/private-k2.pem -pubout -out keys/public-k2.pem
```

**Step 2: Add k2 to JWKS (alongside k1)**
```js
// Update scripts/make-jwks.mjs to include both keys
const jwks = {
  keys: [
    jwkPub1,  // vectopilot-rs256-k1 (old)
    jwkPub2   // vectopilot-rs256-k2 (new)
  ]
};
```

**Step 3: Deploy updated JWKS**
```bash
node scripts/make-jwks.mjs
# Redeploy your app - JWKS now has both keys
```

**Step 4: Start signing with k2**
```js
// Update sign-token.mjs to use k2
.setProtectedHeader({ alg: 'RS256', kid: 'vectopilot-rs256-k2' })
```

**Step 5: Wait for k1 tokens to expire**
```bash
# Since tokens expire in 15 minutes, wait 20 minutes
# All active tokens are now using k2
```

**Step 6: Remove k1 from JWKS**
```js
// Remove k1 from JWKS
const jwks = {
  keys: [
    jwkPub2   // Only k2 now
  ]
};
```

**Step 7: Delete k1 private key**
```bash
rm keys/private.pem keys/public.pem
mv keys/private-k2.pem keys/private.pem
mv keys/public-k2.pem keys/public.pem
```

**Recommended schedule:** Rotate every 90 days

---

## 🧪 Testing Checklist

### Pre-Deployment Tests

- [ ] JWKS file exists: `public/.well-known/jwks.json`
- [ ] JWKS is valid JSON with `keys` array
- [ ] Private key exists: `keys/private.pem` (not in git)
- [ ] Can generate test token: `node scripts/sign-token.mjs user_test`
- [ ] Token has correct structure (3 parts separated by `.`)
- [ ] Token can be decoded at https://jwt.io

### Post-Deployment Tests

- [ ] JWKS URL is publicly accessible
- [ ] JWKS URL returns valid JSON with kid, kty, alg
- [ ] Neon has JWKS URL registered
- [ ] JWT helper functions exist in database
- [ ] RLS is enabled on protected tables
- [ ] Valid JWT can query user's data
- [ ] Request without JWT is blocked by RLS
- [ ] Request with expired JWT is rejected

### Performance Tests

- [ ] Token signing takes < 10ms
- [ ] Token verification by Neon takes < 50ms
- [ ] RLS policies add < 5ms query overhead
- [ ] No N+1 queries from RLS joins

---

## 📊 Troubleshooting

### Issue: JWKS URL returns 404

**Cause:** Public folder not served correctly  
**Fix:**
```js
// In gateway-server.js
app.use(express.static('public'));
```

### Issue: "Invalid signature" error

**Cause:** JWKS kid doesn't match token kid  
**Fix:**
```bash
# Verify kid matches in both files
cat public/.well-known/jwks.json | jq '.keys[0].kid'
# Should output: "vectopilot-rs256-k1"

# Check token header
node -e "console.log(JSON.parse(Buffer.from('HEADER_PART','base64')))"
# Should show: {"alg":"RS256","kid":"vectopilot-rs256-k1"}
```

### Issue: RLS blocks all queries

**Cause:** JWT not being passed or not valid  
**Fix:**
```sql
-- Debug query to see JWT claims
SELECT current_setting('request.jwt.claims', true);

-- If NULL, JWT isn't reaching the database
-- Check Authorization header format: "Bearer <token>"
```

### Issue: Token expires too quickly

**Cause:** 15-minute expiry too short for long-running operations  
**Fix:**
```js
// Increase expiry in sign-token.mjs
.setExpirationTime('1h')  // or '2h', '4h', etc.

// Balance security vs. UX
// Recommended: 15m-1h for interactive, 4h-8h for background jobs
```

---

## 🏗️ Production Deployment Checklist

### Before Going Live

- [ ] Private key stored securely (not in git, not in env vars)
- [ ] JWKS URL uses HTTPS (not HTTP)
- [ ] Token expiry appropriate for use case (15m-1h)
- [ ] RLS enabled on all sensitive tables
- [ ] RLS policies tested with real user IDs
- [ ] Key rotation schedule documented (90 days)
- [ ] Monitoring alerts for auth failures
- [ ] Rate limiting on token generation endpoints
- [ ] Token refresh flow implemented (if long sessions needed)

### After Launch

- [ ] Monitor JWT verification latency
- [ ] Track RLS policy performance
- [ ] Set up alerts for expired JWKS
- [ ] Document incident response for compromised keys
- [ ] Schedule first key rotation (90 days)

---

## 🔗 Quick Reference

| Resource | Location |
|----------|----------|
| Private Key | `keys/private.pem` |
| Public Key | `keys/public.pem` |
| JWKS File | `public/.well-known/jwks.json` |
| Generate JWKS | `node scripts/make-jwks.mjs` |
| Sign Token | `node scripts/sign-token.mjs <user_id> [tenant_id]` |
| SQL Helpers | `migrations/004_jwt_helpers.sql` |
| Enable RLS | `npm run rls:enable` |
| Check RLS | `npm run rls:status` |
| Test JWT | https://jwt.io |
| Neon Console | https://console.neon.tech |

---

## 📚 Additional Resources

- **JWKS Specification:** https://datatracker.ietf.org/doc/html/rfc7517
- **JWT Best Practices:** https://datatracker.ietf.org/doc/html/rfc8725
- **Neon RLS Guide:** https://neon.tech/docs/guides/row-level-security
- **RS256 vs HS256:** https://auth0.com/blog/rs256-vs-hs256/

---

**Need help?** Check the troubleshooting section or open an issue.

**Ready to deploy?** Follow the step-by-step guide above.
