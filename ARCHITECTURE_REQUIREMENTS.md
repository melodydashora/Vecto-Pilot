# Architecture Requirements — Contracts

**Established:** 2026-04-16
**Authority:** These contracts govern implementation decisions. Code that violates a contract is a bug, not a tradeoff.
**Cross-references:** `AUDIT.md`, `FEATURE_AUDIT.md`, `CLAUDE.md` (Rules 1-14)

---

## Section 0: Build & Serve Architecture

**Status: CRITICAL — Active source of wasted engineering time**

### Contract

This application serves a **pre-built static client bundle**. There is no Vite dev server, no Hot Module Replacement (HMR), and no live-reload in this environment. Every `.tsx` / `.ts` / `.css` edit to client code requires a manual rebuild before changes appear in the browser.

### Architecture

```
gateway-server.js (line 106)
  └─ app.use(express.static(distDir))     // distDir = client/dist
      └─ dist/index.html                   // References hashed JS/CSS bundles
          └─ dist/assets/index-{hash}.js   // Compiled client code
```

- `gateway-server.js:31` — `const distDir = path.join(__dirname, 'client', 'dist')`
- `gateway-server.js:106` — `app.use(express.static(distDir))`
- `gateway-server.js:163` — SPA catch-all: `res.sendFile(path.join(distDir, 'index.html'))`
- `package.json` — `"build:client": "vite build"`

### Incident Reference

**2026-04-16 Concierge chip fix session:** Source edits to `AskConcierge.tsx` (suggested question text + flex-wrap layout) were verified correct on disk but the live page at `/c/{token}` still served the old bundle. Root cause: `npm run build:client` was never run after the edits. The old compiled JS (`index-{old-hash}.js`) continued to be served by `express.static`. Resolution: ran `npm run build:client`, new bundle hash appeared in `dist/index.html`, live page updated.

### Checklist — After Any Client Code Edit

- [ ] Run `npm run build:client` (takes ~20s)
- [ ] Verify new bundle hash in `client/dist/index.html` (script src changes)
- [ ] Hard-refresh browser if needed (Ctrl+Shift+R) — though hashed filenames should bust cache automatically
- [ ] If change is not visible: check `gateway-server.js` is still running (`ps aux | grep gateway`)
- [ ] Do NOT look for a Vite dev server — there isn't one in this environment

### Why This Matters

`express.static` reads from disk on each request (no in-memory caching), so a rebuild is sufficient — no server restart needed. But if you skip the build, your edits exist only in source files that nothing serves.

---

## Section 1: Venue Hours Trust Contract

**Status: VIOLATED — See AUDIT.md P0-1**

### Contract

A venue displayed in the Bars/Lounges tab or Smart Blocks output as "open" or available **must have confirmed operating hours from Google Places API**. A Haiku quality-tier classification (P/S/X) confirms venue *type*, not venue *operating status*. These are orthogonal dimensions:

| | Hours Confirmed | Hours Unknown |
|---|---|---|
| **Haiku: Premium** | Show as open | Label "Hours Unknown" in UI |
| **Haiku: Standard** | Show as open | Label "Hours Unknown" in UI |
| **Haiku: Excluded** | Drop | Drop |
| **No Haiku tier** | Show as open | Drop |

### Current Violation

`server/lib/venue/venue-intelligence.js` conflates quality tier with operating status:

**Fresh path (line 645-647):**
```javascript
if (v.isOpen === null && v.venue_quality_tier) {
  v.hours_unknown = true;
  return true;  // ← PASSES filter despite unknown hours
}
```

**Cache path (line 487-489):**
```javascript
if (v.isOpen === null && v.venue_quality_tier) {
  v.hours_unknown = true;
  return true;  // ← Same violation
}
```

**What must change:** Lines 645-647 and 487-489 must either (a) exclude `isOpen===null` venues from the "open now" result set entirely, or (b) include them in a separate "Hours Unknown" section that the UI renders distinctly. The `hours_unknown: true` flag exists but the UI does not differentiate.

**`calculateOpenStatus()` (line 42-46):** Returns `is_open: null` when Google Places has no `currentOpeningHours`. This is correct behavior — the issue is downstream filter logic, not the status calculation.

### Scope

Both Bars/Lounges tab and Smart Blocks must honor this contract. Smart Blocks venues go through `venue-enrichment.js` which calls the same Google Places API — if Places returns no hours, the venue must be flagged.

---

## Section 2: Weekday Parsing Contract

**Status: VIOLATED — See AUDIT.md P0-2**

### Contract

All weekday name matching in this codebase **must delegate to the canonical `WEEKDAY_MAP`** defined in `server/lib/venue/hours/parsers/google-weekday-text.js:31-38`. No other file may implement its own day-name matching logic.

### Canonical Implementation

`google-weekday-text.js:31-38`:
```javascript
const WEEKDAY_MAP = {
  'sunday': 'sunday', 'sun': 'sunday',
  'monday': 'monday', 'mon': 'monday',
  'tuesday': 'tuesday', 'tue': 'tuesday', 'tues': 'tuesday',
  'wednesday': 'wednesday', 'wed': 'wednesday',
  'thursday': 'thursday', 'thu': 'thursday', 'thur': 'thursday', 'thurs': 'thursday',
  'friday': 'friday', 'fri': 'friday',
  'saturday': 'saturday', 'sat': 'saturday'
};
```

Usage at `google-weekday-text.js:129-137`:
```javascript
const colonIdx = line.indexOf(':');
const dayPart = line.slice(0, colonIdx).trim().toLowerCase();
const day = WEEKDAY_MAP[dayPart];  // Handles ALL abbreviations
if (!day) return null;
```

### Current Violation

`server/lib/venue/venue-intelligence.js:99-101` implements its own parser:
```javascript
const todayHours = weekdayDescs.find(d =>
  d.toLowerCase().startsWith(todayName.toLowerCase())  // "thu:..." does NOT startsWith("thursday")
);
```

This fails for ALL abbreviated day formats — not just Thursday. Any venue where Google returns "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", or "Sun" format will show "Could not find {day} in weekdayDescriptions".

### Required Fix

Export `WEEKDAY_MAP` from `google-weekday-text.js` and use it in `venue-intelligence.js:99-101`:
```javascript
const todayHours = weekdayDescs.find(d => {
  const colonIdx = d.indexOf(':');
  if (colonIdx === -1) return false;
  const dayPart = d.slice(0, colonIdx).trim().toLowerCase();
  const resolved = WEEKDAY_MAP[dayPart];
  return resolved === todayName.toLowerCase();
});
```

Per CLAUDE.md Rule 9: all findings are high priority; duplicate logic is a bug.

---

## Section 3: Venue Coordinate Trust Contract

**Status: VIOLATED — See AUDIT.md P0-6**

### Contract

Coordinates used for distance calculation, routing, or navigation display **must originate from Google Places API**, not from AI model output. AI models may suggest venue *names* and *categories*, but their coordinate knowledge is unreliable (typically 50-150m off target).

### Current Violation

`server/lib/strategy/tactical-planner.js:127`:
```
"Your job: Convert the IMMEDIATE action plan into specific venues with EXACT COORDINATES."
```

The VENUE_SCORER (GPT-5.4) generates lat/lng from its training data. Post-validation at `tactical-planner.js:373-376` only filters null values:
```javascript
const validVenues = allVenues.filter(v => v.lat != null && v.lng != null);
```

Any numeric coordinate passes — there is no distance-from-Google-Places check.

### Compensating Mechanism (Insufficient)

`venue-enrichment.js:391` uses a 500m search radius (increased from 150m):
```javascript
radius: 500.0, // 500m radius - Increased from 150m to catch venues with slight coord mismatch
```

This catches most mismatches but introduces false positives. Example from AUDIT.md P0-6: "Hall Park Hotel" → "Rallytown Sportswear" at 82m distance, 0% name match.

### Required Architecture

1. **Short-term:** VENUE_SCORER returns venue names + city/district. Coordinates come FROM Google Places text search, not from the AI.
2. **Interim:** Reduce nearby search radius to 250m. If no match at 250m OR `calculateNameSimilarity()` < 0.20, fall through to text search immediately.
3. **Name similarity** (`venue-enrichment.js:530-550`): Simple word overlap. Consider Levenshtein or trigram matching for robustness (P2-4).

---

## Section 4: Driver Preference Scoring Contract

**Status: NOT IMPLEMENTED**

### Contract

Venue scoring in Smart Blocks **must incorporate driver preferences** when available. The ranking pipeline must treat `user_id` as a scoring input, not merely an attribution tag.

### Current State

`server/lib/strategy/tactical-planner.js:68-81`:
```javascript
export async function generateTacticalPlan({ strategy, snapshot, briefingContext }) {
```

The function signature accepts only `strategy`, `snapshot`, and `briefingContext`. No `driverPreferences`, `homeBase`, `deadheadTolerance`, or `venueTypePrefs` parameter exists.

`server/api/strategy/blocks-fast.js:255-267` passes `user_id` as an option:
```javascript
await generateEnhancedSmartBlocks({
  snapshotId,
  immediateStrategy: strategyRow.strategy_for_now,
  briefing: briefingRow,
  snapshot: snapshot,
  user_id: options.userId || snapshot.user_id,
```

But `user_id` is used only for DB attribution (writing `ranking_candidates.user_id`), not for scoring or filtering.

### Required Architecture

1. Add `driverPreferences` parameter to `generateTacticalPlan()` — sourced from `driver_goals` and `driver_profiles` tables
2. Include in VENUE_SCORER prompt: home base coords (deadhead awareness), venue-type preferences, shift time preferences
3. Post-scoring: apply preference-based re-ranking (boost venues matching driver prefs, penalize venues exceeding deadhead tolerance)

### Relevant Tables
- `driver_goals` — earnings targets, shift preferences
- `driver_profiles` — home address, platform preferences
- `driver_vehicles` — vehicle constraints (seatbelt count limits passenger capacity)

---

## Section 5: Strategic Venue Selection Contract

**Status: ARCHITECTURAL DIVERGENCE — Requires product decision**

### Contract

The Bars/Lounges tab and Smart Blocks must either:
- **(A)** Share a common "closest high-impact venue" scoring pipeline, OR
- **(B)** The Bars tab must be clearly labeled as a "Nearby Venues" utility so users don't assume strategic intent

### Current Divergence

**Smart Blocks pipeline** (`blocks-fast.js` → `tactical-planner.js` → `venue-enrichment.js`):
- Uses VENUE_SCORER (GPT-5.4) with strategy context
- Incorporates briefing data (events, traffic, weather)
- Optimizes for earnings potential
- 15-mile range with event-aware bucketing

**Bars/Lounges tab** (`venue-intelligence.js:348-358`):
```javascript
export async function discoverNearbyVenues({ lat, lng, city, state, radiusMiles = 25, timezone = null }) {
```
- Uses VENUE_FILTER (Haiku 4.5) for classification only
- No strategy context, no briefing data, no event awareness
- Sorts by expense rank (upscale first), not earnings potential
- Independent pipeline with zero references to strategy tables

`venue-intelligence.js:808-839` — `getSmartBlocksIntelligence()` runs venue discovery and traffic intelligence in parallel but does NOT consume strategy output:
```javascript
const [venueData, trafficData] = await Promise.all([venuePromise, trafficPromise]);
```

### The Divergence

A user seeing the Bars tab expects "where should I go for bar/lounge surge?" (strategic). The tab actually answers "what upscale bars are near me?" (utility). These overlap when the driver is already in a surge zone, but diverge significantly when strategy would recommend repositioning.

### Required Decision

Document which model (A or B) the product adopts, then align the implementation.

---

## Section 6: Translation UX Contract

**Status: KNOWN UX DEBT — Intentional policy, not a bug**

### Contract

The Translation feature requires **explicit rider-language selection** before translating. `targetLang='auto'` was deliberately removed and must not be reverted without product signoff.

### Design Decision Record

`client/src/components/co-pilot/TranslationOverlay.tsx:48-50`:
```javascript
// 2026-04-05: Removed 'auto' from language list (audit fix 1A).
// targetLang='auto' is undefined behavior — rider language must be explicitly selected.
// Auto-detect is valid for sourceLang (detecting what someone speaks) but NOT for targetLang.
```

**Enforcement at lines 168-171:**
```javascript
if (!riderLang) {
  toast({ title: 'Select rider language', ... });
  return;
}
```

### Rationale

- `sourceLang='auto'` (detecting what someone speaks) is supported and reliable — Gemini identifies the input language
- `targetLang='auto'` (guessing what language someone WANTS to hear) is undefined behavior — there's no signal to detect it from
- Mistranslation in a rideshare context (directions, safety, fares) has real-world consequences
- The friction of selecting a language is lower than the cost of a wrong translation

### Known UX Debt

The forced selection adds 1 tap of friction. Future improvements could include:
- Remembering last-used rider language per session
- Suggesting likely language based on pickup area demographics
- Quick-select for the 3 most common languages in the driver's market

**Any revert of this policy requires product signoff.** Reference this section in the PR description.

---

## Section 7: Memory & Observability Contract

**Status: PARTIALLY IMPLEMENTED — No shared IDs**

### Contract

Three persistence surfaces exist for driver intelligence. They **must share common identifiers** (`session_id`, `conversation_id`, `driver_id`) to enable cross-surface diagnostics joins.

### Three Surfaces

| Surface | Purpose | Storage | Current IDs | File |
|---------|---------|---------|-------------|------|
| **Coach Notes** (user-visible) | Driver-curated insights, tips, preferences | `user_intel_notes` table | `note.id` (int), `user_id` | `RideshareCoach.tsx:530-647` |
| **Memory Log** (system) | Session actions, rules, documentation | `claudeMemory` table | `session_id` (string), `category` | `server/api/memory/index.js:98-131` |
| **Operational Observability** (planned) | System health, pipeline metrics, error rates | TBD | TBD | Not yet implemented |

### Current ID Landscape

- **Coach Notes:** `user_id` (from auth), `note.id` (auto-increment), `created_by` (string)
- **Memory API:** `session_id` (caller-provided string), no `user_id` foreign key, no `conversation_id`
- **Agent Memory** (`useMemory.ts`): `userId` (string param), hits `/agent/memory/*` endpoints (lines 47, 78, 95, 114, 133, 152)
- **Coach Conversations:** `user_id`, `snapshot_id`, `conversation_id`, `parent_message_id` (`chat.js:1332-1345`)

### Required Architecture

1. All three surfaces must accept and store: `driver_id` (FK to `driver_profiles`), `session_id` (shared format), `conversation_id` (when applicable)
2. Memory API (`/api/memory`) must add optional `driver_id` and `conversation_id` fields
3. Coach Notes must propagate `conversation_id` from the coach session that created them
4. Observability surface (TBD) must use the same ID scheme from day one

---

## Section 8: Rideshare Coach Contract

**Status: IMPLEMENTED — Freeze current capability set**

### Contract

The following Rideshare Coach capabilities are **baseline requirements**. Any refactor that removes or degrades one of these is a regression and must not be merged.

### Frozen Capability Set

| # | Capability | Implementation | Lines |
|---|-----------|---------------|-------|
| C-1 | **Streaming chat** | SSE reader loop with delta accumulation | `RideshareCoach.tsx:376-435` |
| C-2 | **Persistent conversation state** | `saveConversationMessage()` to `coach_conversations` | `chat.js:1322-1352` |
| C-3 | **Notes panel** | Slide-out CRUD (fetch, delete, pin toggle, edit) | `RideshareCoach.tsx:90-92, 111-203, 530-647` |
| C-4 | **Memory logging on completion** | `useMemory` hook fires `logConversation()` 500ms after streaming ends | `RideshareCoach.tsx:216-235; useMemory.ts:93-109` |
| C-5 | **Voice input (mic)** | `useSpeechRecognition()` with toggle button | `RideshareCoach.tsx:83-84, 246-267, 792-807` |
| C-6 | **TTS output** | Auto-speak after stream; `cleanTextForTTS()` strips markdown/actions | `RideshareCoach.tsx:86-88, 270-281, 437-447` |
| C-7 | **File attachments** | Multi-file reader with base64 encoding, UI chips | `RideshareCoach.tsx:76, 283-307, 716-733` |
| C-8 | **Mic preflight** | Transcript→ref sync to prevent stale closures | `RideshareCoach.tsx:105-108` |

### Known Issues (Do Not Block Freeze)

- **C-2 regression risk:** Conversation saves are fire-and-forget — errors silently swallowed (`chat.js:1322-1352`, AUDIT.md P1-14). Fix: log at error level, return warning header.
- **C-1 no fallback:** AI_COACH role has no fallback model. If Gemini 3.1 Pro is down, coach is unavailable (AUDIT.md P1-13). Fix: add fallback in model-registry.
- **Action parse limits:** No cap on parsed actions count or size (AUDIT.md P1-8). Fix: cap at 20 actions, 10KB data.

### Regression Test Surface

Any PR touching `RideshareCoach.tsx`, `useMemory.ts`, `chat.js`, `tts.js`, or `realtime.js` must verify all 8 capabilities still function. Until automated E2E tests exist, manual verification is required.

---

## Change Log

### 2026-04-16 — Initial contracts codified post-audit

- **Section 0:** Build & Serve Architecture — documented `express.static` bundle serving, no-HMR environment, post-edit rebuild checklist
- **Section 1:** Venue Hours Trust Contract — quality tier is not a substitute for confirmed hours; AUDIT.md P0-1 violation documented
- **Section 2:** Weekday Parsing Contract — all day-name matching must use canonical WEEKDAY_MAP; AUDIT.md P0-2 violation documented
- **Section 3:** Venue Coordinate Trust Contract — AI coords must be validated against Google Places; AUDIT.md P0-6 violation documented
- **Section 4:** Driver Preference Scoring Contract — `user_id` is attribution-only; scoring must incorporate driver prefs
- **Section 5:** Strategic Venue Selection Contract — Bars tab and Smart Blocks are divergent pipelines; product decision required
- **Section 6:** Translation UX Contract — explicit rider-language selection is intentional policy; `targetLang='auto'` removal documented
- **Section 7:** Memory & Observability Contract — three surfaces must share common IDs for diagnostics joins
- **Section 8:** Rideshare Coach Contract — 8 capabilities frozen as baseline; regression test surface defined
