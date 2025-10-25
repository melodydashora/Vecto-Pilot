# RLS Toggle Guide - Development vs Production

## Quick Commands

```bash
# Check current RLS status
npm run rls:status

# Development mode (disable RLS for testing)
npm run rls:disable

# Production mode (enable RLS for security)
npm run rls:enable
```

---

## Current Status: DEVELOPMENT MODE ✅

**RLS is DISABLED on all 19 tables**
- 🔓 Unrestricted database access
- ✅ Perfect for local testing
- ⚠️ Do NOT deploy to production in this state

---

## When to Use Each Mode

### 🔓 Development Mode (`npm run rls:disable`)
**Use when:**
- Testing locally on your machine
- Running curl/Postman API tests
- Debugging database queries
- Developing new features

**Benefits:**
- No permission errors
- Can test with any user_id (or NULL)
- Faster query debugging
- No session variable setup needed

### 🔒 Production Mode (`npm run rls:enable`)
**Use when:**
- Deploying to production
- Publishing your app
- Exposing Neon Data API publicly
- After adding user authentication

**Benefits:**
- Database-level security enforcement
- Users can only see their own data
- Protection against Data API exposure
- Defense-in-depth architecture

---

## Before Deployment Checklist

Before you deploy to production:

```bash
# 1. Enable RLS
npm run rls:enable

# 2. Verify it's enabled
npm run rls:status
# Should show: "PRODUCTION READY (All tables secured)"

# 3. Test your app still works
# (with user authentication if implemented)

# 4. Deploy!
```

---

## How It Works

### Development (RLS OFF)
```sql
-- All queries work normally
SELECT * FROM snapshots;
-- Returns: ALL rows in the database
```

### Production (RLS ON)
```sql
-- App sets user context
SET LOCAL app.user_id = 'user-uuid-here';

-- Same query, filtered automatically
SELECT * FROM snapshots;
-- Returns: Only rows WHERE user_id = 'user-uuid-here'
```

PostgreSQL automatically filters rows based on RLS policies - no code changes needed!

---

## Troubleshooting

### Script fails with "DATABASE_URL not found"
**Fix:** Make sure `mono-mode.env` exists and contains:
```
DATABASE_URL=postgresql://...
```

### App gets permission errors after enabling RLS
**This is expected** if you don't have user authentication yet. 

**Fix:** Either:
1. Stay in development mode: `npm run rls:disable`
2. Or implement user authentication and set `app.user_id` in queries

### Need to check which tables are protected?
```bash
npm run rls:status
```

Shows detailed status for all 19 tables.

---

## Security Summary

| Mode | RLS Status | Access Control | Use Case |
|------|-----------|----------------|----------|
| **Development** | 🔓 Disabled | None | Local testing |
| **Production** | 🔒 Enabled | User-scoped | Live deployment |

**Current Mode:** Development (RLS Disabled) ✅

**Before production:** Run `npm run rls:enable` 🔒

---

## Files Reference

- **Script:** `scripts/toggle-rls.js`
- **Policies:** `migrations/003_rls_security.sql`
- **Documentation:** `RLS_SECURITY_IMPLEMENTATION.md`
- **This Guide:** `RLS_TOGGLE_GUIDE.md`

---

## Pro Tips

✅ **Always check status before deploying:**
```bash
npm run rls:status
```

✅ **Keep RLS disabled during development** - It makes testing much easier

✅ **Enable RLS before production** - It's your last line of defense

✅ **Test your app after enabling RLS** - Make sure authentication works correctly

---

**That's it!** Simple 3-command system to toggle between development and production security modes. 🎉
