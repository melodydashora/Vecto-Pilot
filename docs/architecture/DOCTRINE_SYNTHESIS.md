# Doctrine Synthesis — Architecture Read Pass

**Date:** 2026-04-16
**Author:** Claude Code + architect review
**Source commit:** 7670a63b
**Purpose:** Consolidated doctrine read-pass for architect decision-making. This file becomes the durable reference so we do not repeat the read pass.

> **2026-05-03 update (Workstream 1 Split-Brain Governance Audit):** This file is a snapshot of doctrine as it stood on 2026-04-16. Several references below cite `docs/review-queue/pending.md`, which was **retired on 2026-04-29**. The canonical "unfinished work" surface is now the `claude_memory` table — see CLAUDE.md Rules 3, 12, and 15 for the canonical query. The quoted text below is preserved for historical fidelity; do not act on `pending.md` references — translate them mentally to `claude_memory` active rows when consuming this synthesis.

---

## === CONSTRAINTS.md (165 lines) ===

**Purpose:** Environment variable and model parameter documentation — NOT an actual constraints document despite the name.

**Hard rules:** None. This file contains no MUST/NEVER/CRITICAL/ALWAYS directives. It documents Claude Opus 4.6 parameters, Triad configuration, voice settings, holiday detector config, and credential inventory.

**What the doc says is true today:** Model parameters for Claude Opus 4.6 (200K context, ultra-deep thinking), Triad mode = single_path, location uses IANA timezones.

**Open gaps:** This file is mislabeled — it's an env-var audit, not an architecture constraints doc. No actual constraints are codified here.

**Contradictions spotted:** The filename implies authoritative constraints but contains none. Any developer looking for "what must I never do" won't find it here.

**Architect read:** This file should either be renamed to `ENV_VARS.md` or rewritten as an actual constraints document. Currently it provides zero governance. The real constraints live in DECISIONS.md and DEPRECATED.md.

---

## === DECISIONS.md (332 lines) ===

**Purpose:** 14 active architectural decisions with rationale and history.

**Hard rules (exact quotes with line numbers):**

1. **Line 7-18 — Single-Path Orchestration Only:** "No fallbacks, no hedging, no router fallbacks in TRIAD." (line 27)
2. **Line 20-34 — Coordinates from Google or DB, Never from AI:** Decision states AI-generated coordinates are unreliable and must be validated against Google Places. *(Note: enforced via P0-6 fix on 2026-04-16.)*
3. **Line 52-64 — Fail-Fast, No Stub Data:** If an API fails, throw — don't return placeholder data.
4. **Line 65-79 — Key-Based Merge, Never Index:** Merge venue data by `place_id` or `name`, never by array index position.
5. **Line 80-91 — Server Truth for Coordinates:** Server is the authority for venue coordinates. Client must not override. GPT-5.2 system prompt includes "CRITICAL constraint" (line 200).

**What the doc says is true today:** All 14 decisions marked "Active" in the history table (lines 259-273). None deprecated or superseded.

**Open gaps:** Decision #2 ("Coordinates from Google, Never from AI") was violated until 2026-04-16 P0-6 fix. The decision table still says "No changes" — should be updated to note the fix.

**Contradictions spotted:** Decision #2 says coordinates must come from Google, but `tactical-planner.js` was asking the LLM for "EXACT COORDINATES" until our P0-6 fix. The doc was right, the code was wrong — now aligned.

**Architect read:** This is the strongest governance document. It should be the first file any new session reads. The decision history table is well-maintained. Consider adding our new contracts (hours trust, always-6, driver prefs as tiebreaker) as entries #15-17.

---

## === ACCESSIBILITY.md (263 lines) ===

**Purpose:** WCAG 2.1 compliance status and gap inventory.

**Hard rules:**
1. **Line 27-31:** WCAG Level A = Partial, Level AA = Partial (target), Level AAA = Not assessed.
2. **Lines 60-66:** 6 components missing ARIA attributes (BottomTabNavigation, MapTab, RideshareCoach, BarsMainTab, BriefingPage, SmartBlocksPipeline).
3. **Lines 228-234:** 7 known gaps including: no reduced motion, touch targets too small (40px vs 44px target), map not accessible, no skip links, color-only indicators.

**What the doc says is true today:** Shadcn/Radix UI provides good baseline ARIA. Custom components have mixed coverage. Color contrast passes AA.

**Open gaps:** 10 TODO items at lines 240-249, all unchecked. P1: reduced motion, touch targets, skip link. P2: aria-live on chat, map marker labels. P3: zoom testing, full audit.

**Contradictions spotted:** None with other docs.

**Architect read:** Honest assessment. The P1 items (reduced motion, touch targets, skip links) are table stakes for any app store submission and should be bundled with the mobile native-wrapper work referenced in FEASIBILITY.md.

---

## === DB_SCHEMA.md (340 lines) ===

**Purpose:** Database schema documentation, migration policy, and gap inventory.

**Hard rules (exact quotes with line numbers):**
1. **Line 10-14 — Trust Tiers:** `shared/schema.js` is "Always authoritative. The single source of truth for all table definitions." `scripts/create-all-tables.sql` is "DO NOT use for recovery."
2. **Line 5:** "Always check that section before assuming the documented schema matches prod."
3. **Line 279-286 — Migration Policy:** "Every direct-SQL exception MUST be recorded in the exceptions table below AND in `docs/review-queue/pending.md` before deployment" *(historical quote — `pending.md` retired 2026-04-29; current canon: `claude_memory` active rows)*
4. **Line 74:** `formatted_address` is "CRITICAL for LLM" in the snapshots table.

**What the doc says is true today:** 57 tables via Drizzle, 25-connection pool, 27 Drizzle-managed migrations + direct-SQL exceptions.

**Open gaps (line 290-294 — Exceptions Table):**

| Change | Dev DB | Prod DB |
|--------|--------|---------|
| `discovered_events.schema_version` | Applied 2026-04-14 | **Pending** |
| `claude_memory` table | Applied 2026-04-14 | **Pending** |
| `driver_profiles` — 4 preference columns | **Deferred** | **Deferred** |

**driver_profiles section (line 191-193):** Brief — "65+ columns including identity, location preferences, vehicle eligibility, service preferences, account status." Full schema is in `shared/schema.js`, not here.

**Contradictions spotted:** None internally. The deferred status for the 4-column migration aligns with pending.md *(historical — pending.md retired 2026-04-29)*.

**Architect read:** The trust-tier framework is strong. The exceptions table is the right mechanism for tracking direct-SQL changes. The file should be updated to note that our P0-6 commit now depends on the deferred `max_deadhead_mi` column (with fallback default until migration runs).

---

## === DEPRECATED.md (248 lines) ===

**Purpose:** 14 explicitly deprecated patterns with rationale, preventing AI-assisted regression.

**Hard rules (exact quotes, lines 227-241):**

**"DO NOT:"** (line 227)
- Re-implement multi-model fallbacks
- Add global JSON parsing
- Use index-based merging
- Allow client to override server coordinates
- Add stub/placeholder data for API failures
- Create development-only behavior

**"INSTEAD:"** (line 235)
- Use single-path TRIAD pipeline
- Use per-route JSON parsing
- Use key-based merging (place_id/name)
- Trust server as source of truth
- Fail fast and visibly
- Same behavior in dev and production

**What the doc says is true today:** All 14 items removed/replaced. No deprecated patterns remain in code.

**Open gaps:** None — this doc is complete.

**Contradictions spotted:** Item #2 ("Perplexity Integration — REMOVED") says it was removed, but `server/lib/external/perplexity-api.js` still exists in the codebase (624 lines, referenced in AUDIT.md P1-9). The file appears to still be imported somewhere.

**Architect read:** Excellent anti-regression document. The "DO NOT / INSTEAD" section at the end is the single most valuable paragraph for preventing AI assistants from reverting decisions. The Perplexity contradiction should be investigated — either the file is truly dead code (delete it) or the deprecation note is premature.

---

## === CONCIERGE.md (253 lines) ===

**Purpose:** Share-mode architecture for the passenger-facing QR code experience.

**Hard rules:**
1. **Line 106:** Fields marked "NEVER Exposed" in the data exposure model — PII protected from public endpoints.
2. **Lines 70-77:** Rate limits: 20/min profile, 10/min weather, 5/min explore, 3/min ask, 2/min feedback.

**What the doc says is true today:** Token system working, public profile working, streaming Q&A working, rate limiting working, PII removal working (2026-04-10 fix).

**Open gaps (lines 234-239):** 6 TODO items — token expiration, analytics, multi-language, ride-linked feedback, vehicle data enforcement, tipping.

**Contradictions spotted:** None.

**Architect read:** Clean, well-bounded feature. Token expiration (TODO #1) is the most impactful gap — currently tokens never expire until manually revoked, which is a mild security concern for a public endpoint.

---

## === BRIEFING.md (437 lines) ===

**Purpose:** Briefing pipeline architecture — the 6-source parallel data gathering system.

**Hard rules:**
1. **Lines 238-244:** Backoff config: 2s→4s→8s→16s→30s, max 12 attempts, ~3 min total coverage.
2. **Lines 249-256:** Weather and school closures do NOT poll (one-shot). Traffic, news, events, airport DO poll with backoff.

**What the doc says is true today:** 6-source parallel generation working (60-90s typical). SSE `briefing_ready` notification working. Client polling with backoff working.

**Open gaps (lines 411-420):** 10 TODO items. Most impactful: per-source SSE events, TomTom quota monitoring, stale-while-revalidate pattern.

**Contradictions spotted:** Lists 15 API endpoints but API_REFERENCE.md only lists 3 briefing-adjacent endpoints. The API reference is severely incomplete.

**Architect read:** The most complex pipeline in the app. The "wasted API calls" section (lines 343-370) is a good self-critique. The stale-while-revalidate TODO is the right next UX improvement — showing a 90-second blank screen while briefing generates is the #1 friction point for returning users.

---

## === AI_RIDESHARE_COACH.md (383 lines) — LEGACY ===

**Purpose:** Original coach architecture doc. Lines 3-4: "This is a LEGACY file, consolidated into RIDESHARE_COACH.md on 2026-04-14."

**Hard rules:**
1. **Lines 126-127:** "Full schema read access" and "write via action tags only" — the coach reads everything but writes only through structured action tags parsed from its response.

**What the doc says is true today:** 11 action tag types, 11 context data sources, streaming chat, vision/OCR, Google Search grounding — all working per the current state table (lines 336-346).

**Open gaps:** 7 TODO items (lines 363-369). Key: context size estimation, conversation summarization, per-user rate limit.

**Contradictions spotted:** This file lists `AICoach.tsx` (line 382) as the client component, but the actual component is `RideshareCoach.tsx`. The legacy file is stale on this point; RIDESHARE_COACH.md has the correct reference.

**Architect read:** Should add a prominent "SUPERSEDED — see RIDESHARE_COACH.md" banner at line 1 rather than a subtle note at line 3. Developers will find this file first via search.

---

## === API_REFERENCE.md (28 lines) ===

**Purpose:** API endpoint quick-reference.

**Hard rules:** None.

**What the doc says is true today:** Lists 14 endpoints across Chat, Location, and Health. All appear accurate.

**Open gaps:** Massively incomplete — 28 lines vs 45+ endpoints across the codebase. Missing: all briefing endpoints, all concierge endpoints, all venue endpoints, all strategy endpoints, all auth endpoints, all feedback endpoints, all intelligence endpoints.

**Contradictions spotted:** Conflicts with BRIEFING.md (15 endpoints not listed), CONCIERGE.md (11 endpoints not listed), AUTH.md (9 endpoints not listed).

**Architect read:** This file is nearly useless in its current state. Either expand it to cover all endpoints or delete it and point to the per-feature docs. A 28-line "reference" that covers <30% of endpoints is worse than no reference because it implies completeness.

---

## === AUTH.md (411 lines) ===

**Purpose:** Authentication architecture — login methods, token lifecycle, session management.

**Hard rules (exact quotes with line numbers):**
1. **Line 105:** "the user MUST sign in manually after registration"
2. **Line 106:** "Future clients or SDK consumers should not assume '/register' auto-logs in."
3. **Line 183:** "Fail-closed on DB errors" — auth middleware returns 503, doesn't silently pass.
4. **Lines 250-253:** Session limits: 60-min sliding window + 2-hour hard limit.

**What the doc says is true today:** Email/password + Google OAuth working. Uber OAuth for platform data only (not login). Apple OAuth = stub (501). Account lockout: 5 failures = 15-min lock.

**Open gaps (lines 383-392):** 10 TODO items. Critical: dedicated auth rate limiter (currently global only), token refresh (currently no refresh mechanism), standard JWT migration, Apple OAuth (required for iOS App Store).

**Contradictions spotted:** None with other docs.

**Architect read:** The custom HMAC-SHA256 token format (not standard JWT) is tech debt that blocks third-party integrations and SDK consumers. The JWT migration TODO is correctly flagged but has no timeline. Apple OAuth is a hard blocker for iOS distribution.

---

## === FUTURE.md (289 lines) ===

**Purpose:** Consolidated roadmap — aggregates all TODO items from all docs into priority tiers.

**Hard rules:** None — this is a planning document.

**What the doc says is true today:** Organizes ~100 TODO items from 19 architecture docs into P0-P3 priority tiers.

**Open gaps:** P0 Security Critical (lines 252-257): dedicated auth rate limiter, standardized JWT, production secrets audit. P1 User-Facing (lines 258-263): Apple OAuth, reduced motion, coach streaming fallback, stale-while-revalidate.

**Contradictions spotted:** Lists Perplexity integration as removed (via DEPRECATED.md) but `perplexity-api.js` still exists in the codebase.

**Architect read:** Good aggregation. The priority tiers are correct. This doc should be the session-start "what to work on next" reference alongside AUDIT.md.

---

## === FEASIBILITY.md (200 lines) ===

**Purpose:** Technical feasibility assessment — scaling limits, mobile plans, offline capability.

**Hard rules:** None — assessment document.

**What the doc says is true today (lines 38-40):** Comfortable at 5-10 concurrent users, stressed at 10-25, breaking at 25+. Single PostgreSQL instance, no read replicas.

**Open gaps:** PWA vs native assessment (lines 72-81) recommends native wrappers as first step. 5 TODO items (lines 183-187): load testing, PWA config, native shell, capacity dashboard, multi-platform hosting.

**Contradictions spotted:** None.

**Architect read:** The 25-user breaking point is real given the LLM call volume per snapshot. The recommendation for native wrappers (WebView + native bridges) before full native is pragmatic. No changes needed.

---

## === full-audit-2026-04-04.md (263 lines) ===

**Purpose:** Prior comprehensive audit — 37 findings across 13 sections.

**Hard rules:** None — audit findings, not governance.

**What the doc says is true today:** 13 findings fixed (5 critical + 8 high briefing bugs). 24 findings remain unfixed across: unprotected JSON.parse (7 files), silent promise rejections (8 patterns), outdated npm deps (22 packages), stale docs (7 documents), dead code (13 items), ESLint violations (4), architectural concerns (5).

**Open gaps:** AUDIT.md (2026-04-16) supersedes this with 30 additional findings. The unfixed items from this audit were cross-referenced in AUDIT.md sections P1-9, P1-4, P2-5, P2-6, P2-7, P2-8.

**Contradictions spotted:** None — our AUDIT.md explicitly builds on this document.

**Architect read:** This audit was the foundation. The 2026-04-16 AUDIT.md extends it. Both should be referenced per Rule 12.

---

## === RIDESHARE_COACH.md (205 lines) ===

**Purpose:** Current coach architecture doc (replaces AI_RIDESHARE_COACH.md as of 2026-04-14).

**Hard rules:** None explicit, but the naming convention table (lines 8-23) standardizes terminology across 10 contexts.

**What the doc says is true today:** 11 action tag types, voice integration (STT working, TTS working, OpenAI Realtime deprecated), coach personality documented.

**Open gaps (lines 167-174):** 7 TODO items (2 done, 5 open). Key unfixed: streaming fallback (COACH-H7), fire-and-forget conversation saves (COACH-H8) — both also in AUDIT.md as P1-13 and P1-14.

**Contradictions spotted:** Legacy doc lists `AICoach.tsx` vs this doc correctly lists `RideshareCoach.tsx`.

**Architect read:** Clean replacement of the legacy doc. COACH-H7 and COACH-H8 are the two most impactful remaining coach gaps, acknowledged across multiple documents.

---

## === pending.md (90 lines, RETIRED 2026-04-29) ===

> **Note:** This section synthesizes the contents of `docs/review-queue/pending.md` as of the 2026-04-16 read pass. The file was retired 2026-04-29; current "unfinished work" tracking lives in `claude_memory`. Treat the items below as historical context, not an active queue.

**Purpose:** Migration queue and test-approval backlog.

**Migration SQL (lines 31-36, exact quote):**
```sql
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS fuel_economy_mpg integer,
  ADD COLUMN IF NOT EXISTS earnings_goal_daily numeric(10,2),
  ADD COLUMN IF NOT EXISTS shift_hours_target numeric(4,1),
  ADD COLUMN IF NOT EXISTS max_deadhead_mi integer;
```

**Verification checklist (lines 40-43, exact quote):**
- [ ] **Melody: Run migration on dev DB** → verify driver profile updates work
- [ ] **Melody: Run migration on prod DB** → after dev verification
- [ ] **Melody: Update a real driver profile** with non-null values for all four fields
- [ ] **Melody: Monitor server logs** for `[strategist-enrichment] loadDriverPreferences failed` warnings

**Status: BLOCKED on DB migration** (line 45)

**Other pending items:**
- 2026-04-14: Claude Memory Table (README updates needed, dev applied, prod pending)
- 2026-04-04: Full audit — AWAITING PRIORITIZED IMPLEMENTATION
- 2026-03-29: Analyze-Offer overhaul — AWAITING TEST APPROVAL
- 2026-04-04: Frontend crash fix — AWAITING TEST APPROVAL
- 2026-04-04: MapTab infinite loop fix — AWAITING TEST APPROVAL

---

## === SYNTHESIS ===

### Top 5 Hard Rules That Govern Every Future Decision

1. **"Coordinates from Google or DB, Never from AI"** — DECISIONS.md line 20. Now enforced by P0-6. AI models emit venue names; coordinates come from Google Places text search.

2. **"Fail-Fast, No Stub Data"** — DECISIONS.md line 52, DEPRECATED.md line 231. If an API fails, throw. Don't return placeholders. Don't silently degrade.

3. **`shared/schema.js` is "Always authoritative. The single source of truth for all table definitions."** — DB_SCHEMA.md line 10. All other schema representations (docs, SQL scripts) defer to this file.

4. **"Every direct-SQL exception MUST be recorded in the exceptions table AND in pending.md before deployment"** — DB_SCHEMA.md line 282. No rogue migrations. *(Historical quote — pending.md retired 2026-04-29; DB_SCHEMA.md was updated 2026-05-03 in the Workstream 1 audit to point at `claude_memory`.)*

5. **"DO NOT: Re-implement multi-model fallbacks / Add global JSON parsing / Use index-based merging / Allow client to override server coordinates / Add stub/placeholder data / Create development-only behavior"** — DEPRECATED.md lines 227-233. Anti-regression guardrails.

### Top 5 Observable Gaps Between Doctrine and Current Code

1. **DECISIONS.md #2 was violated until 2026-04-16** — The decision said "Coordinates from Google, Never from AI" but `tactical-planner.js` asked the LLM for "EXACT COORDINATES" until P0-6 landed. Decision history table should be updated.

2. **API_REFERENCE.md covers <30% of endpoints** — 28 lines vs 45+ real endpoints. BRIEFING.md alone documents 15 endpoints not in the reference.

3. **DEPRECATED.md says Perplexity was "REMOVED"** but `server/lib/external/perplexity-api.js` (624 lines) still exists and is referenced in AUDIT.md P1-9's unprotected JSON.parse list.

4. **CONSTRAINTS.md is not a constraints document** — Contains env-var documentation, not architecture constraints. The actual constraints are scattered across DECISIONS.md and DEPRECATED.md.

5. **RIDESHARE_COACH.md and AI_RIDESHARE_COACH.md both exist** — The legacy file has a small note at line 3 saying it's superseded, but it's easy to find first via search and has stale info (wrong component name).

### Top 3 Contradictions to Resolve

1. **Perplexity: removed vs still present** — DEPRECATED.md says removed (line 26), but `perplexity-api.js` exists with 624 lines. Either delete the file or update the deprecation note to "partially removed."

2. **API_REFERENCE.md vs feature docs** — The reference implies it's comprehensive but omits ~70% of endpoints. Either complete it or add a disclaimer directing readers to per-feature docs.

3. **Coach component name** — AI_RIDESHARE_COACH.md references `AICoach.tsx` (line 382), RIDESHARE_COACH.md correctly references `RideshareCoach.tsx`. The legacy doc misleads.

### Top 3 Under-Documented Areas (Doctrine Missing, Code Exists)

1. **Driver preference scoring** — Built on 2026-04-16. No architecture doc governs how preferences influence venue ranking, the tiebreaker-not-override principle, or the beyond_deadhead flag. ARCHITECTURE_REQUIREMENTS.md §4 covers the contract but there's no standalone PREFERENCES.md or SCORING.md.

2. **The "always-6" venue count contract** — Codified in the P0-6 resolver chain and ARCHITECTURE_REQUIREMENTS.md §3, but not in DECISIONS.md or any long-standing governance doc. A new developer wouldn't know this constraint exists without reading the 2026-04-16 commit.

3. **Build & serve architecture** — No pre-existing doc explains that the client is a pre-built static bundle served by `express.static`, there's no Vite HMR, and edits require `npm run build:client`. ARCHITECTURE_REQUIREMENTS.md §0 covers this (written 2026-04-16) but it's not in any of the original architecture docs.

### Recommended Next Actions

| # | Action | Scope | Blast Radius | What Changes for the Driver |
|---|--------|-------|--------------|----------------------------|
| 1 | **Run the 4-column pending migration** (synthesized from pending.md:31-36 *— historical; pending.md retired 2026-04-29, see `claude_memory` for current tracking*) | 1 SQL statement, 4 columns | Zero — `ADD COLUMN IF NOT EXISTS` is safe, and `loadDriverPreferences()` already handles both states | Drivers can eventually set real deadhead/fuel/goal prefs once SettingsPage UI is built |
| 2 | **Delete or gut `perplexity-api.js`** to resolve the DEPRECATED.md contradiction | 1 file delete + grep for imports | Low — if truly dead code, no runtime change; if still imported, need to trace and redirect | None directly — removes dead code / resolves doc contradiction |
| 3 | **Add decisions #15-17 to DECISIONS.md** (Hours Trust, Always-6, Prefs-as-Tiebreaker) | ~30 lines in 1 doc | Zero — doc-only | None — governance clarity |
| 4 | **Rename CONSTRAINTS.md to ENV_VARS.md** or rewrite as actual constraints | 1 file rename | Zero — doc-only | None |
| 5 | **Add "SUPERSEDED" banner to AI_RIDESHARE_COACH.md** line 1 | 1 line | Zero | None |
| 6 | **Expand API_REFERENCE.md or delete it** | 1 file, ~200 lines if expanded | Zero — doc-only | None directly — developer productivity |
| 7 | **Build `max_deadhead_mi` slider in SettingsPage** | 1 client component + 1 API endpoint | Medium — requires pending migration first | Drivers can set how far they're willing to deadhead; venues beyond that distance get flagged |
