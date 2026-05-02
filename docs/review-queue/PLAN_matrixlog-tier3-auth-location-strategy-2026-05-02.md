# PLAN — `matrixLog` Tier 3, Batch 1: auth + location + strategy-verify PII scrub

> **Date:** 2026-05-02 (revised same day after Melody's directive)
> **Status:** REVISED — Melody decided §3 (modified Option (ii)) and added 3 amendments (spec amendment, sub-README sync, LESSONS_LEARNED entry). **AWAITING explicit "All tests passed" approval on this revision before any code edits.**
> **Author:** Claude Code (Opus 4.7)
> **Doctrine:** Rule 1 (plan before implement), Rule 16 (Melody is architect), Rule 6 (master-architect pushback when warranted)
> **Parent plan:** `docs/review-queue/PLAN_matrixlog-refactor-2026-05-01.md`
> **Branch:** `feat/logger-tier3-auth-loc` (in `.worktrees/logger-tier3`)
> **Trigger:** Live log dump showed plaintext emails during login and exact lat/lng during snapshot resolution.
> **Revision history:**
> - 2026-05-02 v1: Initial plan, §3 surfaced as open question per Rule 16.
> - 2026-05-02 v2: Melody decided §3 = modified Option (ii); added §3.1 (matrix.js spec amendment), §3.2 (sub-README sync), §3.3 (LESSONS_LEARNED entry). Master-architect flag raised on CLAUDE.md Rule 2 staleness — see §3.2.

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

## 3. Redaction policy — DECIDED 2026-05-02 (Melody)

**Decision: modified Option (ii).**

| Field | Disposition |
|---|---|
| Email in messages | **drop entirely** (no exception) |
| UserId in messages | **keep `userId.substring(0, 8)`** as deliberate spec exception for real-time DX correlation in the Replit console |
| Coords / lat / lng | **drop entirely** (no exception) |
| Full address (`formattedAddress`) | **drop entirely**; field-presence flag OK |
| City / state | **drop entirely** in message strings; available in `emitJSON` sidecar |
| Content text (timezone strings, day_part, holiday flags, weather narrative) | **drop entirely** per spec |

**Rationale (Melody's call):** Real-time console DX requires correlation. With three concurrent driver logins, `[AUTH] [TOKEN_ISSUE] -> Token generated` lines are indistinguishable without the userId prefix. The 8-char hex prefix is non-reversible at that length (~4×10⁹ collision space across the user table) and is consistent with existing auth-flow convention — making it a deliberate, scoped exception rather than spec drift.

**Architectural integrity:** the spec is amended to **explicitly permit** the 8-char prefix rather than silently violated. See §3.1.

## 3.1 Spec amendment to `server/logger/matrix.js`

**Before any code migration**, amend the comment block at lines 26–28:

**Before:**
```js
//   message      - The actual content. NO sensitive identifiers (UUIDs, addresses,
//                  coords, model versions, content text). Counts and field-presence
//                  are fine.
```

**After:**
```js
//   message      - The actual content. NO sensitive identifiers in full form
//                  (no full UUIDs, emails, addresses, coords, model versions,
//                  content text). Counts and field-presence are fine.
//
//                  EXCEPTION (2026-05-02 amendment): an 8-char hex correlation
//                  prefix derived from a UUID (e.g., userId.substring(0, 8))
//                  IS permitted for real-time DX in the Replit console.
//                  Non-reversible at this length and consistent with existing
//                  auth-flow convention. Email/coord/address/full-UUID remain
//                  forbidden in messages.
```

This is the canonical record of the spec exception. Lands as a separate commit before the auth/location/strategy migrations.

## 3.2 Sub-README synchronization (Melody directive 2026-05-02)

Update three sub-READMEs to document the matrixLog taxonomy and the §3 redaction policy:

- `server/api/auth/README.md` — document `[AUTH]` matrix taxonomy + 8-char userId-prefix exception
- `server/api/location/README.md` — document `[LOCATION]` matrix taxonomy + coord-drop policy
- `server/api/strategy/README.md` — document `[STRATEGY]` matrix taxonomy (incl. `[VERIFY]` action) + city/state/coord-drop policy

**Master-architect flag (Rule 6) — CLAUDE.md Rule 2 is stale:**

CLAUDE.md Rule 2 (revised 2026-04-18) states: *"Sub-READMEs have been removed. 109 sub-READMEs … were deleted because they rotted faster than they could be maintained. Only the root README.md and everything under docs/ survive."* Verification on 2026-05-02 contradicts this:

- `find server -name 'README.md' -type f | wc -l` → **51** (not 0)
- `server/api/auth/README.md`, `server/api/location/README.md`, `server/api/strategy/README.md` all exist (sizes 4,610 / 7,189 / 7,503 bytes), all modified 2026-05-02 01:05 UTC
- Recent commits show active sub-README maintenance (e.g., `2b7a319f pass-9-part-1: collapse auth README`, `4d0dd859 docs(security): symbolic env refs in README`)

Per Rule 12's contested-fact rule (added 2026-04-24): *"trust the newest timestamped audit document over older doctrine files."* Disk reality is the newer fact. Rule 2 needs updating in a separate cleanup commit — **out of scope for this plan**, but flagged here so it's not silently propagated.

This batch will:
1. Update the three target sub-READMEs (per Melody's directive, consistent with disk reality).
2. Add a `claude_memory` row (`category='audit', status='active'`) titled "CLAUDE.md Rule 2 stale: claims sub-READMEs deleted 2026-04-18 but 51 still exist as of 2026-05-02." Future sessions will see this on Rule 12 review.
3. **NOT** modify CLAUDE.md Rule 2 in this batch (separate concern; needs Melody's explicit go on rewording).

## 3.3 LESSONS_LEARNED.md addition

Add a new entry documenting the legacy-vs-spec taxonomy mismatch:

> **Logger taxonomy migrations: spec the exceptions, don't violate them.** When introducing a new structured logging spec (`matrixLog` 2026-05-01) on top of existing convention (`userId.substring(0, 8)` correlation in messages), audit the existing convention first and explicitly permit any deliberate exceptions in the spec text — don't carry forward "but the codebase already does this" as silent justification. The Tier 3 PII scrub (2026-05-02) discovered 13 PII sites in `auth.js`, 10 in `location.js`, and 2 in `blocks-fast.js`. The matrixLog spec at `matrix.js:26-28` had banned UUIDs in messages but the auth-flow convention required correlation; resolved by spec amendment, not silent violation.

This lesson will help future agents avoid two patterns: (a) carrying legacy conventions forward into new specs without auditing, and (b) violating freshly-written specs by treating existing code as authoritative over fresh design intent.

## 4. Migration pattern

Per parent plan §7 and commit `9bc88ed3` precedent.

**Before:**
```js
authLog.done(1, `Token generated for: ${email || userId.substring(0, 8)}`);
```

**After (modified Option (ii) per Melody's 2026-05-02 decision):**
```js
matrixLog.info({
  category: 'AUTH',
  action: 'TOKEN_ISSUE',
  location: 'auth.js:generateAuthToken',
}, `Token generated for ${userId.substring(0, 8)}`);
```

Render: `[AUTH] [TOKEN_ISSUE] [auth.js:generateAuthToken] -> Token generated for a3f1c2e8`

JSON sidecar (via `emitJSON`) carries `{ ts, level, category: 'AUTH', message: 'Token generated for a3f1c2e8', action: 'TOKEN_ISSUE', location: 'auth.js:generateAuthToken' }`. If `withContext({ snapshot_id, request_id, user_id })` binding is added to the auth router as a follow-up, the full `user_id` (UUID, NOT prefix) rides along in the JSON sidecar for log-pipeline correlation.

**Email is dropped entirely — never appears.** The 8-char userId prefix is the *only* permitted identifier in messages, per §3.1 spec amendment.

**DB writes** (e.g., `auth_credentials` updates) add `connection: 'DB'` and `tableName: 'AUTH_CREDENTIALS'`. **External API** (Google OAuth) adds `connection: 'API'`.

## 5. Test cases (Rule 1 mandatory)

### Mechanical (grep — deterministic, sub-5-second to run):

- **T1.** `grep -nE '\$\{email\}|\$\{[a-z]*\.email\}' server/api/auth/auth.js` → **0 matches inside log/console calls** (SQL `where` clauses, response bodies, oauth emails are allowed).
- **T2.** `grep -nE 'toFixed\(6\)|\$\{lat[^a-z]|\$\{lng[^a-z]' server/api/location/location.js | grep -E '(console\.|Log\.|matrixLog)'` → **0 matches**.
- **T3.** `grep -nE 'snapshot\.(city|state|lat|lng)' server/api/strategy/blocks-fast.js | grep -E '(console\.|Log\.|matrixLog)'` → **0 matches in log emissions**.
- **T4.** `grep -nE '\b(authLog|locationLog|triadLog)\.' server/api/auth/auth.js server/api/location/location.js server/api/strategy/blocks-fast.js` → **0 matches** (all callers migrated to `matrixLog`).
- **T5.** `grep -nE 'formattedAddress' server/api/auth/auth.js server/api/location/location.js | grep -E '(console\.|Log\.|matrixLog)'` → **0 matches with the address value interpolated** (presence flags are fine).
- **T6 (spec amendment).** `grep -n 'EXCEPTION (2026-05-02 amendment)' server/logger/matrix.js` → **1 match** (confirms §3.1 spec amendment landed before code edits).
- **T7 (userId prefix permitted).** `grep -nE 'userId\.substring\(0, ?8\)' server/api/auth/auth.js` → **≥ 1 match** in matrixLog calls (confirms modified Option (ii) was applied, not silent Option (i)).
- **T8 (sub-README sync).** `grep -nl 'matrixLog' server/api/auth/README.md server/api/location/README.md server/api/strategy/README.md` → **3 matches** (all three sub-READMEs document the new taxonomy).
- **T9 (LESSONS_LEARNED entry).** `grep -n 'Logger taxonomy migrations' LESSONS_LEARNED.md` → **1 match** (the §3.3 lesson landed).

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

The sequence is ordered so the spec amendment (§3.1) lands FIRST, the doc sync (§3.2 + §3.3) lands as a separate commit before code, then the migrations land per file. This makes each commit independently revertible and the spec ↔ code change relationship traceable.

1. Run `git worktree list` to confirm we're in `.worktrees/logger-tier3`.
2. **Spec amendment commit:** edit `server/logger/matrix.js` lines 26–28 per §3.1; commit with message `docs(matrix): permit 8-char hex correlation prefix in messages (per Tier 3 plan §3.1)`. Verify T6 grep passes.
3. **Doc sync commit:** update `server/api/auth/README.md`, `server/api/location/README.md`, `server/api/strategy/README.md` per §3.2; append the `LESSONS_LEARNED.md` entry per §3.3; commit with message `docs(logger): document matrixLog taxonomy in auth/location/strategy READMEs + LESSONS_LEARNED for Tier 3`. Verify T8 + T9 grep pass.
4. **`claude_memory` row for Rule 2 staleness:** insert a row with `category='audit', priority='medium', status='active'` titled "CLAUDE.md Rule 2 stale: claims sub-READMEs deleted 2026-04-18 but 51 still exist as of 2026-05-02" — content describes the discrepancy and notes the Rule 2 rewrite is out of scope for this batch. Capture the inserted `id`.
5. Edit `server/api/auth/auth.js` — migrate every log call; apply modified Option (ii) at the 13 PII sites; `node --check` after each logical block.
6. Edit `server/api/location/location.js` — migrate every log call; coords/address dropped entirely; `node --check`.
7. Edit `server/api/strategy/blocks-fast.js` — migrate every `triadLog`/`[VERIFY]` call; city/state/coords dropped; `node --check`.
8. Run §5 mechanical tests (**T1–T9**, including the three new ones).
9. Run static tests (T6–T8 — wait, these are in §5; renumbered: T_static_a `npm run lint`, T_static_b `npm run typecheck`, T_static_c `node --check` on the migrated files).
10. Boot dev server (`npm run dev`); run smoke tests (T9–T11 from §5 — login flow, snapshot flow, end-to-end pipeline); capture stdout/stderr to a log file for review.
11. **Code migration commit:** `feat(logger): Tier 3 batch 1 — migrate auth.js, location.js, blocks-fast.js to matrixLog (PII scrub)`. Body cites §3.1 spec amendment commit + §3.2/§3.3 doc commit by SHA.
12. Insert / update `claude_memory` row summarizing the batch completion (status=`active` until merged, then flip to `resolved`).
13. Report back here with: each commit's SHA, log capture excerpt (login + snapshot lines), grep-test output (T1–T9), `claude_memory` row IDs (Rule 2 staleness flag + batch summary).
14. **Pause.** Await Melody's "All tests passed" sign-off before any further work — including any push, PR creation, or follow-up Tier 3 batches.

---

**Awaiting your call on §3 (Option (i) spec-literal vs Option (ii) keep-userId-prefix). Once answered, I run the migration in the worktree, post log capture + grep results, and you do the "All tests passed" review.**
