# SAVE-IMPORTANT.md - Session Architecture

## Status: ✅ IMPLEMENTED (2026-01-05)

All edge cases resolved and implementation complete. See "Implementation Details" below.

---

## THE PROBLEM (Solved)

1. ~~Client was tracking `lastSnapshotId` in React state AND sessionStorage - redundant~~
2. ~~GPS drift (10mm movements) was creating duplicate snapshots~~
3. ~~`users` table had location fields that duplicated what's in snapshots~~
4. ~~Architecture was confusing - unclear what owned what~~

---

## THE ARCHITECTURE

### Three Tables, Three Purposes

| Table | Purpose | Lifecycle |
|-------|---------|-----------|
| `driver_profiles` | **Identity** - who you are | Forever (created at signup) |
| `users` | **Session** - who's online now | Temporary (login → logout/TTL) |
| `snapshots` | **Activity** - what you did when | Forever (historical record) |

### `users` Table Schema (Session Tracking Only)

```sql
users (
  user_id             UUID PRIMARY KEY,     -- Links to driver_profiles
  device_id           TEXT NOT NULL,        -- Device making request
  session_id          UUID,                 -- Current session UUID
  current_snapshot_id UUID,                 -- Their ONE active snapshot
  session_start_at    TIMESTAMP NOT NULL,   -- When session began (2hr hard limit)
  last_active_at      TIMESTAMP NOT NULL,   -- Last activity (60 min sliding window)
  created_at          TIMESTAMP NOT NULL,
  updated_at          TIMESTAMP NOT NULL
)
```

**NO location fields in users table** - all location data lives in snapshots.

---

## SESSION TTL RULES

### Two-Tier Expiration

| Check | TTL | Trigger | Result |
|-------|-----|---------|--------|
| **Sliding Window** | 60 min from `last_active_at` | Any authenticated API call | DELETE users row, 401 |
| **Hard Limit** | 2 hours from `session_start_at` | Any authenticated API call | DELETE users row, 401 |

### Why Two Tiers?

1. **Sliding window (60 min)** - Keeps active users logged in. Each API call extends the window.
2. **Hard limit (2 hours)** - Security. Even active users must re-authenticate after 2 hours.

---

## EDGE CASES (Resolved)

### 1. User mid-workflow, 60 min expires
**Decision:** Hard-cut. The `requireAuth` middleware checks TTL on every request. If expired, return 401 immediately. User gets "Session expired" message and redirects to login.

**Rationale:** Cleaner than tracking "in-progress" state. Users typically don't work for 60+ minutes without any API calls.

### 2. Browser tab sleeps, user returns after 2 hours
**Decision:** Server returns 401 with `{ error: 'session_expired' }`. Client should handle this by:
1. Clearing local auth state
2. Showing "Session expired" toast
3. Redirecting to login page

**Implementation:** `requireAuth` middleware checks both TTLs before allowing the request through.

### 3. Multiple tabs/devices (Highlander Rule)
**Decision:** One session per user. New login DELETES existing users row and creates a new one.

**Behavior:**
- User logs in on phone → users row created
- User logs in on laptop → phone's session deleted, laptop gets new session
- Phone's next API call returns 401 (no session found)

**Rationale:** Simpler than managing multiple sessions. Prevents "ghost sessions" from abandoned devices.

### 4. Cleanup mechanism (Lazy Cleanup)
**Decision:** Check on each authenticated API request via `requireAuth` middleware. No background job.

**Why lazy cleanup?**
- No extra infrastructure (cron jobs, workers)
- Expired sessions are cleaned up exactly when they matter (on access attempt)
- Unused sessions don't waste resources (they just sit until accessed)

---

## THE FLOW

### Login
```
USER CLICKS LOGIN
       ↓
1. Verify credentials against driver_profiles + auth_credentials
       ↓
2. DELETE existing users row (Highlander Rule)
       ↓
3. INSERT into users:
   - user_id (from driver_profiles)
   - device_id (new UUID)
   - session_id (new UUID)
   - session_start_at (NOW)
   - last_active_at (NOW)
   - current_snapshot_id (NULL)
       ↓
4. Return JWT token to client
       ↓
5. Client requests GPS permission → user accepts
       ↓
6. GPS coords arrive → call /api/location/snapshot
       ↓
7. Server creates SNAPSHOT with location data
       ↓
8. UPDATE users SET current_snapshot_id = new_snapshot_id
       ↓
9. UPDATE users SET last_active_at = NOW (extends sliding window)
```

### Every Authenticated API Request
```
REQUEST WITH JWT TOKEN
       ↓
requireAuth middleware:
  1. Verify JWT signature
  2. Look up users row by user_id
  3. Check: session_start_at + 2hr > NOW? (hard limit)
  4. Check: last_active_at + 60min > NOW? (sliding window)
  5. If expired: DELETE users row, return 401
  6. If valid: UPDATE last_active_at = NOW (non-blocking)
  7. Attach session info to req.auth
       ↓
Route handler executes
```

### Logout
```
USER CLICKS LOGOUT
       ↓
DELETE FROM users WHERE user_id = ?
       ↓
Client clears JWT from localStorage
```

---

## GPS IS MANDATORY

- **No fallback to home_lat/home_lng**
- **No fallback to IP geolocation**
- GPS fails → error → "Please enable location services"
- The entire workflow depends on real GPS

---

## FILES CHANGED

### Server
| File | Changes |
|------|---------|
| `shared/schema.js` | Simplified users table (8 columns, no location) |
| `server/api/auth/auth.js` | Login creates session, logout deletes it, register creates minimal session |
| `server/middleware/auth.js` | Lazy cleanup (60 min sliding + 2 hr hard limit), updates `last_active_at` |
| `server/api/location/location.js` | Updates `current_snapshot_id` after snapshot creation |

### Client
| File | Changes |
|------|---------|
| `client/src/contexts/location-context-clean.tsx` | Updated architecture documentation in header comment |

### Database Migration
Applied 2026-01-05:
```sql
-- Added new session timing columns
ALTER TABLE users ADD COLUMN session_start_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
ALTER TABLE users ADD COLUMN last_active_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- Dropped 13 location columns (now in snapshots only)
ALTER TABLE users DROP COLUMN lat, lng, accuracy_m, coord_source,
  new_lat, new_lng, new_accuracy_m, formatted_address,
  city, state, country, timezone, coord_key;
```

---

## WHAT THIS FIXES

1. **One user = one current_snapshot_id** - no confusion about which snapshot is "active"
2. **Client doesn't track snapshot_id** - server owns it via `users.current_snapshot_id`
3. **No GPS drift duplicates** - same session = same snapshot until explicit refresh
4. **Clean separation** - identity (driver_profiles) vs session (users) vs activity (snapshots)
5. **GPS or nothing** - no stale/fake location data
6. **Automatic session cleanup** - lazy cleanup on each request, no stale sessions
7. **Security** - 2-hour hard limit prevents indefinite sessions

---

## TESTING CHECKLIST

When you wake up, test these scenarios:

- [ ] **Login** → Creates users row with fresh timestamps
- [ ] **API call** → Updates `last_active_at`, request succeeds
- [ ] **Create snapshot** → Links via `current_snapshot_id`
- [ ] **Logout** → Deletes users row, subsequent API calls return 401
- [ ] **Wait 60+ min inactive** → Next API call returns 401 "Session expired due to inactivity"
- [ ] **Login on second device** → First device's session invalidated (Highlander Rule)

---

*Implemented: 2026-01-05 by Claude with Melody's architecture decisions*
