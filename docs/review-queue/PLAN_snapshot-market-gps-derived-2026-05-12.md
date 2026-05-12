# PLAN: Make `snapshot.market` GPS-Derived (Fix D-107)

**Date:** 2026-05-12
**Author:** Claude (Opus 4.7) + Melody
**Status:** PENDING APPROVAL (Rule 1 — awaiting Melody's "All tests passed" before merge)
**Scope:** One function, one file. The fix is a *priority inversion*, not new code.
**Trigger:** Melody's 2026-05-12 manual-coord test (NYC) surfaced that the New York briefing returned Dallas/Fort Worth/Frisco news. Diagnosed: `snapshot.market` was being copied from `driver_profiles.market` ("Dallas-Fort Worth") at snapshot creation, ignoring the actual GPS-resolved city/state.

**Real-world evidence from Melody:** "Across 6 states I drove in the last two days all showed DFW Rideshare news." This is a *production* bug affecting traveling drivers, not just a test-mode artifact.

---

## 1. Principle

> Drivers are mobile. **Market is a property of where the driver IS**, not who they are. Every snapshot field must be derived from the snapshot's GPS-resolved location, not from `driver_profiles` identity data.

This principle is the same one that drives Rule 11 (snapshot fidelity) and CLAUDE.md's "NO FALLBACKS" rule. Until now it was applied to weather/traffic/events/schools but not to `market` and `home_timezone`.

---

## 2. Diagnosis

Verified at the data layer (2026-05-12 01:58 UTC):

```sql
SELECT snapshot_id, city, state, market, timezone FROM snapshots ORDER BY created_at DESC LIMIT 2;
```

| snapshot_id | city | state | market | timezone |
|---|---|---|---|---|
| fe89f103-… | New York | NY | **Dallas-Fort Worth** ❌ | America/New_York ✓ |
| 3701337b-… | Frisco | TX | Dallas-Fort Worth ✓ | America/Chicago ✓ |

`timezone` is correct on both rows — it's resolved from coords via `coords_cache`. `market` is wrong on the NYC row — it's copied from `driver_profiles.market` regardless of where the driver actually is.

The misbehaving code at `server/api/location/location.js:969-1008` has TWO market-resolution paths:

- **Lines 974-979** (the wrong one): `SELECT market FROM driver_profiles WHERE user_id = ?` — identity-based
- **Lines 988-1003** (the right one): `resolveTimezoneFromMarket(city, state, country)` — location-based, **but only runs if profile.market is NULL** (Google OAuth backfill case)

The bug is the priority order. Fix is to *invert the priority*: always try location-based first, fall back to profile only if location resolution truly fails. The "right path" code is already there.

---

## 3. The Fix

### File: `server/api/location/location.js`, lines 969-1008

**Before:**
```js
// 2026-02-01: Look up user's market from driver_profiles (set at signup)
let userMarket = null;
if (userId) {
  try {
    const [profileResult] = await db
      .select({ market: driver_profiles.market, home_timezone: driver_profiles.home_timezone })
      .from(driver_profiles)
      .where(eq(driver_profiles.user_id, userId))
      .limit(1);
    userMarket = profileResult?.market || null;
    if (userMarket) {
      console.log(`[SNAPSHOT] User market from profile: ${userMarket}`);
    }

    // OAuth backfill — only runs if profile.market is NULL
    if (!userMarket && city && state) {
      const backfillMarket = marketResult || await resolveTimezoneFromMarket(city, state, country);
      if (backfillMarket) {
        await db.update(driver_profiles)
          .set({ market: backfillMarket.market_name, home_timezone: backfillMarket.timezone, updated_at: new Date() })
          .where(eq(driver_profiles.user_id, userId));
        userMarket = backfillMarket.market_name;
        console.log(`[SNAPSHOT] 🔗 Backfilled market+timezone on profile: ${backfillMarket.market_name} (${backfillMarket.timezone})`);
      }
    }
  } catch (err) {
    console.warn(`[SNAPSHOT] Could not lookup/backfill user market: ${err.message}`);
  }
}
```

**After:**
```js
// 2026-05-12 (D-107 FIX): snapshot.market is location-derived, not identity-derived.
// Drivers are mobile — a Dallas-based driver in NYC must see NYC market data.
// Resolve from GPS-derived (city, state) first; fall back to profile only if coord
// resolution genuinely fails. The OAuth "first snapshot backfill" semantics are preserved:
// driver_profiles.market is set on the FIRST snapshot for users who signed up via Google
// (which leaves market=NULL), and stays as "first known market" — never overwritten by
// later travels.
let userMarket = null;
if (userId) {
  try {
    // PATH 1 (preferred): resolve market from current snapshot's GPS coords.
    const coordResolvedMarket = marketResult || await resolveTimezoneFromMarket(city, state, country);
    if (coordResolvedMarket?.market_name) {
      userMarket = coordResolvedMarket.market_name;
      console.log(`[SNAPSHOT] Market from GPS coords (${city}, ${state}): ${userMarket}`);

      // First-snapshot backfill: if profile.market is still NULL (Google OAuth signup),
      // persist this as the driver's "first known market". Subsequent snapshots in
      // different markets will NOT overwrite the profile — profile is identity (stable),
      // snapshot is location (mobile).
      const [profileResult] = await db
        .select({ market: driver_profiles.market })
        .from(driver_profiles)
        .where(eq(driver_profiles.user_id, userId))
        .limit(1);
      if (profileResult && !profileResult.market) {
        await db.update(driver_profiles)
          .set({
            market: coordResolvedMarket.market_name,
            home_timezone: coordResolvedMarket.timezone,
            updated_at: new Date()
          })
          .where(eq(driver_profiles.user_id, userId));
        console.log(`[SNAPSHOT] 🔗 Backfilled profile market (first snapshot): ${coordResolvedMarket.market_name}`);
      }
    } else {
      // PATH 2 (fallback): coord resolution returned nothing (unknown city/state combo).
      // Fall back to profile market — better stale than null for AI prompt scope.
      const [profileResult] = await db
        .select({ market: driver_profiles.market })
        .from(driver_profiles)
        .where(eq(driver_profiles.user_id, userId))
        .limit(1);
      userMarket = profileResult?.market || null;
      if (userMarket) {
        console.log(`[SNAPSHOT] Market fallback from profile (coord lookup failed for ${city}, ${state}): ${userMarket}`);
      }
    }
  } catch (err) {
    console.warn(`[SNAPSHOT] Could not resolve user market: ${err.message}`);
  }
}
```

### File: `shared/schema.js`, lines 50-52

**Before:**
```js
// 2026-02-01: Market from driver_profiles.market - captured at snapshot creation
// Used for market-wide event discovery (e.g., "Dallas-Fort Worth" instead of just "Frisco")
market: text("market"),
```

**After:**
```js
// 2026-05-12 (D-107): Market derived from snapshot's GPS-resolved (city, state) via
// resolveTimezoneFromMarket(). Drivers are mobile — a Dallas-based driver in NYC must
// see NYC market data. profile.market is preserved as "first known market" (identity);
// snapshot.market reflects current location (mobile). Used for market-wide event/news
// discovery scope in AI prompts.
market: text("market"),
```

---

## 4. What this does NOT change (yet)

Per Melody's directive 2026-05-12: this commit fixes ONLY the news/market bug. Other potential improvements deferred:

- **No cache removal.** The `school_closures` 24-hour cache (`briefing-aggregator.js:208-247`), `sessionStorage` snapshot resume, and React Query `staleTime` configurations all stay as-is. Melody will continue testing cities; if she sees more leakage, we'll scope a separate plan.
- **No 60s briefing dedup change.** It's snapshot-scoped (not market-scoped), so it doesn't leak across cities — only handles double-tap on the same snapshot.
- **No `resolveTimezoneFromMarket` rename.** The function is misleadingly named (returns market + timezone) but the rename is non-load-bearing.
- **`home_timezone` selection dropped from line 975.** It was never used downstream — `snapshot.timezone` already comes from coords_cache, not driver_profiles. This is a pure cleanup.

---

## 5. Test Plan

Manual via the 2026-05-12 OVERRIDE-FEATURE (lat/lng inputs in header).

| # | Test coords | Expected market | Expected news scope |
|---|---|---|---|
| 1 | `41.878100, -87.629800` (Chicago Loop) | "Chicago" | Chicago/IL news (CTA, Pace, etc.) |
| 2 | `40.712776, -74.005974` (NYC Financial District) | "New York" | NYC/NJ news (MTA, Holland Tunnel, etc.) |
| 3 | `37.794800, -122.395200` (SF Financial District) | "San Francisco" | Bay Area news (BART, Bay Bridge, etc.) |
| 4 | `33.128400, -96.875600` (Frisco, TX — Melody's home) | "Dallas-Fort Worth" | DFW news — **should still work after fix** |
| 5 | `21.302700, -157.857100` (Honolulu) | (probably no Hawaii market in `markets` table → fallback to profile) | If no Hawaii market: Dallas-Fort Worth news (acceptable per fallback semantics) |
| 6 | `51.507400, -0.127800` (London) | (no UK markets in `markets` table → fallback) | Dallas-Fort Worth news (acceptable; UK is out-of-scope for v1) |

### Acceptance criteria

- ✅ Tests 1-3: News items are about the test city's metro, NOT about Dallas
- ✅ Test 4: News items remain Dallas-correct for Frisco coords (regression check)
- ✅ Tests 5-6: Fallback to profile is logged via `[SNAPSHOT] Market fallback from profile` and news returns DFW (or null, depending on profile state). Not ideal but acceptable until `markets` table is expanded internationally.

---

## 6. Side effects to verify

1. **Existing Frisco/DFW snapshots in DB still work.** The `discovered_events` table is filtered by `state`, not `market` — so existing event rows continue to return correctly.
2. **`driver_profiles.market` is no longer overwritten by later travel.** Once set (either at signup or by first-snapshot backfill), it stays as the driver's "home market." This means: drivers who used the app from Dallas and now travel will still have `profile.market = "Dallas-Fort Worth"` — that's correct, profile is identity.
3. **News pipeline change is automatic.** `pipelines/news.js:161` already does `snapshot.market || await getMarketForLocation(city, state)` — after the fix, `snapshot.market` is the GPS-derived value, so the `||` fallback rarely fires. News scope follows the snapshot correctly.
4. **Events pipeline change is automatic.** Same pattern (`events.js:432`). Gemini's discovery prompt receives the correct market scope; DB filter on `state` already worked correctly.

---

## 7. Files Affected

| File | Lines | Change |
|---|---|---|
| `server/api/location/location.js` | 969-1008 (~30 lines) | Invert market-resolution priority |
| `shared/schema.js` | 50-52 (3 lines) | Update comment to reflect new doctrine |
| `docs/DOC_DISCREPANCIES.md` | (append D-107) | Log + mark FIXED |
| `docs/review-queue/PLAN_snapshot-market-gps-derived-2026-05-12.md` | (this file) | Plan artifact |
| `claude_memory` | (insert one row) | Engineering-pattern row for the principle |

No client-side changes. No schema migrations. No DB column changes.

---

## 8. Memory row to write

**Title:** `Snapshot fields follow GPS, not driver profile — D-107 fixed`

**Body (Shape A — no parent, fresh observation):**
> 2026-05-12 D-107: Bug found via NYC manual-coord test (override feature). snapshot.market was copied from driver_profiles.market at creation, leaking DFW market into snapshots taken in NYC, SF, etc. Production impact confirmed by Melody driving across 6 states in 2 days and seeing DFW Rideshare News throughout.
>
> **Principle codified:** Drivers are mobile. Snapshot fields are properties of the snapshot's location (GPS-resolved city/state), not properties of the driver's identity. profile.market is identity (stable, set once); snapshot.market is location (mobile, set per snapshot).
>
> **Fix:** server/api/location/location.js:969-1008 — invert priority. resolveTimezoneFromMarket(city, state, country) runs first; profile.market is fallback only if coord resolution fails. OAuth first-snapshot backfill preserved (Google signup leaves profile.market=NULL, this writes the first known market).
>
> **What was NOT changed:** school_closures 24h cache, sessionStorage resume, React Query staleTime — all preserved per Melody's directive ("everything else worked fine for the city"). 60s briefing dedup is snapshot-scoped, doesn't leak across markets.
>
> **Related:** D-107 in DOC_DISCREPANCIES.md; PLAN at docs/review-queue/PLAN_snapshot-market-gps-derived-2026-05-12.md.

---

## 9. Approval

- [ ] Plan reviewed by Melody
- [ ] Code change applied
- [ ] Bundle rebuilt (`npm run build:client`)
- [ ] Melody runs test #2 (NYC) — news should now be NYC-specific
- [ ] Melody runs test #4 (Frisco) — news should still be DFW (regression check)
- [ ] "All tests passed" confirmed by Melody
- [ ] D-107 marked FIXED in `docs/DOC_DISCREPANCIES.md` and PLAN moved to `reviewed-queue/`

