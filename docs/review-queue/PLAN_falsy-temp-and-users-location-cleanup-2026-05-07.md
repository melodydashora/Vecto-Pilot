# PLAN: Falsy-temperature sweep + remove dead location-writes from `users` UPDATEs/INSERTs

**Created:** 2026-05-07 (late evening)
**Author:** Claude Code (Opus 4.7)
**Filed under:** Rule 1 (Planning Before Implementation), Rule 9 (zero-tolerance drift), CLAUDE.md doctrine "NO LOCATION DATA - all location goes to snapshots table" (`shared/schema.js:18`)
**Scope:** Two unrelated findings bundled — both small, both about making code match actual semantics.
**Status:** Awaiting advisor validation, then Melody approval.

---

## 1. Background

Two findings, both same shape: *the code asserts something that the runtime quietly ignores or contradicts.*

### Finding #6 — Falsy-temperature

`tempC ? convert : null` rejects `0°C` (freezing point, 32°F). Same forensic class as the falsy-coord sweep shipped in `32a6d472`, but with **higher practical urgency** — DFW gets sub-32°F mornings every winter, so this bug fires for current users on cold mornings, unlike the lat/lng=0 case which has no current user impact.

**Three direct conversion sites** + **~12 display/filter/prompt sites**. Display sites that emit `'N/A'` or `'??'` for `0°` to LLM prompts are the most pernicious — silent miscommunication into the Coach's prompt context, which produces plausible-sounding strategy recommendations that ignore the cold-weather signal.

The codebase already has the correct shape at `server/lib/ai/providers/consolidator.js:1241`:
```javascript
const temp = h.tempF != null ? `${Math.round(h.tempF)}°F` : '?°F';
```
`!= null` accepts `0`, rejects `null`/`undefined`. Same correctness pattern as `Number.isFinite` for stricter input typing. Coexists with buggy patterns at every other site.

### Finding #7 — Dead location-writes to `users`

`shared/schema.js:4-18` declares the doctrine:
> **Users table: SESSION TRACKING ONLY (Ephemeral)** ... **NO LOCATION DATA - all location goes to snapshots table**

The live DB matches the schema (verified 2026-05-07): `users` has columns `user_id, session_id, current_snapshot_id, session_start_at, last_active_at, created_at, updated_at`. Zero location columns.

But the code at `server/api/location/location.js:889-908` UPDATEs `users` with 13 location fields:
```javascript
.set({
  new_lat, new_lng, accuracy_m, coord_key,
  formatted_address, city, state, country, timezone,
  coord_source, local_iso, dow, hour, day_part_key,
  updated_at,
})
```
And `location.js:946-965` does the same on INSERT.

Drizzle silently drops every field that doesn't match the schema. So the UPDATE generates: `UPDATE users SET updated_at = now() WHERE user_id = ?` — only `updated_at` actually lands. The 13 location fields are dead writes.

**Net runtime impact today: zero data leakage.** The DB and schema enforce session-only. But:
- The code reads as if location is being persisted to `users`.
- A future contributor reading the handler would believe `users` carries active location.
- A future schema migration that ADDS location columns to `users` (perhaps for valid reasons) would activate the dead writes immediately, contradicting the doctrine without anyone noticing.

This is **architectural drift in the form of code lying about behavior**. The fix is to make the code match what's actually happening (just `updated_at`).

The third users-UPDATE in `location.js` (line 2031, the snapshot-id update path) is already clean — only sets `current_snapshot_id, last_active_at, updated_at`, all schema-real.

---

## 2. Objectives

- **O1.** Replace every falsy-temperature check (truthy guard, `||` substitution) with the correct primitive (`!= null`, `?? default`, or `Number.isFinite`) per site.
- **O2.** Trim the dead location-writes from `users` UPDATE and INSERT in `location.js`. Code should match what drizzle is actually doing.
- **O3.** Preserve all current behavior. Both fixes are correctness-preserving on the happy path: the falsy-temp sweep changes behavior only for `0°` inputs (today the bug fires as substitution-with-null, post-fix the `0°` is preserved); the users-cleanup changes nothing at runtime (drizzle was already filtering the dead fields).

---

## 3. Approach

### 3.0 Cascade rule (carrying forward)

When a falsy-temperature check is replaced or a dead location-write is removed:
1. Replace/delete the line outright. No `// 2026-05-07: replaced X with Y` breadcrumb in live source.
2. If a comment above the line referenced the now-changed code, update or delete it.
3. Match existing project shapes (`!= null` from `consolidator.js:1241`, `?? default` from the falsy-coord sweep).

### 3.1 Phase 1 — Falsy-temperature sweep

**Pattern A — Conversion guard (`tempC ? convert : null`) → `tempC != null ? convert : null`**

| File:line | Current | Replacement |
|---|---|---|
| `server/api/location/location.js:1281` | `const tempF = tempC ? Math.round((tempC * 9/5) + 32) : null;` | `const tempF = tempC != null ? Math.round((tempC * 9/5) + 32) : null;` |
| `server/api/location/location.js:1306` | Same pattern | Same fix |
| `server/api/concierge/concierge.js:197` | Same pattern (extra spaces around `9 / 5`) | Same fix |

**Pattern B — Default substitution (`temp \|\| default`) → `temp ?? default` or `temp != null ? ... : default`**

| File:line | Current | Replacement |
|---|---|---|
| `server/lib/briefing/filter-for-planner.js:257` | `temperature: weatherData.temperature \|\| weatherData.temp \|\| null,` | `temperature: weatherData.temperature ?? weatherData.temp ?? null,` |
| `server/lib/external/faa-asws.js:159` | `temperature: data.Weather.Temp?.[0] \|\| null,` | `temperature: data.Weather.Temp?.[0] ?? null,` |
| `server/api/briefing/briefing.js:671` | `tempF: freshWeather.tempF \|\| null,` | `tempF: freshWeather.tempF ?? null,` |
| `server/lib/briefing/pipelines/weather.js:85` | `const temp = current.tempF \|\| current.temperature;` | `const temp = current.tempF ?? current.temperature;` |

**Pattern C — Display/prompt-prep `\|\| 'N/A'` or `\|\| '??'` → ternary with `!= null`**

These are the highest-priority sites because they bleed into LLM prompts (Coach + consolidator context). A `0°F` reading silently becoming `'N/A'` in a Coach prompt produces plausible-sounding output that ignores the cold-weather signal.

| File:line | Current | Replacement |
|---|---|---|
| `server/lib/ai/providers/consolidator.js:472` | `const temp = weather.tempF \|\| weather.temperature \|\| '??';` | `const temp = weather.tempF != null ? weather.tempF : (weather.temperature != null ? weather.temperature : '??');` (or factor a helper — TBD per implementation) |
| `server/lib/ai/providers/consolidator.js:1215` | `\`${weatherCurrent.conditions \|\| 'Unknown conditions'}, ${weatherCurrent.tempF \|\| weatherCurrent.temperature \|\| '??'}°F\`` | Replace tempF/temperature substitution with the same `!= null` pattern. `conditions \|\| 'Unknown conditions'` is fine (string falsy is OK to substitute) |
| `server/lib/ai/coach-dal.js:972` | `\`\\n   Temperature: ${snapshot.weather.tempF \|\| snapshot.weather.temp \|\| 'N/A'}°F\`` | Replace with `!= null` chain |
| `server/lib/ai/coach-dal.js:1016` | `\`\\n   Current: ${w.temperature?.degrees \|\| 'N/A'}°...\`` | `${w.temperature?.degrees != null ? w.temperature.degrees : 'N/A'}` |
| `server/lib/ai/coach-dal.js:1025` | `const temp = h.temperature?.degrees \|\| 'N/A';` | `const temp = h.temperature?.degrees != null ? h.temperature.degrees : 'N/A';` |
| `server/lib/ai/rideshare-coach-dal.js:952, 996, 1005` | Sister DAL, identical patterns | Same fixes |
| `server/api/chat/chat.js:1094` | `${fullContext?.snapshot?.weather?.tempF \|\| 'N/A'}°F` | `${fullContext?.snapshot?.weather?.tempF != null ? fullContext.snapshot.weather.tempF : 'N/A'}°F` |
| `client/src/components/briefing/WeatherCard.tsx:108` | `{hour.tempF \|\| 0}°F` | `{hour.tempF != null ? hour.tempF : 0}°F` (or just `{hour.tempF ?? 0}°F` — same result for `0`/`null`/`undefined`, but `??` is structurally clearer) |

**Excluded (not weather-related, false-positive matches in the grep):**

- `server/lib/ai/adapters/anthropic-sonnet45.js:10`, `gemini-adapter.js:91, 281`, `openai-adapter.js:145`, `eidolon/core/llm.ts:44`, `index.js:213` — these are LLM **sampling** temperature (the model parameter), not weather temperature. Different domain. Default values (`|| 0.7`, `|| 0.2`, `|| 0.1`) are intentional and **correct** for their use case. Leave alone.

### 3.2 Phase 2 — OUTRIGHT DELETE the dead `users` write blocks (revised per Melody 2026-05-07)

**Doctrine update from Melody (this session, 2026-05-07):**

> users is the table to hold data when the user signs up, nothing should change. It's the one table that should not change. We have preferences for that (vehicle, name, etc.). Literal or not remove the code right, we leave nothing that doesn't make sense. Session shouldn't even go to users, if anything user_id should go to session_id wherever that is stored.

This makes the cleanup MORE aggressive than the original draft. The two `users` write blocks aren't just writing dead location fields — they're writing TO a table that shouldn't be receiving any post-signup writes at all per the new doctrine. The right response is outright deletion, not trimming.

**File: `server/api/location/location.js`** — delete the entire `if (existingUser) { UPDATE } else { INSERT }` block at lines 891-984, plus the matrixLog at 988-994.

**Patch shape:**

Before (the existing block, ~95 lines):
```javascript
const existingUser = await db.query.users.findFirst({
  where: eq(users.user_id, authenticatedUserId),
}).catch(() => null);

if (existingUser) {
  userId = authenticatedUserId;
  try {
    if (!formattedAddress) {
      // ... 502 response with location_persistence_failed ...
    }
    const updateResult = await db.update(users)
      .set({ /* 13 dead location fields + updated_at */ })
      .where(eq(users.user_id, authenticatedUserId));
    if (!updateResult || ...) { /* 502 response */ }
  } catch (updateErr) { /* 502 response with location_persistence_failed */ }
} else {
  userId = authenticatedUserId;
  console.log(`🔐 [LOCATION] [API] Creating user record...`);
  const newUser = { /* 13 dead location fields + user_id, created_at, updated_at */ };
  try {
    await db.insert(users).values(newUser);
  } catch (insertErr) { /* 502 response with location_persistence_failed */ }
}

resolvedData.user_id = userId;
matrixLog.info({ /* USERS_WRITE */ }, 'Users table written (city/state redacted)');
```

After (~3 lines):
```javascript
const existingUser = await db.query.users.findFirst({
  where: eq(users.user_id, authenticatedUserId),
}).catch(() => null);

userId = authenticatedUserId;
resolvedData.user_id = userId;
```

**Net: ~95 lines deleted, 2 lines retained.**

**What stays and why:**

- `existingUser` lookup at line 859-862 — KEPT. Read by the snapshot reuse path at lines 1015-1062 (`existingUser?.current_snapshot_id`). Removing this would break the snapshot reuse logic.
- `userId = authenticatedUserId` — KEPT (one line). Used by the rest of the function (snapshot creation references `userId` for `user_id` on the snapshot row).
- `resolvedData.user_id = userId` — KEPT. The /resolve response carries `user_id` for client-side tracking.

**What's deleted and why:**

- The 13 dead location fields in UPDATE (drizzle was already silently dropping them).
- The 13 dead location fields in INSERT (same).
- The `updated_at: now` bump in UPDATE — per Melody's doctrine, `users` shouldn't change after signup. `updated_at` was being bumped for no clear reason; the actual session-liveness signal lives on `last_active_at` (which `middleware/auth.js:201-212` updates per-request, not via this path).
- The "race/edge case" INSERT — was inserting `user_id, created_at, updated_at` (only 3 schema-real fields). Per the doctrine, registration creates the row; if we're here without one, that's a registration bug to fix at registration, not paper over with a recovery insert in /resolve.
- The 4 error-response paths (`location_persistence_failed`, etc.) — they were failure handling for writes that no longer happen. Their error labels were already misleading ("Failed to save location to database" — but no location was being saved).
- The matrixLog at line 988-994 (`'Users table written (city/state redacted)'`) — said a write happened that didn't.
- The `console.log` at line 945 (`'🔐 [LOCATION] [API] Creating user record for authenticated user_id...'`) — the create wasn't doing anything meaningful.

**Sites left intact tonight (architectural-refactor scope, not this commit):**

- `location.js:1015-1019` — release old snapshot (`current_snapshot_id: null`).
- `location.js:1175-1185` — set new `current_snapshot_id` after snapshot creation.
- `location.js:2031-2037` — snapshot V1 path's `current_snapshot_id` + `last_active_at` + `updated_at` set.
- `server/middleware/auth.js:165-212` — session lookup and expiry sweeps.
- `server/api/auth/auth.js:412-424, 747-770, 1637-1743` — register/login flows that write session columns.

These are part of the session-on-users architecture that the new doctrine says should move OFF `users`. That refactor is a separate plan tomorrow (see §10.2 below).

**Why this is safe to ship tonight even with the architectural refactor pending:**

The deleted code was doing nothing meaningful at the DB level. Drizzle was silently dropping the 13 location fields; only `updated_at` survived. Removing the entire block changes the runtime behavior in exactly one way: `users.updated_at` no longer bumps on `/resolve` for existing users. Per the new doctrine (`users` shouldn't change after signup), that bump was wrong anyway. Session liveness lives on `last_active_at`, updated by `middleware/auth.js`.

The session-tracking writes that DO matter (current_snapshot_id management, last_active_at refresh) all happen elsewhere and are untouched tonight.

---

## 4. Files affected

### 4.1 Phase 1 (falsy-temp sweep)

| File | Sites |
|---|---|
| `server/api/location/location.js` | Pattern A: 2 sites (1281, 1306) — *separate from the Phase 2 surgical edit* |
| `server/api/concierge/concierge.js` | Pattern A: 1 site (197) |
| `server/lib/briefing/filter-for-planner.js` | Pattern B: 1 site (257) |
| `server/lib/external/faa-asws.js` | Pattern B: 1 site (159) |
| `server/api/briefing/briefing.js` | Pattern B: 1 site (671) |
| `server/lib/briefing/pipelines/weather.js` | Pattern B: 1 site (85) |
| `server/lib/ai/providers/consolidator.js` | Pattern C: 2 sites (472, 1215) |
| `server/lib/ai/coach-dal.js` | Pattern C: 3 sites (972, 1016, 1025) |
| `server/lib/ai/rideshare-coach-dal.js` | Pattern C: 3 sites (952, 996, 1005) |
| `server/api/chat/chat.js` | Pattern C: 1 site (1094) |
| `client/src/components/briefing/WeatherCard.tsx` | Pattern C: 1 site (108) |

**~17 sites across 11 files.**

### 4.2 Phase 2 (outright deletion of dead `users` write blocks)

| File | Sites |
|---|---|
| `server/api/location/location.js` | Delete entire `if (existingUser) { UPDATE } else { INSERT }` block (lines 891-984) + matrixLog at 988-994. Replace with `userId = authenticatedUserId; resolvedData.user_id = userId;` |

**1 file, ~95 lines deleted, 2 lines retained.** Net negative diff.

### 4.3 Documentation cascade

- `LESSONS_LEARNED.md` — new 2026-05-07 entry covering both findings:
  - Falsy-temperature is the same forensic class as falsy-coord but with higher practical urgency (cold mornings happen).
  - Dead-writes-to-users is "code lying about behavior" — schema doctrine was correct, the code never updated when the schema tightened.
- `claude_memory` — file an audit row, status `resolved`, parent_id=318 (audit chain).

---

## 5. Risk analysis

| Risk | Severity | Mitigation |
|---|---|---|
| **Phase 1:** `?? null` semantics differs from `\|\| null` for non-numeric falsy values (empty string, `false`, `0`) | Low | Temperature values are always numbers or null. No empty-string or boolean temperatures. Verified in implementation per site. |
| **Phase 1:** `tempC != null` accepts `NaN` (because `NaN != null` is `true`) | Low | If `tempC === NaN`, the `Math.round(NaN * 9/5 + 32)` returns `NaN`, which then gets stored as `null` (or NaN, depending on downstream). Either way, the result is "no temperature" — same as the buggy pre-fix behavior. If stricter rejection is desired, use `Number.isFinite(tempC)` per site. **Plan default:** `!= null` for the conversion sites because preserving NaN-as-null is aligned with current behavior. Use `Number.isFinite` only at sites where the input is suspected non-numeric. |
| **Phase 1:** TypeScript narrowing in `WeatherCard.tsx` | None | The fix `{hour.tempF ?? 0}°F` doesn't introduce a narrowing issue — `?? 0` always produces a number. |
| **Phase 2:** Other code reads/writes `users.current_snapshot_id` / `last_active_at` after the deletion | None | The deleted block at 891-984 didn't touch `current_snapshot_id` or `last_active_at`; those are managed by separate `db.update(users)` calls at lines 1015-1019, 1175-1185, and 2031-2037 — all explicitly preserved per §3.2's "sites left intact tonight" list. They continue to work unchanged. |
| **Phase 2:** "race case" — what if a user authenticated but has no `users` row, and the deleted INSERT was the only recovery path? | None | **Verified unreachable.** Auth middleware (`server/middleware/auth.js:165-180`) does `db.select().from(users).where(eq(users.user_id, userId)).limit(1)` and returns 401 `session_expired` when no row is found. So /resolve is unreachable for users without a `users` row — auth filters them out before the handler runs. The recovery INSERT was defensive code for an auth-filtered case; deleting it is safe. If a registration partial-failure mode ever creates this state in production (auth_credentials committed but users row missing), the right fix is at registration's transactionality, not a recovery INSERT in /resolve. |
| **Phase 2:** What if a future migration adds location columns to `users` and the dead writes were "forward-compatible"? | None | If location columns are ever added to `users`, that would be a deliberate doctrine change. The current commit reflects current doctrine. Future doctrine change would write its own code; can't justify keeping dead writes today. |
| **Phase 2:** A client was string-matching on `error: 'location_persistence_failed'` for retries | Very Low | Grep `client/src/` for the string before deletion. If any callers exist, evaluate per-site whether they're load-bearing (the UPDATE that produced this error never actually persisted location, so the error was misleading on its face). |
| **Phase 2:** matrixLog `'USERS_WRITE'` action removed — could a log analyzer be parsing this? | Very Low | Log analyzers that watched for "users were written from /resolve" were watching for an event that never happened in any meaningful sense. Nothing to preserve. |
| **Phase 2:** Removing the `console.log('Creating user record')` removes an observability signal | None | The log was for an event (race-case INSERT) that did almost nothing meaningful (only inserted `user_id, created_at, updated_at`, which are auto-defaulted by the DB anyway). Per the new doctrine, this race case shouldn't be papered over here — registration is the right place to ensure users rows exist. If the missing-users-row situation actually happens in prod, it should fail loudly downstream rather than be silently recovered. |
| **Both:** order-of-operations between phases | None | Phase 1 and Phase 2 touch different lines, can run in any order. Suggest Phase 1 first (more sites, more potential for typos that lint catches), then Phase 2 (smaller, focused). |

---

## 6. Implementation order

**Reversed from initial draft per advisor 2026-05-07: Phase 2 before Phase 1.** Reason: Phase 2 is one file, surgical, ~95 lines deleted. If anything goes wrong, abort before touching the 11-file sweep. Phase 1 is mechanical and lint-protected (server JS now linted post-`32a6d472`).

1. **Phase 2 — outright delete the dead `users` write blocks.** Edit `location.js`: delete the entire `if (existingUser) { ... } else { ... }` block at lines 891-984 plus the matrixLog at 988-994; replace with `userId = authenticatedUserId; resolvedData.user_id = userId;`. `node --check` clean. `npm run lint` clean.
2. **Phase 1 — falsy-temp sweep.** Edit each of the ~17 sites per §3.1. After each batch (per directory), `node --check` on touched server files; `npm run lint` to catch any typos.
3. **Verification.**
   - `npm run lint` clean.
   - `npm run build` clean.
   - Residue grep:
     - `grep -nE "tempC \?" server/` returns zero direct-conversion sites.
     - `grep -nE "tempF \|\|" server/` returns zero substitution sites in waterfall.
     - `grep -nE "db\.(update|insert)\(users\)" server/api/location/location.js` returns ONLY the snapshot-id management sites (lines 1015-1019, 1175-1185, 2031-2037). The /resolve user-row UPDATE/INSERT is gone.
     - `grep -nE "location_persistence_failed" server/` returns zero.
     - `grep -nE "Users table written" server/` returns zero.
4. **Documentation cascade.** Update `LESSONS_LEARNED.md`. File `claude_memory` row.
5. **Commit.** Stage scoped files only. Don't push until Melody smoke-tests.
6. **Push.** After Melody confirms.

---

## 7. Test cases

### 7.1 Behavioral (Phase 1)

These are unit-style tests against the conversion functions, not curl tests, because `0°` weather is hard to manufacture via API testing. The advisor for the falsy-coord sweep noted curl tests don't help when the bug-trigger value (`0`) doesn't naturally arise in browser flows.

- **T1 — `tempC === 0` converts to 32°F (post-fix):** `tempC = 0` should produce `tempF = 32` (not `null`). Verify by reading the post-fix code: `0 != null` is `true`, so `Math.round((0 * 9/5) + 32) === 32`. ✓
- **T2 — `tempC === null` converts to null (preserved behavior):** `null != null` is `false`, so `tempF = null`. ✓
- **T3 — `tempC === undefined` converts to null:** Same as T2. ✓
- **T4 — Coach prompt with `tempF === 0`:** Verify the `!= null` ternary at `coach-dal.js:972` and sister sites produces `"0°F"` in the prompt, not `"N/A°F"`. Smoke test via reading the post-fix code.
- **T5 — Display `0°F` in `WeatherCard.tsx`:** No visible change (`{0 ?? 0}°F` and `{0 || 0}°F` both render `0°F`). Test is structural — confirm `??` is in place.

### 7.2 Behavioral (Phase 2)

- **T6 — `/resolve` happy path unchanged:** Sign in, accept GPS, hit `/resolve`. Snapshot row should land with full location context (proves `snapshots` writes are unaffected). Users row should have `updated_at` bumped (proves Phase 2's trimmed UPDATE still fires).
- **T7 — Verify users row has no location columns set:** `psql "$DATABASE_URL" -c "\d users"` confirms no location columns exist. Same as before (no schema change). The trim doesn't add or remove columns; it just stops pretending.
- **T8 — `/resolve` for new authenticated user (race case):** If no users row exists, the INSERT path at line 968 fires. Post-fix INSERT only sets `user_id, created_at, updated_at`. Verify by reading post-fix code; behaviorally identical to today (drizzle was already filtering).

### 7.3 Static / sweep

- **T9 (lint):** `npm run lint` clean across new scope (server JS + client/src).
- **T10 (build):** `npm run build` clean.
- **T11 (residue greps per §6 step 3):** All zero.
- **T12 (typecheck):** `npm run typecheck` clean — esp. for `WeatherCard.tsx` and any TS sites.

### 7.4 Regression

- **T13 — Coach prompt sanity:** Pull a fresh Coach response, verify it includes a temperature value. The pre-fix Coach was probably already getting valid temperatures most days (DFW isn't 32°F most days), so no Coach behavior change for the happy path.
- **T14 — Briefing weather rendering:** `WeatherCard` component still renders. No layout regression.

---

## 8. Open questions

1. **Phase 2 error code rename:** `location_persistence_failed` → `session_update_failed`? Keep the current error code for compatibility and only update the message text? **Plan default:** keep the error code, update only the message text (low-risk, no string-matching client risk).
2. **Phase 2 matrixLog message text:** Keep the `action: 'USERS_WRITE'` (used for log filtering) but update the human-readable message. **Plan default:** action stays, message updated.
3. **Phase 1 `Number.isFinite` vs `!= null` per site:** advisor flagged this nuance for the falsy-coord case. For temperature data that comes from Google Weather API or our DB, the values are always either a number or null. `!= null` is sufficient. **Plan default:** use `!= null` for temperature; reserve `Number.isFinite` for sites where the input may be a string or non-numeric.

---

## 9. Outcome measures

- ✅ Phase 1: All falsy-temperature sites replaced with the correct primitive per §3.1.
- ✅ Phase 2: `users` UPDATE/INSERT only sets schema-real fields; error messages and logs reflect what's actually being written.
- ✅ T11 residue greps return zero.
- ✅ Lint + build clean.
- ✅ Existing happy-path regression (T6, T13, T14) intact.
- ✅ `LESSONS_LEARNED.md` entry filed.
- ✅ `claude_memory` audit row filed.

---

## 10. References

- Audit findings (this session): #6 falsy-temperature, #7 dead location-writes to users.
- Forensic-class precedent for #6: commit `32a6d472` (falsy-coord sweep + ESLint coverage). Same pattern recognition.
- Existing correct shape in codebase: `server/lib/ai/providers/consolidator.js:1241` (`!= null` pattern).
- Schema doctrine for #7: `shared/schema.js:4-18` ("Users table: SESSION TRACKING ONLY (Ephemeral) ... NO LOCATION DATA - all location goes to snapshots table").
- Live DB schema verified (2026-05-07): `users` has zero location columns; doctrine is enforced at the DB level.
- CLAUDE.md doctrines: NO FALLBACKS — GLOBAL APP RULE; ABSOLUTE PRECISION — GPS & DATA ACCURACY.
- Audit chain: rows 318→323.
