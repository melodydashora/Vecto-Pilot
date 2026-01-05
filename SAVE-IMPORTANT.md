# SAVE-IMPORTANT.md - Session Architecture Discussion (2026-01-02)

## Context
Melody and Claude discussed simplifying the snapshot/session architecture. This document preserves that conversation.

---

## THE PROBLEM

1. Client was tracking `lastSnapshotId` in React state AND sessionStorage - redundant
2. GPS drift (10mm movements) was creating duplicate snapshots
3. `users` table had location fields that duplicated what's in snapshots
4. Architecture was confusing - unclear what owned what

---

## THE NEW ARCHITECTURE

### Three Tables, Three Purposes

| Table | Purpose | Lifecycle |
|-------|---------|-----------|
| `driver_profiles` | **Identity** - who you are | Forever (created at signup) |
| `users` | **Session** - who's online now | Temporary (login → logout/60min) |
| `snapshots` | **Activity** - what you did when | Forever (historical record) |

### NEW `users` Table (Session Tracking Only)

```sql
users (
  user_id                 UUID    -- Links to driver_profiles
  device_id               UUID    -- Device making request
  session_id              UUID    -- Current session
  session_start_timestamp TIMESTAMP -- When they logged in
  current_snapshot_id     UUID    -- Their ONE active snapshot
)
```

**NO MORE location fields in users table** - all location data goes to snapshots.

**Auto-clear rule:** `session_start_timestamp + 60 min = NOW()` → DELETE row

---

## THE FLOW

### Login
```
USER CLICKS LOGIN
       ↓
1. Look up driver_profiles by email → get user_id
       ↓
2. INSERT into users:
   - user_id (from driver_profiles)
   - device_id (from client)
   - session_id (new UUID)
   - session_start_timestamp (NOW)
   - current_snapshot_id (NULL for now)
       ↓
3. Return token to client → client now "logged in"
       ↓
4. Client requests GPS permission → user accepts
       ↓
5. GPS coords arrive → call /api/location/resolve
       ↓
6. Server creates SNAPSHOT:
   - snapshot_id (new UUID)
   - user_id (from token)
   - Resolve coords → city, state, formatted_address (IN SNAPSHOT TABLE)
   - Weather, time context, etc.
       ↓
7. Snapshot complete → UPDATE users SET current_snapshot_id = new_snapshot_id
       ↓
8. Fire event → workflow continues
```

### Session Lifecycle
```
LOGIN
  ↓
users row created → 60 min timer starts
  ↓
┌─────────────────────────────────────────────┐
│  WITHIN 60 MINUTES:                         │
│  - User works normally                      │
│  - Manual refresh → NEW session, NEW        │
│    snapshot, timer RESETS to 60 min         │
└─────────────────────────────────────────────┘
  ↓
60 MIN EXPIRES → users row DELETED → must re-login
```

### Key Rules

| Action | Result |
|--------|--------|
| Login | Create users row, 60 min timer starts |
| Manual refresh | NEW snapshot, timer RESETS to 60 min |
| 60 min expires | DELETE users row, must re-login |
| Logout | DELETE users row immediately |

---

## GPS IS MANDATORY

- **No fallback to home_lat/home_lng**
- **No fallback to IP geolocation**
- GPS fails → error → "Please enable location services"
- The entire waterfall depends on real GPS

---

## EDGE CASES TO DISCUSS (Not Yet Resolved)

1. **User mid-workflow, 60 min expires** - Hard-cut (cleaner) or let finish?

2. **Browser tab sleeps, user returns after 2 hours** - Server sees expired → redirect to login?

3. **Multiple tabs/devices** - Same user on phone AND laptop. Two users rows? Or overwrite device_id?

4. **Cleanup mechanism** - Check on each API request? Or background job sweeping every X minutes?

---

## WHAT THIS FIXES

1. **One user = one current_snapshot_id** - no confusion
2. **Client doesn't track snapshot_id** - server owns it via `users.current_snapshot_id`
3. **No GPS drift duplicates** - same session = same snapshot until refresh
4. **Clean separation** - identity vs session vs activity history
5. **GPS or nothing** - no stale/fake location data

---

## FILES THAT NEED CHANGES

### Server
- `server/api/auth/auth.js` - Login creates users row (minimal fields)
- `server/api/location/location.js` - Remove location fields from users, resolve in snapshots
- `shared/schema.js` - Simplify users table schema

### Client
- `client/src/contexts/location-context-clean.tsx` - Remove lastSnapshotId state, remove sessionStorage
- Remove any client-side snapshot tracking

### Migration
- Remove columns from users: lat, lng, city, state, country, timezone, formatted_address, coord_key, accuracy_m, coord_source, new_lat, new_lng, new_accuracy_m
- Keep only: user_id, device_id, session_id, session_start_timestamp, current_snapshot_id

---

## CURRENT STATE (Before Changes)

Users table currently has one row (Melody):
```json
{
  "user_id": "e41bf400-1fb5-41e1-8cd5-d136fb1e8432",
  "device_id": "e843a029-e542-4ec8-af9a-5a8b05ed83de",
  "session_id": null,
  "current_snapshot_id": null,  // ← THIS IS THE PROBLEM
  "lat": 33.1284531,
  "lng": -96.87576539999999,
  // ... lots of location fields that should be in snapshots
}
```

`current_snapshot_id: null` means snapshots aren't being linked to the user properly.

---

## NEXT STEPS (When Resuming)

1. Discuss and resolve the 4 edge cases above
2. Plan the schema migration (remove location fields from users)
3. Update auth.js login to create minimal users row
4. Update location.js to resolve coords in snapshot, not users
5. Update client to stop tracking snapshot_id
6. Test the full flow

---

*Saved: 2026-01-02 by Claude during session with Melody*
