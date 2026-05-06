# PLAN: Remove `device_id` from waterfall e2e + fix cross-user `/resolve` bug

**Created:** 2026-05-06
**Author:** Claude Code (Opus 4.7)
**Filed under:** Rule 1 (Planning Before Implementation), Rule 9 (all findings high priority), Rule 16 (Melody is the architect — directive: remove `device_id` since auth is now real)
**Related claude_memory row:** 318 (`audit`, `high`, `active`)
**Approval:** Pre-approved by Melody on 2026-05-06 ("I approve it in advance"); implementation still gated on Rule 1's "All tests passed" confirmation.

---

## 1. Background

Two findings drive this plan:

1. **Cross-user data corruption in `GET /api/location/resolve`** (claude_memory row 318): when `existingUser` is found by `device_id` but the row belongs to a different `user_id` than the authenticated user, the handler updates User A's row with User B's location (line 970), while logically operating on User B everywhere else (lines 913, 1086, 1250). `users.device_id` is `notNull()` but **not UNIQUE**, so two users can legally share a row's `device_id` (shared browsers, kiosks, family devices, dev fallback at line 473-474).

2. **`device_id` is dead identity in the waterfall e2e.** With real auth in place (`requireAuth` middleware, JWT-format tokens via `verifyAppToken`, `req.auth.userId` as the trusted identity), `device_id` no longer carries any unique authentication or tracking semantic in the briefing → strategy → venues → events pipeline. It is a vestigial column kept only because earlier sessions tracked anonymous/pre-auth users. Keeping it generates more bugs than it solves (the cross-user issue above is one; the device-resurrection bug noted in `location.js:945-949` is another).

**Scope clarification (from Melody, 2026-05-06):** remove `device_id` from the waterfall e2e (`users`, `snapshots`, and any cascade tables — including `discovered_traffic`). **Preserve** `device_id` only in the Siri Shortcuts pipeline, where it serves as the *authentication* primitive because Siri Shortcuts cannot send JWT tokens.

---

## 2. Objectives

- **O1.** Eliminate the cross-user `/resolve` bug at its root: stop using `device_id` as a key into the `users` table.
- **O2.** Drop the `device_id` column from `users`, `snapshots`, and `discovered_traffic` (waterfall e2e only).
- **O3.** Preserve the Siri Shortcuts pipeline unchanged — `offer_intelligence.device_id`, `intercepted_signals.device_id`, and the `/api/hooks/*` endpoints stay functional.
- **O4.** Address the snapshot ID leak (manifestation #2 from row 318) by re-keying the snapshot reuse lookup to `authenticatedUserId` instead of using `existingUser.current_snapshot_id`.
- **O5.** Eliminate the internal user_id inconsistency (manifestation #3) — make every UPDATE in the `existingUser` branch target the same `user_id` (the authenticated one).
- **O6.** Cascade-clean: remove every `users.device_id` / `snapshots.device_id` / `discovered_traffic.device_id` read, write, log line, validation rule, and client send.

---

## 3. Approach

### 3.0 Cascade rule (operational doctrine, applies to every section below)

When `users.device_id`, `snapshots.device_id`, or `discovered_traffic.device_id` (or anything that referenced them) is removed:

1. **Delete the line outright.** No re-targeting to a different column. No `// TODO` placeholder. The line is gone.
2. **Delete any comment that referenced the deleted code** in the same edit. A comment that explains a column or a function that no longer exists is stale by construction; leaving it behind creates exactly the doc-drift this codebase has fought before. This includes:
   - The 2026-05-05 doctrine note at `location.js:945-949` ("users.device_id is the SIGNUP device, immutable after registration") — gone.
   - The "Save to users table if device_id provided" comment at `location.js:876` — gone.
   - The "Dev fallback: Generate deterministic device_id from coords" comment at `location.js:465-468` — gone.
   - Any `// 2026-XX-XX: device_id ...` annotation anywhere in the touched files — gone.
3. **Do not add new "REMOVED on YYYY-MM-DD" breadcrumb comments** to the live source. The historical record lives in the migration file, the git commit message, and this plan — not in the schema or in the runtime code.
4. **Re-read the surrounding block after deletion** and remove any sibling comment that becomes nonsensical now that the deleted code is gone (e.g., a comment block that contrasts two branches when only one branch survives).

This rule supersedes any local instinct to "leave a marker so a future reader knows what used to be here." The PR description, this plan, and the migration are sufficient archaeology.

### 3.1 Identity model (new)

| Surface | Old key | New key | Reason |
|---|---|---|---|
| `/api/location/resolve` user lookup | `users.device_id` | `req.auth.userId` only | Auth is the identity. No more device-keyed lookups. |
| `users.device_id` column | NOT NULL `text` | **dropped** | No longer queried by anything. |
| `snapshots.device_id` column | NOT NULL `text` | **dropped** | Per-event device tracking was load-bearing only because users-table identity was unreliable; it isn't anymore. |
| `discovered_traffic.device_id` column | NOT NULL `text` | **dropped** | Cascade — derives from `snapshot_id` (which is FK with ON DELETE CASCADE). |
| Siri Shortcuts (`offer_intelligence`, `intercepted_signals`) | `device_id` | `device_id` (unchanged) | Auth primitive for Siri — JWT impossible. |

### 3.2 `/resolve` handler refactor (server/api/location/location.js)

Replace the device-keyed lookup at lines 894-918 with an auth-keyed lookup. Pseudocode of the new shape:

```javascript
// New: single authoritative lookup by authenticated user_id only.
const existingUser = await db.query.users.findFirst({
  where: eq(users.user_id, authenticatedUserId),
});

if (existingUser) {
  // UPDATE always targets authenticatedUserId — no more split between
  // existingUser.user_id and userId. Same id everywhere in this branch.
  userId = authenticatedUserId;
  // ... (UPDATE WHERE user_id = authenticatedUserId, snapshot_id read from
  // existingUser.current_snapshot_id which is by-construction the authed user's)
} else {
  // First-time-after-auth user (race/edge-case): create row with user_id = authenticatedUserId.
  userId = authenticatedUserId;
  // INSERT ... (no device_id column anymore)
}
```

Deletes:

- Lines 894-918 device lookup + fallback block → replaced with the single auth-keyed lookup.
- Line 1013 `device_id: deviceId` field in the INSERT object.
- Line 1210 `device_id: deviceId` field in the snapshot INSERT.
- Lines 945-949 stale comment about `device_id` immutability (no column to be immutable about anymore).
- Lines 465-475 dev fallback `dev-admin-{lat}_{lng}` deviceId generator (no longer needed for users.device_id; if anything still wants it, it can read `req.auth.userId`).
- Lines 1732, 1987 `snapshotV1.device_id` references in the alternate snapshot ingestion path.

Keeps:

- The `?device_id=` query param parsing → soft-deprecate (still accept, stop reading). The client can stop sending it as part of this same change; we accept-but-ignore for one transitional version, then remove the schema rule after deployment is confirmed. *(Open question — ask Melody whether to remove the param immediately. Default in this plan: remove now since this is auth-only. See §10.)*
- `requireAuth` at line 30 — already correct.

### 3.3 Schema change (`shared/schema.js`)

For all three tables (`users`, `snapshots`, `discovered_traffic`), the `device_id` column line is **deleted outright** — no `// device_id REMOVED ...` breadcrumb comment is left in its place. Same rule for the `idxDevice` index entry on `discovered_traffic` and any inline comments above the deleted lines that reference the now-absent column. (Per Melody's 2026-05-06 directive: when code is removed, stale comments referencing it must also be removed.)

The post-edit shape of each table definition is identical to today minus the `device_id` line and minus any comment that mentions `device_id`. The only date-stamp annotation goes in the migration header (§3.4) and the git commit message — not in the live source.

**Untouched by this plan:**

- `offer_intelligence.device_id` (line 1611, Siri Shortcuts)
- `intercepted_signals.device_id` (line 1518, Siri Shortcuts)
- `analyze-offer.js` (`/api/hooks/analyze-offer`) — entire endpoint stays
- `translate.js` (`/api/hooks/translate`) — entire endpoint stays
- `rate-limit.js` line 44-46 (the `req.body?.device_id` rate-limit key for hook endpoints)

### 3.4 Migration

New file: `migrations/20260506_drop_device_id_from_users_snapshots_traffic.sql`

```sql
-- 2026-05-06: Drop device_id from waterfall e2e tables (users, snapshots, discovered_traffic).
-- Driven by:
--   1. Cross-user /resolve corruption bug (claude_memory row 318)
--   2. Auth replaces device_id as identity primitive (Rule 16: Melody's directive 2026-05-06)
-- Siri Shortcut tables (offer_intelligence, intercepted_signals) keep device_id — see PLAN.

BEGIN;

-- discovered_traffic first (cascade dependency on snapshots is via snapshot_id FK,
-- not device_id, so order doesn't matter for FKs — but drop bottom-up for clarity).
DROP INDEX IF EXISTS idx_discovered_traffic_device;
ALTER TABLE discovered_traffic DROP COLUMN IF EXISTS device_id;

-- snapshots
ALTER TABLE snapshots DROP COLUMN IF EXISTS device_id;

-- users
ALTER TABLE users DROP COLUMN IF EXISTS device_id;

COMMIT;
```

**Rollback** (kept in plan, not in committed migration):

```sql
BEGIN;
ALTER TABLE users ADD COLUMN device_id text;
ALTER TABLE snapshots ADD COLUMN device_id text;
ALTER TABLE discovered_traffic ADD COLUMN device_id text;
-- Backfilling NOT NULL is non-trivial after rows exist; leave nullable on rollback.
CREATE INDEX IF NOT EXISTS idx_discovered_traffic_device ON discovered_traffic(device_id);
COMMIT;
```

**Why this is safe to run forward:** dropping a column does not invalidate FKs on any of these tables (none of `device_id` columns are referenced by FKs anywhere — verified by reading the schema file). The data loss is intentional — a `device_id` value on a user row was never authoritative for anything we can't derive from `user_id` and `current_snapshot_id` going forward.

### 3.5 Validator + client cleanup

- `server/validation/schemas.js:34, 55, 72` — remove `optionalDeviceIdSchema` from `locationResolveSchema` and `snapshotMinimalSchema`. (Open: keep the schema definition itself for the Siri-Shortcut path? Those use raw `req.body?.device_id` reads, not Zod schemas, so the schema can be deleted without breaking them. Decision in this plan: delete the schema.)
- `client/src/contexts/location-context-clean.tsx:381-382, 400, 644` — stop reading/sending `device_id` from localStorage. Delete the `localStorage.setItem` and the param.
- `client/src/constants/storageKeys.ts:24` — remove `DEVICE_ID: 'vecto_device_id'`.
- `client/src/constants/apiRoutes.ts:37-38, 278` — remove `deviceId` from `RESOLVE_WITH_PARAMS` and `AUTH_ME` query keys; rename param signature.
- `client/src/components/GlobalHeader.tsx:104-127` — remove the `deviceId` localStorage read and the gated `enabled: !!deviceId` query condition (replace with `!!authToken` only, since auth is now the identity).

### 3.6 Server-side cleanup of `snapshots.device_id` reads

| File:line | Current | Change |
|---|---|---|
| `server/api/strategy/strategy.js:247` | `device_id: originalSnapshot.device_id` (snapshot copy) | Delete the field |
| `server/api/location/snapshot.js:122` | `device_id: snap.device_id || uuid()` | Delete the field |
| `server/lib/briefing/pipelines/traffic.js:344, 352` | gates write on `snapshot?.device_id`; writes `device_id` to `discovered_traffic` | Replace gate with `snapshot?.snapshot_id` only; remove `device_id` from the row payload |
| `server/api/location/location.js:1732, 1987` | snapshotV1 `device_id` shim + INSERT | Delete |
| `server/scripts/self-healing-monitor.js:9` | column list mentions `device_id` | Remove from column list |
| `server/logger/workflow.js:28` | doc-comment example references `snapshot.device_id` | Update comment |
| `server/api/auth/auth.js:412-417, 751, 763, 1644, 1725, 1736` | fabricates `web-${randomUUID()}` device_ids and inserts into `users` | Delete the line + the fabrication |

### 3.7 Test-fixture cleanup

| File:line | Current | Change |
|---|---|---|
| `tests/triad/test-pipeline.js:58, 127, 265, 275, 285` | passes `device_id: crypto.randomUUID()` | Delete the field |
| `tests/integration/test-ocr-hook.js:9` | `device_id: "test-device-001"` | **Keep** — this tests the Siri Shortcuts hook path |

### 3.8 Documentation cascade

Per Rule 2 (Documentation Synchronization) and Rule 5 (inline doc dating), update:

- `docs/architecture/DB_SCHEMA.md` — drop `device_id` rows from users/snapshots/discovered_traffic; mention removal date and link to this plan.
- `docs/architecture/AUTH.md` (if present) — note that auth identity is now the sole user key for the waterfall e2e.
- `docs/EVENT_FRESHNESS_AND_TTL.md` and `docs/architecture/MAP.md` (currently in `git status` as modified — survey to see if either references device_id; update if so).
- `CLAUDE.md` — the 2026-05-05 paragraph at `location.js:945-949` ("users.device_id is the SIGNUP device, immutable after registration") is now obsolete; remove the equivalent note from CLAUDE.md if it exists, link to this PLAN as the canonical replacement.
- `LESSONS_LEARNED.md` — add an entry: "Cross-user `/resolve` bug — root cause was using a non-unique column (`device_id`) as a lookup key for an authenticated request. Lesson: when `requireAuth` runs upstream of a route, identity lookups MUST key on `req.auth.userId`. Any other key is at best redundant and at worst a cross-user data-corruption vector."
- Sub-READMEs in any modified folder — `server/api/location/`, `server/api/auth/`, `client/src/contexts/`, `migrations/`, `shared/`. Per Rule 2, update these in the same commit as the code change.
- `claude_memory` row 318 — flip to `resolved` after implementation lands; reference this PLAN file path in the resolution row.

---

## 4. Files affected

### 4.1 Schema + migration

- `shared/schema.js` (3 tables modified)
- `migrations/20260506_drop_device_id_from_users_snapshots_traffic.sql` (new)

### 4.2 Server

- `server/api/location/location.js` (primary refactor — `/resolve` handler + snapshotV1 path)
- `server/api/location/snapshot.js`
- `server/api/strategy/strategy.js`
- `server/api/auth/auth.js` (6 callsites — registration + Google OAuth flows)
- `server/lib/briefing/pipelines/traffic.js`
- `server/scripts/self-healing-monitor.js`
- `server/logger/workflow.js` (comment update only)
- `server/validation/schemas.js`

### 4.3 Client

- `client/src/contexts/location-context-clean.tsx`
- `client/src/components/GlobalHeader.tsx`
- `client/src/constants/storageKeys.ts`
- `client/src/constants/apiRoutes.ts`

### 4.4 Tests

- `tests/triad/test-pipeline.js` (5 callsites — delete `device_id` field)
- `tests/integration/test-ocr-hook.js` (keep — Siri Shortcut path)

### 4.5 Docs

- `docs/architecture/DB_SCHEMA.md`
- `docs/architecture/AUTH.md` (if it references device_id)
- `docs/EVENT_FRESHNESS_AND_TTL.md`, `docs/architecture/MAP.md` (audit — already modified in working tree)
- `CLAUDE.md` (remove obsolete `users.device_id` doctrine paragraph)
- `LESSONS_LEARNED.md` (add cross-user lookup lesson)
- Relevant sub-READMEs (`server/api/location/`, `server/api/auth/`, `client/src/contexts/`, `migrations/`, `shared/`)

### 4.6 Excluded — preserved as-is

- `server/api/hooks/analyze-offer.js` (Siri Shortcuts: `offer_intelligence.device_id`)
- `server/api/hooks/translate.js` (Siri Shortcuts)
- `server/api/rideshare-coach/validate.js` (line 237 — refers to `coach_offer_decisions.device_id`, which is part of the Siri-derived offer pipeline)
- `server/middleware/rate-limit.js` lines 44-46 (Siri rate-limit key)
- `offer_intelligence`, `intercepted_signals` schema definitions

---

## 5. Cascade map (callsite-by-callsite)

| Layer | File:line | Operation | Action |
|---|---|---|---|
| Schema | `shared/schema.js:21` | `users.device_id` column | **DELETE** |
| Schema | `shared/schema.js:36` | `snapshots.device_id` column | **DELETE** |
| Schema | `shared/schema.js:653` | `discovered_traffic.device_id` column | **DELETE** |
| Schema | `shared/schema.js:671` | `idxDevice` index on `discovered_traffic` | **DELETE** |
| Migration | `migrations/20260506_drop_device_id_*.sql` | DROP COLUMN x3 + DROP INDEX | **CREATE** |
| Server | `server/api/location/location.js:409` | doc comment listing `device_id` query param | **DELETE** the line |
| Server | `server/api/location/location.js:465-475` | dev fallback deviceId generator + comment | **DELETE** (code + the comment block above it) |
| Server | `server/api/location/location.js:470` | `let deviceId = sanitizeString(req.query.device_id)` | **DELETE** |
| Server | `server/api/location/location.js:876` | `if (deviceId)` guard around users-write block + the inline comment | **REPLACE** guard with `if (authenticatedUserId)`, **DELETE** the comment about device_id |
| Server | `server/api/location/location.js:894-918` | device-keyed user lookup + fallback + the comment block above it | **REPLACE** with auth-keyed lookup; comment block deleted |
| Server | `server/api/location/location.js:945-949` | obsolete `users.device_id` doctrine comment | **DELETE** outright (comment is stale once column is gone) |
| Server | `server/api/location/location.js:1013` | INSERT `device_id: deviceId` for new user | **DELETE** field |
| Server | `server/api/location/location.js:1210` | INSERT `device_id: deviceId` for snapshot | **DELETE** field |
| Server | `server/api/location/location.js:1732` | `snapshotV1.device_id ||= randomUUID()` + any comment referencing it | **DELETE** code + comment |
| Server | `server/api/location/location.js:1987` | snapshot record `device_id` field | **DELETE** field |
| Server | `server/api/location/location.js:2410` | doc-comment listing `device_id` | **DELETE** the `device_id` mention from the comment (other items in the same comment can stay if still accurate) |
| Server | `server/api/location/snapshot.js:122` | snapshot INSERT `device_id` field | **DELETE** field |
| Server | `server/api/strategy/strategy.js:247` | snapshot copy `device_id` field | **DELETE** field |
| Server | `server/api/auth/auth.js:412` | `const newDeviceId = ...` | **DELETE** |
| Server | `server/api/auth/auth.js:417` | INSERT `device_id` field | **DELETE** field |
| Server | `server/api/auth/auth.js:751, 763` | `device_id: web-${UUID}` placeholders | **DELETE** field |
| Server | `server/api/auth/auth.js:1644` | INSERT `device_id` field | **DELETE** field |
| Server | `server/api/auth/auth.js:1725, 1736` | `device_id: web-${UUID}` placeholders | **DELETE** field |
| Server | `server/lib/briefing/pipelines/traffic.js:344` | `if (snapshot?.device_id)` gate | **REPLACE** with snapshot_id-only gate |
| Server | `server/lib/briefing/pipelines/traffic.js:352` | row payload `device_id` field | **DELETE** field |
| Server | `server/scripts/self-healing-monitor.js:9` | column list | **DELETE** `device_id` from list |
| Server | `server/logger/workflow.js:28` | doc-comment example references `snapshot.device_id` | **DELETE** the example line (or the `device_id` mention if other items in the same example remain valid) |
| Server | `server/validation/schemas.js:34, 55, 72` | `optionalDeviceIdSchema` rule | **DELETE** rule + the schema definition |
| Client | `client/src/contexts/location-context-clean.tsx:381-382` | `localStorage.getItem/setItem(DEVICE_ID)` | **DELETE** |
| Client | `client/src/contexts/location-context-clean.tsx:400` | `RESOLVE_WITH_PARAMS(... deviceId ...)` call | **UPDATE** — remove deviceId arg |
| Client | `client/src/contexts/location-context-clean.tsx:644` | `device_id: deviceId` in body | **DELETE** field |
| Client | `client/src/constants/storageKeys.ts:24` | `DEVICE_ID` constant | **DELETE** |
| Client | `client/src/constants/apiRoutes.ts:37-38` | `RESOLVE_WITH_PARAMS` signature | **UPDATE** — drop `deviceId` param |
| Client | `client/src/constants/apiRoutes.ts:278` | `AUTH_ME(deviceId)` query key | **UPDATE** — drop `deviceId` param (auth is the key) |
| Client | `client/src/components/GlobalHeader.tsx:104-127` | localStorage device read + gated query | **UPDATE** — replace gate with `!!authToken` |
| Tests | `tests/triad/test-pipeline.js:58, 127, 265, 275, 285` | fixture `device_id: randomUUID()` | **DELETE** field |

---

## 6. Risk analysis

| Risk | Severity | Mitigation |
|---|---|---|
| Live snapshots in dev/prod DB still have `device_id` values; dropping the column loses that data | Low | Data was never authoritative for anything (per the plan rationale). Dropping is acceptable. Roll-forward only. |
| In-flight `/resolve` requests with `?device_id=` query param after deploy | Low | Server simply ignores the param; no error. Client patch removes the send in the same release. |
| Browser localStorage still holds the old `vecto_device_id` value | Low | Dead key — never read, never sent after this change. Will eventually be evicted. No cleanup migration needed. |
| Auth.js INSERT to `users` was relying on `device_id NOT NULL` (so dropping the column changes the INSERT shape — if any leftover code still passes `device_id` as a column reference, it will fail) | Medium | The cascade map enumerates every `users.device_id` writer. If any are missed, the INSERT will throw `column "device_id" of relation "users" does not exist` — a loud failure, not a silent one. Easy to detect during dev smoke test. |
| `discovered_traffic` rows already in the DB still have `device_id` values; dropping the column loses them | Low | This table is per-snapshot cache (CASCADE DELETE on snapshot drop). The rows are ephemeral by design. |
| Migration runs on prod (Neon) before code deploys catches up | Medium | Standard release coordination — deploy code first, migration second, OR deploy code that tolerates both shapes. **Plan choice:** code first (the JS code stops *writing* `device_id` once the schema-side definition is gone), then migration. Drizzle's runtime SELECT * is by-name, so removing the column from the schema definition + restarting the gateway is forward-safe even before the migration runs. |
| Tests in `tests/triad/test-pipeline.js` may be using `device_id` as part of a stronger uniqueness invariant | Low | Spot-check shows the field is just `crypto.randomUUID()` — pure noise. Removing is safe. |
| Removing `users.device_id` breaks something I haven't found | Medium | Mitigation: Phase 5 below — grep + lint + typecheck + manual smoke test the full waterfall e2e (resolve → briefing → strategy → venues) before declaring done. |

---

## 7. Implementation order (dependency-correct)

Phase 1 — code-only (does not require migration to land):
1. Patch `shared/schema.js` to drop the three columns + the index.
2. Patch `server/api/location/location.js` (`/resolve` handler refactor — auth-keyed lookup, drop deviceId everywhere, drop dev fallback).
3. Patch other server callsites (auth.js, strategy.js, snapshot.js, traffic.js, self-healing-monitor.js, validation/schemas.js, workflow.js comment).
4. Patch client (storageKeys, apiRoutes, location-context-clean, GlobalHeader).
5. Patch tests (test-pipeline.js — leave test-ocr-hook.js alone).
6. Run `npm run lint && npm run typecheck && npm run build`.
7. Manual smoke test in dev:
   - Sign in, hit `/resolve`, verify the response carries `user_id = authenticatedUserId` and a fresh `snapshot_id`.
   - Verify `users` row in DB no longer has `device_id` referenced by any insert/update.
   - Verify briefing → strategy → venues e2e still produces a result.
   - Verify Siri-Shortcut hook (`/api/hooks/analyze-offer`) still accepts `device_id` and returns 200.

Phase 2 — migration:

8. Add `migrations/20260506_drop_device_id_from_users_snapshots_traffic.sql`.
9. Run migration in dev (`npm run drizzle:migrate` or psql direct, depending on project convention).
10. Verify the three columns + the index are gone in dev.
11. Re-run the smoke test from step 7 against the post-migration schema.

Phase 3 — docs + memory:

12. Update `CLAUDE.md`, `docs/architecture/DB_SCHEMA.md`, `LESSONS_LEARNED.md`, sub-READMEs.
13. Mark `claude_memory` row 318 as `resolved`, with a follow-up row pointing to the PR/commit.

Phase 4 — production:

14. Get Melody's "All tests passed" approval per Rule 1.
15. Deploy code to prod.
16. Run migration on Neon prod after code deploy is verified.

---

## 8. Test cases

### 8.1 Unit / integration

- **T1.** `GET /api/location/resolve` for an authenticated user with **no existing `users` row** → creates row keyed on `req.auth.userId`, returns 200 with `user_id === req.auth.userId`. *(Covers O5: first-time-after-auth path.)*
- **T2.** `GET /api/location/resolve` for an authenticated user with **an existing `users` row** → updates row WHERE `user_id = req.auth.userId`. Verify SQL `UPDATE` returns `rowCount === 1`. *(Covers O1, O5: auth-keyed lookup, single user_id throughout.)*
- **T3.** `GET /api/location/resolve` with `?device_id=` query param present → server ignores the param; behavior identical to T1/T2.
- **T4.** `GET /api/location/resolve` for User B authenticated, where User A's row used to exist with the same browser-stored device_id → User A's row is **NOT** touched (verify A's `lat/lng/coord_key/...` unchanged in DB after B's call). *(Direct regression test for the cross-user bug.)*
- **T5.** Snapshot reuse path: User B authenticates, has fresh `current_snapshot_id` on their own row → resolve returns that snapshot_id. *(Covers O4: snapshot reuse keyed on auth, not device.)*
- **T6.** Snapshot reuse path: User B authenticates, has NO `current_snapshot_id` on their own row → resolve creates a fresh snapshot. Verify User A's `current_snapshot_id` (if A exists at all) is **not** read or returned. *(Direct regression test for the snapshot leak.)*
- **T7.** `?force=true` releases User B's snapshot only; User A's snapshot (if A exists with `current_snapshot_id`) is untouched.
- **T8.** Briefing → strategy → venues waterfall e2e: full pipeline runs against a snapshot with no `device_id` column. Verify briefing aggregator, traffic pipeline (writes to `discovered_traffic` without `device_id`), strategy consolidator, venue planner all succeed.
- **T9.** Siri Shortcut path: `POST /api/hooks/analyze-offer` with `device_id` in body → 200, `offer_intelligence` row written with `device_id`. *(Regression test for the preserved path.)*
- **T10.** Siri Shortcut path: `POST /api/hooks/translate` with `device_id` in body → 200. *(Regression test for the preserved path.)*

### 8.2 Schema / migration

- **T11.** Run the migration on a fresh DB clone; verify `users.device_id`, `snapshots.device_id`, `discovered_traffic.device_id`, and `idx_discovered_traffic_device` are all absent (`\d users` etc. in psql).
- **T12.** Run the migration; insert a new user via `/auth/register`; verify INSERT succeeds without `device_id`.
- **T13.** Run the migration; create a snapshot via `/resolve`; verify INSERT succeeds without `device_id`.
- **T14.** Run the migration; trigger traffic-pipeline write to `discovered_traffic`; verify INSERT succeeds without `device_id`.

### 8.3 Auth + security

- **T15.** Unauthenticated request to `/resolve` → still rejected with 401 (existing behavior, unchanged).
- **T16.** Two users (A and B) sharing the same browser/localStorage: A signs out, B signs in, B hits `/resolve`. Verify B's row is created/updated; A's row is unchanged. *(End-to-end regression for the cross-user bug.)*
- **T17.** `requireSnapshotOwnership` middleware still rejects mismatched-owner snapshot reads with 404 (existing behavior, unchanged).

### 8.4 Client smoke

- **T18.** Sign in via the web client; verify the network tab shows `/api/location/resolve?lat=...&lng=...&accuracy=...&coord_source=gps` with **no `device_id` param**.
- **T19.** Verify localStorage no longer contains `vecto_device_id` after a fresh sign-in (because the client never writes it anymore).
- **T20.** GlobalHeader query (`AUTH_ME`) still fires once per auth-token change, gated only on `!!authToken`.

### 8.5 Lint / type / build

- **T21.** `npm run typecheck` passes (TS client, JS server with JSDoc).
- **T22.** `npm run lint` passes.
- **T23.** `npm run build` passes (client bundle).
- **T24.** `grep -rn "users.device_id\|snapshot.device_id\|snapshots.device_id\|originalSnapshot.device_id\|snapshotV1.device_id\|snap.device_id" server client tests` returns **zero hits** (cascade verification).

---

## 9. Rollback

If a regression is discovered post-deploy:

1. **Code-only rollback** (preferred): revert the code change. The migration's column drop is forward-only — the running code continues to work even if the column doesn't exist (because nothing reads it anymore). If something does read it post-revert, that's a bug in the revert itself; address by re-applying the patch.
2. **Schema rollback**: only if step 1 is somehow inadequate. Run the rollback SQL in §3.4. The new `device_id` columns will be NULL; this is acceptable because nothing reads them anymore.
3. **claude_memory row 318** stays `active` until rollback is itself reverted.

---

## 10. Open questions for Melody (please confirm before implementation)

1. **`?device_id=` query param to `/resolve`** — accept-and-ignore, or remove from the validation schema entirely so a request with the param gets 400? *(Plan default: remove from schema. Auth-only product, no reason to accept dead params.)*
2. **`server/api/auth/auth.js` Google OAuth fabrication callsites (lines 751, 763, 1725, 1736)** — these create `device_id: web-${UUID}` placeholders for OAuth users who never had a frontend deviceId. After the column drop, just delete the field from the INSERT object. *(Plan default: delete. No alternative makes sense.)*
3. **`coach_offer_decisions.device_id`** at `server/api/rideshare-coach/validate.js:237` — this is the Coach offer pipeline. Is it derived from the Siri/offer pipeline (so keep) or from the waterfall (so remove)? *(Plan default: KEEP — comment in validate.js says "identity fields (decision, device_id, created_at)" which sounds Siri-pipeline-flavored. Surveying says it's about coach offer decisions, which originate from offer_intelligence, which is Siri. So preserved.)*

If Melody answers anything other than "default is fine" for any of these, the plan re-opens at §3.

---

## 11. Outcome measures

- ✅ `claude_memory` row 318 transitions `active → resolved`.
- ✅ Cross-user `/resolve` regression test (T4, T16) passes.
- ✅ Snapshot leak regression test (T6) passes.
- ✅ Siri Shortcut regression tests (T9, T10) pass.
- ✅ Waterfall e2e (T8) produces venue recommendations.
- ✅ Grep verification (T24) — zero waterfall-side `device_id` callsites remain.
- ✅ Schema verification (T11) — three columns + one index dropped on dev DB.
- ✅ Doc cascade complete (CLAUDE.md, DB_SCHEMA.md, LESSONS_LEARNED.md, sub-READMEs).

---

## 12. References

- `claude_memory` row 318 (the audit finding)
- `server/api/location/location.js:430-1310` (the route)
- `shared/schema.js:19-30, 32-75, 650-672` (the three tables)
- `server/middleware/require-snapshot-ownership.js` (the leak-bounding gate — kept unchanged)
- `CLAUDE.md` Rules 1, 2, 5, 9, 16
- `LESSONS_LEARNED.md` (to be updated)
- 2026-05-05 doctrine note at `location.js:945-949` (to be removed — superseded)
