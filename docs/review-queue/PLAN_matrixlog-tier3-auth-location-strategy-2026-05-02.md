# PLAN — `matrixLog` Tier 3, Batch 1: auth + location + strategy-verify PII scrub

> **Date:** 2026-05-02
> **Status:** AWAITING APPROVAL — no code changes until Melody confirms §3 (redaction-policy fork)
> **Author:** Claude Code (Opus 4.7)
> **Doctrine:** Rule 1 (plan before implement), Rule 16 (Melody is architect)
> **Parent plan:** `docs/review-queue/PLAN_matrixlog-refactor-2026-05-01.md`
> **Branch:** `feat/logger-tier3-auth-loc` (in `.worktrees/logger-tier3`)
> **Trigger:** Live log dump showed plaintext emails during login and exact lat/lng during snapshot resolution.

---

## 1. Objective

Migrate every log call in three files to `matrixLog`, dropping PII in the process:

- `server/api/auth/auth.js`
- `server/api/location/location.js`
- `server/api/strategy/blocks-fast.js`

PII removal is enforced by the matrixLog spec at `server/logger/matrix.js:26-28`:

> `message` — The actual content. NO sensitive identifiers (UUIDs, addresses, coords, model versions, content text). Counts and field-presence are fine.

Continues the canonical plan's **Tier 3** scope, narrowed to these 3 files for this PR. Other Tier 3 files (gateway, scripts, chat, vehicle, the venue-address-* family, etc.) are deferred to subsequent batches — see §8.

## 2. Leak inventory (post-orientation grep, 2026-05-02)

### `server/api/auth/auth.js` — 13 PII sites

| Line | Current call | PII | Disposition |
|---|---|---|---|
| 56   | `authLog.done(1, \`Token generated for: ${email \|\| userId.substring(0, 8)}\`)` | email + UUID prefix | drop both — see §3 |
| 237  | `authLog.phase(1, \`Hashing password for: ${email}\`)` | email | drop |
| 239  | `authLog.phase(1, \`Password hashed for: ${email}\`)` | email | drop |
| 280  | `authLog.done(1, \`Address standardized: ${addressValidation.formattedAddress}\`)` | **full home address** | drop value; keep `field_present` boolean if useful |
| 457  | `authLog.done(1, \`New driver registered: ${email}\`)` | email | drop |
| 567  | `authLog.phase(1, \`Found credentials for: ${email} (hash length: …)\`)` | email | drop |
| 571  | `authLog.warn(1, \`OAuth-only account attempted password login: ${email}\`)` | email | drop |
| 589  | `authLog.phase(1, \`Verifying password for: ${email}\`)` | email | drop |
| 608  | `authLog.warn(1, \`Failed login attempt for: ${email} (${newAttempts} attempts)\`)` | email | drop email, retain count |
| 679  | `authLog.done(1, \`Driver logged in: ${email}\`)` | email | drop |
| 771  | `authLog.warn(1, \`Password reset requested for non-existent email: ${email}\`)` | email | drop |
| 828  | `authLog.done(1, \`Password reset email sent to: ${email}\`)` | email | drop |
| 1188 | `authLog.done(1, \`Re-geocoded address: ${geocodeResult.formattedAddress}\`)` | **full home address** | drop value |

In addition: every other `authLog.*` and `console.error('[AUTH] ...')` call in this file (estimated ~15 more, none PII-bearing — `auth.js:45` "FATAL: No JWT_SECRET" is one) is migrated to `matrixLog` for taxonomy consistency. Total est. ~30 log-line changes.

### `server/api/location/location.js` — ~10 PII sites

| Line | Current call | PII | Disposition |
|---|---|---|---|
| 530  | `console.error('[LOCATION] [API] COORDINATES OUT OF RANGE', { lat, lng })` | coords in object | drop `lat`/`lng` keys; retain `out_of_range: true` |
| 540  | `console.warn('[LOCATION] [API] Suspicious coordinates (0,0) — possible GPS error')` | literal 0,0 (not identifying) | keep — already PII-safe |
| 543  | `locationLog.phase(1, \`Resolving ${lat.toFixed(6)}, ${lng.toFixed(6)}\`, OP.API)` | coords | drop coords from message |
| 623  | `console.error(\`[LOCATION] Geocode returned OK but no results for coords [${lat}, ${lng}]\`)` | coords | drop |
| 637  | `console.log(\`[LOCATION] [API] Geocode extraction for [${lat}, ${lng}]:\`, {…})` | coords | drop |
| 651, 661, 672 | `console.error(\`[LOCATION] [API] FAIL HARD: …coords [${lat}, ${lng}]\`)` | coords | drop |
| 774  | `console.error(\`[LOCATION] CRITICAL: Geocode did not return city/state for coords [${lat}, ${lng}]\`, {…})` | coords | drop |
| 878  | `console.error('[LOCATION] CRITICAL: formattedAddress is null/empty - refusing to update users table', {…})` | check second arg; drop if address present | inspect during impl |
| 1708 | `console.log('[SNAPSHOT] Resolved missing address fields:', { city, state, formattedAddress })` | **address + city/state** | drop `formattedAddress`; replace city/state with field-presence flags |

Plus all other `locationLog.*` and `[LOCATION]`/`[SNAPSHOT]` console calls in this file (estimated ~30 more) for full file Tier 3 migration.

**Note:** URL construction lines like `url.searchParams.set('latlng', \`${lat},${lng}\`)` (lines 217, 349, 609, 718, 1239, 1242, 1418, 1570, 1589, 1692) are NOT log emissions — they're outbound API requests to Google Maps/Weather/Pollen APIs. Out of scope; not PII leaks.

### `server/api/strategy/blocks-fast.js` — 2 explicit PII sites + neighborhood

| Line | Current call | PII | Disposition |
|---|---|---|---|
| 724 | `triadLog.phase(2, \`[VERIFY] Snapshot row ready: city=…, state=…, lat=…, lng=…\`)` | coords + city/state | drop all 4 fields from message |
| 725 | `triadLog.phase(2, \`[VERIFY] Snapshot context: timezone=…, day_part=…, is_holiday=…\`)` | content text (borderline — non-identifying alone, but spec forbids "content text") | drop fields; keep summary action |

Plus all other `triadLog.*` calls in this file. `triadLog` is aliased to `strategyLog` per memory 233 — the visible bracket becomes `[STRATEGY]`, and `[VERIFY]` migrates from inline-message-prefix to `action: 'VERIFY'` (or `'PHASE-CHECK'`) on the `matrixLog` spec.

## 3. Redaction policy — OPEN QUESTION for Melody (Rule 16)

The matrixLog spec at `matrix.js:26-28` literally lists **UUIDs** as forbidden in messages. The Tier 1 precedent (commit `9bc88ed3`) drops identifiers entirely. But `auth.js:56` already uses `userId.substring(0, 8)` as a fallback — itself a UUID prefix.

Two coherent options:

| | Option (i) — spec-literal | Option (ii) — existing-convention |
|---|---|---|
| Email in messages | drop entirely | drop entirely |
| UserId in messages | drop entirely | keep `userId.substring(0, 8)` |
| Correlation source for audit | `emitJSON` payload (`snapshot_id`, `request_id`, optional `user_id` field) and/or `withContext` binding | message-string substring |
| Auth log readability in dev console | lower (need JSON tail to correlate) | higher (8 chars next to action verb) |
| Spec compliance | strict | spec exception |
| Reversal cost if changed | re-edit ~13 sites | re-edit ~13 sites |

**Recommendation:** **Option (i)** — match spec literally. Correlation lives in structured JSON for any pipeline that ingests stderr; humans tailing pretty logs lose 8 chars of debuggability per line, gain spec consistency.

**Coord, address, city/state, content-text:** drop entirely from messages. Not negotiable per spec.

**Per Rule 16, Melody picks (i) or (ii). I will not pre-decide.**

## 4. Migration pattern

Per parent plan §7 and commit `9bc88ed3` precedent.

**Before:**
```js
authLog.done(1, `Token generated for: ${email || userId.substring(0, 8)}`);
```

**After (Option (i) — spec-literal):**
```js
matrixLog.info({
  category: 'AUTH',
  action: 'TOKEN_ISSUE',
  location: 'auth.js:generateAuthToken',
}, 'Token generated');
```

Render: `[AUTH] [TOKEN_ISSUE] [auth.js:generateAuthToken] -> Token generated`

JSON sidecar (via `emitJSON`) carries `{ ts, level, category: 'AUTH', message: 'Token generated', action: 'TOKEN_ISSUE', location: 'auth.js:generateAuthToken' }`. If `withContext({ snapshot_id, request_id, user_id })` binding is added to the auth router, those fields ride along too — that's a small follow-up worth doing once we've sorted §3.

**DB writes** (e.g., `auth_credentials` updates) add `connection: 'DB'` and `tableName: 'AUTH_CREDENTIALS'`. **External API** (Google OAuth) adds `connection: 'API'`.

## 5. Test cases (Rule 1 mandatory)

### Mechanical (grep — deterministic, sub-5-second to run):

- **T1.** `grep -nE '\$\{email\}|\$\{[a-z]*\.email\}' server/api/auth/auth.js` → **0 matches inside log/console calls** (SQL `where` clauses, response bodies, oauth emails are allowed).
- **T2.** `grep -nE 'toFixed\(6\)|\$\{lat[^a-z]|\$\{lng[^a-z]' server/api/location/location.js | grep -E '(console\.|Log\.|matrixLog)'` → **0 matches**.
- **T3.** `grep -nE 'snapshot\.(city|state|lat|lng)' server/api/strategy/blocks-fast.js | grep -E '(console\.|Log\.|matrixLog)'` → **0 matches in log emissions**.
- **T4.** `grep -nE '\b(authLog|locationLog|triadLog)\.' server/api/auth/auth.js server/api/location/location.js server/api/strategy/blocks-fast.js` → **0 matches** (all callers migrated to `matrixLog`).
- **T5.** `grep -nE 'formattedAddress' server/api/auth/auth.js server/api/location/location.js | grep -E '(console\.|Log\.|matrixLog)'` → **0 matches with the address value interpolated** (presence flags are fine).

### Static (no boot needed):

- **T6.** `node --check` clean on each modified file.
- **T7.** `npm run lint` clean tree-wide (no new ESLint errors introduced by these files).
- **T8.** `npm run typecheck` clean tree-wide.

### Smoke (boot + log capture):

- **T9.** Boot the gateway (`npm run dev`); exercise the auth login flow:
  - `POST /api/auth/login` with valid credentials → captured stdout/stderr contains zero `${email}` substrings, contains `[AUTH] [LOGIN_SUCCESS]`-style matrix-formatted lines.
- **T10.** Exercise snapshot creation:
  - `POST /api/snapshot` with valid GPS → captured stdout/stderr contains zero coord substrings of pattern `\d+\.\d{6}, ?-?\d+\.\d{6}` in `[LOCATION]` or `[STRATEGY]` lines.
- **T11.** End-to-end: snapshot → briefing → strategy → blocks pipeline runs without error; `[STRATEGY] [VERIFY]` lines emit no city/state/coord values.

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Mixed-convention mid-file (legacy + matrix) | Expected during edit | None | Parent plan §6 explicitly allows this; aliases stay until Tier 4 |
| `LOG_QUIET_COMPONENTS` semantics shift | Low | Low | matrixLog gates by `category`, same string as legacy; `LOG_QUIET_COMPONENTS=AUTH` still silences AUTH |
| JSON consumers parse the new payload shape incorrectly | Low | Medium | matrixLog's `emitJSON` shape is additive; legacy fields preserved |
| Lost debuggability post-redaction | Medium | Low | `snapshot_id` / `request_id` in JSON sidecar restore correlation |
| Edge case: `auth.js:45` `console.error('[AUTH] FATAL:')` runs before matrixLog import is resolved (boot-order) | Very low | Low | Migrate to matrixLog after import; confirm no circular boot path |

## 7. Rollback

- All work isolated in `.worktrees/logger-tier3` on branch `feat/logger-tier3-auth-loc`.
- Main is unaffected until merge.
- `git revert <commit-sha>` restores prior state per file.
- No schema, no migrations, no env var additions/removals — pure code.

## 8. Out of scope (deferred Tier 3 batches)

Per the leak grep, these files also contain address-in-log violations but are NOT in this batch:

- `server/lib/location/address-validation.js:160` — venue/driver address in `[VENUE]` log
- `server/lib/venue/venue-address-validator.js:180` — venue address
- `server/lib/venue/venue-address-resolver.js:221` — venue plus-code
- `server/lib/venue/venue-cache.js:704, 731` — venue address re-resolution log

Plus all other Tier 3 files per parent plan §7 (gateway, scripts, chat, vehicle middleware, etc.) and Tier 4 (legacy alias deletion).

A follow-up plan doc will pick these up after this batch lands and Melody validates the convention against live logs.

## 9. Doctrine references

- **Rule 1:** This plan satisfies the planning requirement. Implementation begins after Melody answers §3.
- **Rule 9:** All findings high-priority — every leak site enumerated.
- **Rule 16:** §3 redaction policy is Melody's call.
- **memory row 248:** matrixLog satisfies "source = output" because the bracket fields are explicit at the call site.
- **Parent plan §6:** Mid-migration mixed-convention is allowed; aliases stay until Tier 4.
- **Parent plan §7 Tier 3:** This batch is the auth + location + strategy-verify subset.

## 10. Execution sequence post-approval

1. Run `git worktree list` to confirm we're in `.worktrees/logger-tier3`.
2. Edit `auth.js` — migrate every log call; for the 13 PII sites, apply chosen redaction option.
3. `node --check server/api/auth/auth.js` after each block of edits.
4. Edit `location.js` — same.
5. Edit `blocks-fast.js` — same.
6. Run §5 mechanical tests (T1–T5).
7. Run static tests (T6–T8).
8. Boot dev server; run smoke tests (T9–T11); capture log dump.
9. Commit with message `feat(logger): Tier 3 batch 1 — migrate auth.js, location.js, blocks-fast.js to matrixLog (PII scrub)`.
10. Update `claude_memory` with a row summarizing the batch (status=`active` until merged, then flip to `resolved`).
11. Report back here with: log capture excerpt, grep-test output, claude_memory row id.

---

**Awaiting your call on §3 (Option (i) spec-literal vs Option (ii) keep-userId-prefix). Once answered, I run the migration in the worktree, post log capture + grep results, and you do the "All tests passed" review.**
