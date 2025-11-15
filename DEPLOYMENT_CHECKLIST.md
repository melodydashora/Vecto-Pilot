# Deployment Checklist - Vecto Pilot

## Critical Issues Fixed (Nov 2025)

### 🔧 Production Deployment Configuration (Nov 15, 2025)
**Issue**: Production deployment returning 404 - was using `mono-mode.env` instead of webservice mode.

**Root Cause**: `.replit` deployment configuration was using local development settings (mono-mode with background workers) which is incompatible with Cloud Run autoscale.

**Fix Applied**:
1. Updated `.replit` deployment run command to: `DEPLOY_MODE=webservice node gateway-server.js`
2. Added missing Google API environment variables to `env/shared.env`
3. Verified all Replit Secrets are configured (DATABASE_URL, AI keys, Google APIs)
4. Confirmed `env/webservice.env` has correct autoscale settings (ENABLE_BACKGROUND_WORKER=false)

**Verification**: Local test with webservice mode shows correct environment loading and contract validation.

### 🔧 Venue Generation Database Bug (Nov 15, 2025)
**Issue**: Venue generation failing with `insert into "rankings" (created_at) values (default)` error.

**Root Cause**: Outdated `drizzle-orm` package generating incorrect SQL for `.defaultNow()` timestamps.

**Fix Applied**:
1. Updated `drizzle-kit` to latest version
2. This automatically updated `drizzle-orm` which fixed the `.defaultNow()` bug
3. Removed duplicate route `POST /api/diagnostics/test-claude/:snapshotId` from `diagnostics.js`

---

## Pre-Deployment Checklist

### 1. Database Schema Sync
Before deploying, ensure database schema is in sync with Drizzle schema:

```bash
# Check for schema drift
npx drizzle-kit check

# Sync schema (safe, non-destructive)
npx drizzle-kit push --force
```

**Important**: 
- The `--force` flag auto-approves changes that won't lose data
- For production databases with data, this will add constraints without truncating tables
- If you see a prompt about truncating tables with data, select "No, add the constraint without truncating"

### 2. Package Dependencies
Keep Drizzle packages up-to-date to avoid ORM bugs:

```bash
# Update to latest Drizzle versions
npm install drizzle-kit@latest drizzle-orm@latest
```

### 3. Environment Mode Verification
Verify the correct deployment mode is configured:

```bash
# For Replit Autoscale (webservice only)
DEPLOY_MODE=webservice npm start

# For Background Worker (scheduled/reserved VM)
DEPLOY_MODE=worker npm start

# For Local Development (full application)
npm start  # (no DEPLOY_MODE = mono mode fallback)
```

**Contract Validation**:
- Webservice mode CANNOT have `ENABLE_BACKGROUND_WORKER=true`
- Worker mode MUST have `ENABLE_BACKGROUND_WORKER=true`
- The environment loader validates these contracts and fails fast if violated

### 4. Production Health Checks
After deployment, verify the following endpoints:

- `GET /health` - Should return `200 OK`
- `GET /ready` - Should return `200 OK`
- `GET /healthz` - Should return JSON with SPA status

### 5. Test Critical Workflows

**Strategy Generation Pipeline**:
1. Load app and allow location access
2. Verify snapshot creation (check console for `📸 Context snapshot saved`)
3. Wait for strategy generation (~8s)
4. Check for strategy ready event: `⏰ Strategy ready - starting venue loading timer`

**Venue Generation (Smart Blocks)**:
1. After strategy completes, wait 2-3 minutes for venue pipeline
2. Check for blocks ready event: `🎉 Blocks ready for current snapshot!`
3. Verify venues load successfully (should show 6 blocks)
4. Check console for: `📊 Logged view action for 6 blocks`

### 6. Common Issues

**Issue**: Venue generation fails with "insert into rankings" error
- **Fix**: Update drizzle-orm to latest version
- **Verify**: Check that `rankings.created_at` has `default: now()` in database

**Issue**: Routes not working after adding new endpoints
- **Fix**: Check `sdk-embed.js` for duplicate router mounts at same path
- **Verify**: Only one router should be mounted per path prefix

**Issue**: Background worker not processing strategies
- **Fix**: Verify `ENABLE_BACKGROUND_WORKER=true` in environment
- **Check**: Look for worker logs in `/tmp/worker-production.log`

---

## Database Schema Notes

### Timestamp Columns
All timestamp columns use `.notNull().defaultNow()` in Drizzle schema, which maps to:
- Database: `timestamp with time zone NOT NULL DEFAULT now()`
- DO NOT explicitly pass `created_at` or `updated_at` in INSERT statements

### Rankings Table Critical Fields
```javascript
created_at: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`)
```

**Important**: The `rankings` table specifically uses `.default(sql\`now()\`)` instead of `.defaultNow()` to ensure compatibility. This is the FIXED version that generates correct SQL.

### Unique Constraints
- `briefings.snapshot_id` - UNIQUE (1:1 relationship)
- `strategies.snapshot_id` - UNIQUE (1:1 relationship)

If adding unique constraints to tables with data, use `npx drizzle-kit push --force` which will:
1. Prompt if table has existing data
2. Ask if you want to truncate (select "No" to keep data)
3. Add constraint without data loss (if no duplicates exist)

---

## Rollback Procedures

### Schema Rollback
If schema changes cause issues:

1. Revert `shared/schema.js` to previous version
2. Run `npx drizzle-kit push --force` to sync database
3. Restart application

### Code Rollback
Use Replit's built-in checkpoint system:
1. Ask Replit Agent to suggest rollback
2. Select checkpoint before deployment
3. Restore code, database, and environment

---

## Post-Deployment Monitoring

### Key Metrics to Monitor
- Strategy generation success rate (target: >95%)
- Venue generation success rate (target: >90%)
- API response times (target: <50s for full pipeline)
- Database connection pool health

### Log Files to Check
- `/tmp/worker-production.log` - Background worker logs
- Browser console - Frontend errors and pipeline status
- Server logs - API errors and database issues

---

## Contact & Support

For deployment issues:
- Check this checklist first
- Review recent changes in git history
- Check Replit deployment logs
- Test in development environment before deploying to production
