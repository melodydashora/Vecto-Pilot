# JWKS Quick Start - Get Production-Ready in 5 Minutes

**You're switching from HS256 symmetric to RS256 asymmetric auth.** Here's what's ready and what's next.

---

## ✅ What's Already Done

| Component | Status | Location |
|-----------|--------|----------|
| **RSA Keypair** | ✅ Generated | `keys/private.pem`, `keys/public.pem` |
| **JWKS File** | ✅ Created | `public/.well-known/jwks.json` |
| **Token Signer** | ✅ Ready | `node scripts/sign-token.mjs <user_id>` |
| **SQL Helpers** | ✅ Ready | `migrations/004_jwt_helpers.sql` |
| **Security** | ✅ Protected | `.gitignore` blocks private.pem |

---

## 🚀 5-Minute Production Setup

### 1. Deploy Your App (2 minutes)

```bash
# Deploy via Replit
# Your app will be at: https://<your-domain>.replit.app

# Verify JWKS is accessible:
curl https://<your-domain>.replit.app/.well-known/jwks.json
```

**Expected output:**
```json
{
  "keys": [
    {
      "kty": "RSA",
      "n": "tiYstL_s8kL5rG...",
      "kid": "vectopilot-rs256-k1",
      "alg": "RS256"
    }
  ]
}
```

### 2. Register JWKS in Neon (1 minute)

**Neon Console:** https://console.neon.tech  
**Navigate to:** Your Project → Settings → Authentication

**Add these settings:**
- **JWKS URL:** `https://<your-domain>.replit.app/.well-known/jwks.json`
- **Issuer:** `https://vectopilot.app`
- **Audience:** `vectopilot-api`

### 3. Apply SQL Helpers (1 minute)

```bash
# Run the migration
psql "$DATABASE_URL_UNPOOLED" -f migrations/004_jwt_helpers.sql

# Verify it worked
psql "$DATABASE_URL_UNPOOLED" -c "SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'app';"
```

**Expected output:**
```
   routine_name    
-------------------
 is_authenticated
 jwt_claims
 jwt_role
 jwt_sub
 jwt_tenant
```

### 4. Enable RLS (1 minute)

```bash
# Turn on RLS for all tables
npm run rls:enable

# Verify it's active
npm run rls:status
```

**Expected output:**
```
✅ snapshots (enabled)
✅ blocks (enabled)
✅ venues (enabled)
... (all 19 tables)
```

### 5. Test It Works (30 seconds)

```bash
# Generate a test token
TOKEN=$(node scripts/sign-token.mjs user_123 | grep "eyJ" | tail -1)

# Test authenticated query (should work)
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.neon.tech/sql/v2?query=SELECT%20app.jwt_sub()"

# Test unauthenticated query (should fail)
curl "https://api.neon.tech/sql/v2?query=SELECT%20*%20FROM%20snapshots"
```

---

## 🔑 How to Use in Your App

### Sign Tokens (Backend)

```javascript
import { readFileSync } from 'fs';
import { importPKCS8, SignJWT } from 'jose';

async function signToken(userId, tenantId = null) {
  const pkcs8 = readFileSync('keys/private.pem', 'utf8');
  const privateKey = await importPKCS8(pkcs8, 'RS256');
  
  const claims = { sub: userId, role: 'authenticated' };
  if (tenantId) claims.tenant_id = tenantId;
  
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'vectopilot-rs256-k1' })
    .setIssuer('https://vectopilot.app')
    .setAudience('vectopilot-api')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(privateKey);
}

// Usage:
const token = await signToken('user_123');
```

### Use Tokens (Frontend)

```javascript
// Store token in localStorage or httpOnly cookie
const token = localStorage.getItem('auth_token');

// Send with every API request
fetch('/api/snapshots', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

### Verify Tokens (Automatic via Neon RLS)

**No code needed!** Neon automatically:
1. Fetches your JWKS
2. Verifies token signature
3. Extracts JWT claims
4. Enforces RLS policies

---

## 🛡️ RLS Policy Examples

### User-Scoped (Only Your Data)

```sql
-- Users can only see their own snapshots
ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_snapshots_user ON snapshots
  FOR ALL TO PUBLIC
  USING (user_id = app.jwt_sub())
  WITH CHECK (user_id = app.jwt_sub());
```

### Tenant-Scoped (Shared Workspace)

```sql
-- Users in the same tenant can see each other's data
CREATE POLICY p_snapshots_tenant ON snapshots
  FOR SELECT TO PUBLIC
  USING (tenant_id = app.jwt_tenant());
```

### Role-Based (Admin Access)

```sql
-- Admins can see everything
CREATE POLICY p_snapshots_admin ON snapshots
  FOR ALL TO PUBLIC
  USING (app.jwt_role() = 'admin');
```

### Public Read, Auth Write

```sql
-- Anyone can read, only authenticated users can write
CREATE POLICY p_snapshots_public_read ON snapshots
  FOR SELECT TO PUBLIC
  USING (true);

CREATE POLICY p_snapshots_auth_write ON snapshots
  FOR ALL TO PUBLIC
  USING (app.is_authenticated() AND user_id = app.jwt_sub())
  WITH CHECK (user_id = app.jwt_sub());
```

---

## 🔄 Key Rotation (Every 90 Days)

```bash
# 1. Generate new key
openssl genrsa -out keys/private-k2.pem 2048
openssl rsa -in keys/private-k2.pem -pubout -out keys/public-k2.pem

# 2. Add to JWKS (edit scripts/make-jwks.mjs to include both k1 and k2)
node scripts/make-jwks.mjs

# 3. Deploy (both keys now valid)

# 4. Start signing with k2 (update sign-token.mjs kid to k2)

# 5. Wait 20 minutes (all k1 tokens expire)

# 6. Remove k1 from JWKS, delete old keys
```

---

## 🧪 Debugging Commands

```bash
# View JWKS
cat public/.well-known/jwks.json | jq

# Decode JWT (without verifying)
node -e "
  const parts = process.argv[1].split('.');
  console.log('Header:', JSON.parse(Buffer.from(parts[0], 'base64url')));
  console.log('Payload:', JSON.parse(Buffer.from(parts[1], 'base64url')));
" "YOUR_TOKEN_HERE"

# Check RLS policies
psql "$DATABASE_URL_UNPOOLED" -c "
  SELECT schemaname, tablename, policyname, cmd, qual 
  FROM pg_policies 
  WHERE schemaname = 'public' 
  ORDER BY tablename, policyname;
"

# Test SQL helpers
psql "$DATABASE_URL_UNPOOLED" -c "
  SELECT 
    app.jwt_sub() as user_id,
    app.jwt_tenant() as tenant_id,
    app.jwt_role() as role,
    app.is_authenticated() as is_authed;
"
```

---

## 📞 Next Steps

1. **Deploy** → Get your JWKS URL live
2. **Register** → Add JWKS URL to Neon Console
3. **Apply** → Run SQL migration
4. **Enable** → Turn on RLS
5. **Test** → Verify auth works end-to-end

**Stuck?** Check [`docs/JWKS_SETUP_GUIDE.md`](./JWKS_SETUP_GUIDE.md) for detailed troubleshooting.

---

**Your JWKS is production-ready.** Deploy and test it live! 🚀
