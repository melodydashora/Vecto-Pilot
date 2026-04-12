# Plan: Smart Blocks ↔ Discovered Events Alignment

**Status:** Implementation complete (2026-04-11) — awaiting Melody's test confirmation before marking as post-mortem
**Created:** 2026-04-11
**Author:** Claude Code (session with Melody)
**Scope:** Make `VENUE_SCORER` produce venue recommendations that coordinate with `discovered_events`, so the Strategy tab and Smart Blocks stop showing unrelated venues.

---

## 1. Problem Statement

### Symptom

The **Strategy tab** (produced by `STRATEGY_TACTICAL` role) recommends going to event venues: Deep Ellum, Majestic Theatre, Dallas Comedy Club, Fair Park, Billy Bob's Texas.

The **Smart Blocks** (produced by `VENUE_SCORER` role via `enhanced-smart-blocks.js`) recommend unrelated generic venues: Andretti, Galaxy Theatres, Cosm in The Colony/Grandscape. These venues have **no relationship to the events surfaced by the Strategy tab**.

A driver reading the briefing sees two AI outputs giving contradictory advice: "drive to the Majestic Theatre for tonight's show" alongside Smart Blocks telling them to drive 25 minutes north to Andretti.

### Scope constraint (from Melody)

> "Not without losing the best of all" — we must keep the quality of **Strategy**, **Events**, and **Venues** independently while improving their coordination. This is not a mandate to replace generic venues with event venues. It's a mandate to make event venues **first-class** in Smart Blocks **without demoting the best non-event recommendations**.

---

## 2. Root Cause Analysis

I read the full pipeline before writing this plan:

- `server/lib/venue/enhanced-smart-blocks.js` (364 lines — Smart Blocks orchestrator)
- `server/lib/strategy/tactical-planner.js` (311 lines — VENUE_SCORER prompt)
- `server/lib/briefing/filter-for-planner.js` (321 lines — briefing filter before prompt)
- `server/lib/venue/event-matcher.js` (146 lines — post-VENUE_SCORER event matching)

The disconnect has **five stacked causes**. Each one contributes independently. Fixing only some of them leaves the symptom partially present.

### Bug 1 — Events reach the prompt stripped of coords and address

**File:** `filter-for-planner.js:265-271`

```javascript
const eventLines = filteredBriefing.events.slice(0, 10).map(e => {
  const time = e.event_start_time || e.time || '';
  const venue = e.venue_name || e.venue || '';
  return `- ${e.title} at ${venue} (${time})`;
});
```

The prompt receives `"- Kathy Griffin Live at Majestic Theatre (20:00)"` — just title, venue name, start time. The model is then told to "prioritize venues near today's events" but it does not know:

- Where the Majestic Theatre is (no lat/lng, no address)
- What city it is in (critical for a metro-wide driver)
- When the event ends (critical for pickup-surge timing)
- The category (sports vs. comedy = very different surge patterns)
- Expected attendance (high/medium/low)

Without geographic data, VENUE_SCORER cannot reliably return the event venue itself as a recommendation — it would have to guess the coordinates, and the schema requires non-null `lat`/`lng` or the venue gets filtered out post-validation.

### Bug 2 — City-scoping bug in the event filter

**File:** `filter-for-planner.js:110-140`

```javascript
function filterEventsForPlanner(events, { today, userCity, userState }) {
  return events.filter(event => {
    if (isLargeEvent(event)) {
      return eventState.toLowerCase() === (userState || '').toLowerCase();
    }
    const eventCity = event.city || '';
    return eventCity.toLowerCase() === (userCity || '').toLowerCase();
  });
}
```

After the 2026-04-11 venue address correctness work, events store their **venue's** actual city as resolved by Google Places API — Arlington, Fort Worth, Frisco, Irving, etc. — not the driver's snapshot city.

For a Dallas driver, this filter drops every small (non-stadium) event whose venue is not literally in Dallas. Only "large" events (categorized as sports or concert, or with stadium/arena keywords) survive.

**This is the same bug we already fixed in `briefing-service.js` and `briefing.js` event routes.** Those three queries are now state-scoped. This one was missed because `filter-for-planner.js` is in a different directory and was not on the modified-files list during the address-correctness work.

### Bug 3 — The VENUE_SCORER prompt actively discourages event venues

**File:** `tactical-planner.js:210`

```
"Focus on venues with ACTIVE demand RIGHT NOW (not future events)."
```

This line was written to prevent the model from recommending tomorrow's concerts. But the LLM reads `"not future events"` as discouragement from picking **any** event venue — even one whose event starts in 30 minutes and has an active pickup surge window.

Combined with the generic `"PRIORITIZE venues near today's events listed above"` phrasing, the model optimizes on "near" (geographic vicinity) rather than "at" (the event venue itself).

### Bug 4 — `event-matcher.js` has the same city bug + fragile string matching

**File:** `event-matcher.js:30, 111-127`

```javascript
.where(and(
  eq(discovered_events.city, city),        // ← same bug as Bug 2
  eq(discovered_events.state, state),
  ...
))

function addressesMatchStrictly(addr1, addr2) {
  // Requires exact street number + street name equality
  // across two independently-sourced Google address strings
}
```

Even when the same event venue appears on both sides, the matcher compares a `venue_catalog.formatted_address` (from our Places API pipeline) against an `enrichVenues` address (from a separate Places API call). Both are Google-sourced, but formatting drift causes false negatives.

Meanwhile, **strong identity keys exist that aren't being used**:
- `discovered_events.venue_id` (FK to `venue_catalog.venue_id`)
- `discovered_events.place_id` (optional, Google Places ID)
- Enriched venue has `.placeId` (from `enrichVenues` → Google Places API)
- Enriched venue *will* have `venue_id` after catalog promotion

### Bug 5 — Pipeline ordering prevents using the strong key

**File:** `enhanced-smart-blocks.js:218 vs. :268`

```
Step 2.3 (line 218): matchVenuesToEvents(enrichedVenues, ...)   ← no venue_id yet
Step 3.5 (line 268): promoteToVenueCatalog(enrichedVenues, ...)  ← venue_id assigned HERE
```

Event matching runs **before** catalog promotion, so when it runs, neither side has a shared `venue_id`. Only string addresses are available — forcing the fragile matcher.

However, **`place_id` IS available at matching time**: `enrichVenues` populates `v.placeId` by hitting Google Places API. So even before catalog promotion, we can match by `place_id`, which is a strong identity key set by the same Google API on both sides.

---

## 3. Objectives

1. **Event venues become first-class Smart Blocks recommendations.** When discovered events exist for today in the driver's metro, the event's actual venue should appear as a Smart Block candidate — not a generic venue in the vicinity.
2. **Event metadata attaches to matching candidates.** When a Smart Block corresponds to an event venue, the candidate carries the event's title, time window, and staging advice, ready for the frontend to render as a badge/protip.
3. **Preserve generic venue quality.** Some Smart Blocks should still be non-event venues so the driver has options. Target split: **3–4 event venues + 1–2 high-quality general venues** when events exist. When no events exist, revert to current behavior (4–6 general venues).
4. **Metro-wide, not city-wide.** Event venues in Arlington/Frisco/Fort Worth should surface for a Dallas driver (state-scoped, consistent with the 2026-04-11 address correctness work).
5. **No regressions for the event-less case.** A driver in a metro with no events today should see the same quality of general-venue recommendations they do today.

---

## 4. Approach (Design)

Chosen: **Option C — Fix all 5 bugs with explicit event-venue scaffolding**.

Two rejected alternatives, for the record:

- **Option A:** Bypass VENUE_SCORER for event venues. Rejected — loses VENUE_SCORER's tactical reasoning (staging coords, pro tips, strategic timing) for the exact venues where that reasoning matters most.
- **Option B:** Just enrich the prompt and rewrite the prompt language. Rejected — leaves Bugs 2, 4, 5 in place; symptom improves but does not disappear.

**Design principles for Option C:**
- Preserve VENUE_SCORER's authority over staging coords and pro tips
- Strong identity keys (`place_id`, `venue_id`) beat string matching
- State-scope every event query consistent with the 2026-04-11 work
- Event-venue target is a soft hint, not a hard quota — LLM can return fewer if events are too far
- All changes additive; rollback is one-commit-revert per step

### The chosen flow (post-fix)

```
immediateStrategy
    │
    ▼
fetchTodayDiscoveredEventsWithVenue(snapshot.state, today)   ← NEW: state-scoped, with venue_catalog join
    │   returns events with venue_id, coords, formatted_address
    ▼
filterBriefingForPlanner(briefing, snapshot, todayEvents)    ← FIXED: state-scoped, rich event data
    │
    ▼
generateTacticalPlan({ strategy, snapshot, briefingContext }) ← VENUE_SCORER with rewritten prompt
    │   prompt now includes: event venue name + coords + address + time window + category
    │   prompt now says: "Include 3-4 event venues from the list above as first-class recommendations"
    ▼
enrichVenues(picked, driver, snapshot)                        ← unchanged
    │
    ▼
matchVenuesToEvents(enriched, todayEvents)                    ← REWRITTEN: match on place_id (not city/address strings)
    │   todayEvents passed in — no DB re-query
    ▼
verifyVenueEventsBatch + catalog promotion + candidate insert ← unchanged structure, venue_id attached
    │
    ▼
ranking_candidates rows now have venue_events[] populated when candidate is an event venue
```

---

## 5. Files Affected

### Code files

| File | Type of change | Summary |
|------|----------------|---------|
| `server/lib/venue/enhanced-smart-blocks.js` | Modify | Fetch `discovered_events` once at the top of the pipeline (state-scoped, with venue_catalog join). Pass the same list to both `filterBriefingForPlanner` and `matchVenuesToEvents`. Remove the separate DB query inside `matchVenuesToEvents`. |
| `server/lib/briefing/filter-for-planner.js` | Modify | **(Bug 2 fix)** Replace city/state branching with state-only filter. **(Bug 1 fix)** Change `formatBriefingForPrompt` output to include `address`, `lat`, `lng`, `event_end_time`, `category`, `expected_attendance` for each event. |
| `server/lib/strategy/tactical-planner.js` | Modify | **(Bug 3 fix)** Rewrite the "focus on active demand" line to allow event venues. Add explicit event-venue-priority instructions. Add target-split hint. |
| `server/lib/venue/event-matcher.js` | Rewrite | **(Bug 4 fix)** Remove internal DB query — accept events as parameter. Replace fragile string matching with `place_id` primary + `venue_id` fallback + name-match tertiary. |
| `server/lib/venue/README.md` | Update | Document the new flow (Rule 2 compliance). |

### Documentation files

| File | Type of change | Summary |
|------|----------------|---------|
| `docs/EVENTS.md` | Append | Add section "10. Smart Blocks ↔ Event Venue Coordination" documenting how Smart Blocks uses `discovered_events`. |
| `CHANGELOG.md` | Append | Add entry under `[Unreleased]` for this alignment work. |
| `server/lib/venue/SMART_BLOCKS_EVENT_ALIGNMENT_PLAN.md` | This file | Status updates as each step completes. |

### Files **not** affected

| File | Why |
|------|-----|
| `server/lib/briefing/briefing-service.js` | Already state-scoped. |
| `server/api/briefing/briefing.js` | Already state-scoped. |
| `server/lib/venue/venue-cache.js` | `findOrCreateVenue` works correctly. |
| `server/lib/venue/venue-address-validator.js` | Independent of this work. |
| `server/lib/events/pipeline/*.js` | Upstream of enhanced-smart-blocks.js. |
| Database schema | No schema changes. Strong keys (`venue_id`, `place_id`) already exist. |

---

## 6. Decisions Made Without Explicit Approval

Melody approved the plan + implementation in a single session without answering the Open Questions section. Decisions I made and why:

1. **Target split: 3-4 event venues + 1-2 general.** The plan proposed this and no pushback from Melody. Keeping it.
2. **No env flag (`BLOCKS_EVENT_ALIGNMENT_ENABLED`).** CLAUDE.md says "Don't use feature flags or backwards-compatibility shims when you can just change the code." Following the rule.
3. **No synthetic event injection fallback.** Ship without it; trust the rewritten prompt. If telemetry shows LLM refuses to pick event venues despite the prompt, add the fallback in a follow-up.
4. **`fetchTodayDiscoveredEventsWithVenue` lives in `enhanced-smart-blocks.js`.** It's only used there. Can be extracted later if another caller appears.
5. **No feature-flag gated `event-matcher` signature change.** Grep first to confirm it's only imported by `enhanced-smart-blocks.js`. If other callers exist, add a second export.
6. **Integration/E2E tests require DB + LLM.** I cannot run these in this session. I'll verify what I can statically (syntax, imports, type shapes) and flag the untested paths explicitly. Melody runs the real tests.
7. **Do not commit or push.** All changes stay in the working tree. Melody reviews, then commits.

---

## 7. Implementation Steps

### Step 1: New DB query helper `fetchTodayDiscoveredEventsWithVenue`

**Location:** `server/lib/venue/enhanced-smart-blocks.js` lines 97–145 (new function, exported for testability)

**Signature:** `async function fetchTodayDiscoveredEventsWithVenue(state, eventDate) → Promise<Array<EnrichedEvent>>`

Uses Drizzle `leftJoin` `discovered_events` ⋈ `venue_catalog` on `venue_id`, filters by state/date/`is_active`. Non-throwing — returns `[]` on error so the pipeline degrades gracefully to the event-less path. Selected 21 fields: 13 from `discovered_events` + 8 `vc_*` prefixed from `venue_catalog`.

**Status:** ✅ complete

### Step 2: Fix `filter-for-planner.js`

- `filterBriefingForPlanner(briefing, snapshot)` → `filterBriefingForPlanner(briefing, snapshot, todayEvents = null)`. When `todayEvents` is provided (the preferred path), bypasses the deprecated city/state filter branching entirely.
- `formatBriefingForPrompt` rewritten to emit multi-line event blocks with venue name, coords, address, start/end time, category, and expected attendance. Header changed from `"prioritize venues near these"` to `"INCLUDE THESE VENUES AS PRIMARY RECOMMENDATIONS — use the exact coords provided"`.
- Legacy helpers (`isLargeEvent`, `filterEventsForPlanner`, `LARGE_EVENT_INDICATORS`, `LARGE_EVENT_CATEGORIES`) kept in the file for any unmigrated consumer but no longer used by the primary path.

**Status:** ✅ complete

### Step 3: Rewrite VENUE_SCORER prompt in `tactical-planner.js`

- System prompt rule #4 expanded to explicitly say event venues with shows starting in the next 2 hours (or ending in the next hour — pickup surge window) count as ACTIVE demand.
- New **"EVENT VENUE PRIORITY (2026-04-11)"** block added to the VENUE SELECTION section of the system prompt with explicit "include 3–4 event venues as PRIMARY recommendations" instructions.
- User prompt: `"Focus on venues with ACTIVE demand RIGHT NOW (not future events)"` → `"Focus on venues with ACTIVE demand RIGHT NOW — venues that are open, or have events starting/ending in the next 2 hours"` (the `(not future events)` self-sabotaging language removed).
- User prompt: `"PRIORITIZE venues near today's events listed above"` → multi-line `CRITICAL:` block telling the model to `"INCLUDE the event venues themselves as your PRIMARY recommendations"` with exact coords + event-specific pro_tips + remaining 1–2 slots for general venues.
- Regression-safe: when `briefingContext.events.length === 0`, falls back to the previous all-general 4–6 venue pattern with no change.

**Status:** ✅ complete

### Step 4: Rewrite `event-matcher.js`

- Full rewrite. `146 lines → 177 lines` (more documentation than new logic).
- Signature changed: `async matchVenuesToEvents(venues, city, state, eventDate)` → `matchVenuesToEvents(venues, todayEvents)` (sync, no DB).
- Match priority: `place_id` → `venue_id` → substantial name match (≥50% containment threshold).
- Return shape preserved: `Map<venueName, EventMatch[]>` where `EventMatch = { title, venue_name, event_start_time, event_end_time, category, expected_attendance }`.
- Callers don't need to update the candidate-assembly code in `enhanced-smart-blocks.js` (the shape of the matches array is the same).
- Log line format changed: `[event-matcher] ✅ MATCH (place_id): ...` instead of old `(address)` / `(name)` labels.

**Status:** ✅ complete

### Step 5: Wire `enhanced-smart-blocks.js` to the new flow

- Imports expanded: added `discovered_events, venue_catalog` to schema import and `and` to drizzle-orm import.
- `fetchTodayDiscoveredEventsWithVenue` helper added (see Step 1).
- Main function body: fetches `todayEvents` once after `updatePhase('venues')`, passes as 3rd arg to `filterBriefingForPlanner` and as 2nd arg to `matchVenuesToEvents`.
- Removed: old `const eventDate = snapshot.date || new Date().toISOString().slice(0, 10);` line and the 4-arg async `await matchVenuesToEvents(...)` call.
- Date computation uses `snapshot.timezone` via `toLocaleDateString('en-CA', { timeZone })` so the pipeline and the filter agree on "today" in timezone-aware terms.
- Catalog promotion at step 3.5 NOT reordered — kept as-is to minimize blast radius (see Notes section of CHANGELOG.md for rationale).

**Status:** ✅ complete

### Step 6: Update documentation

- ✅ `server/lib/venue/README.md`: new "Smart Blocks ↔ Event Venue Alignment (2026-04-11)" subsection added between the Address Quality Validation section and Venue Enrichment on Discovery section. Last Verified header updated.
- ✅ `docs/EVENTS.md`: new "Section 10: Smart Blocks ↔ Event Venue Coordination (2026-04-11)" added between section 9 (Global App Considerations) and the Canonical Field Names reference.
- ✅ `CHANGELOG.md`: new `[Unreleased] — 2026-04-11 (Smart Blocks ↔ Event Venue Alignment)` block added after the existing address correctness entry. Separate block (not merged into the existing entry) because the two waves are logically distinct units of work even though they share the same date.
- ✅ `docs/architecture/VENUES.md`: updated Step 3 pipeline comment and the section 7 `matchVenuesToEvents` signature reference.
- ✅ `server/lib/briefing/README.md`: fixed a pre-existing doc bug (wrong function name + reversed args in the event-matcher row) and updated the `filterBriefingForPlanner` signature + usage example + Filtering Rules to reflect the new `todayEvents` path.
- ✅ This plan file: status log updated step-by-step.

**Status:** ✅ complete

---

## 8. Test Strategy

### What I can verify statically (this session)

- Imports resolve
- Function signatures match callers
- Schema column names match `shared/schema.js`
- No new calls to removed functions
- Grep confirms no orphan callers

### What Melody needs to verify (next session)

- **E2E-1:** Dallas driver with events at Majestic Theatre, Dallas Comedy Club, Billy Bob's → at least 2/3 appear in Smart Blocks with event badges
- **E2E-2:** Dallas driver with events at Arlington (Globe Life) + Frisco (The Star) → metro-wide events appear
- **E2E-3:** Metro with zero events today → 4-6 generic venues, no errors
- **E2E-4:** Same snapshot run twice → event venues appear deterministically
- **Regression:** `GET /events/:snapshotId` still returns correctly

### Manual checklist Melody will run

- [ ] Strategy tab venues and Smart Blocks venues match for same session
- [ ] Each event-venue Smart Block shows event badge with title and time window
- [ ] At least 1 non-event general venue in Smart Blocks (quality preserved)
- [ ] Server logs show `[event-matcher]` matching via `place_id`, not address strings
- [ ] No errors in server logs during full `blocks-fast` pipeline run

---

## 9. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| VENUE_SCORER ignores the prompt and still picks generic venues | **This risk MATERIALIZED on the first run** — fixed in the followup (see section 12). The soft "aim for 3-4" aspiration lost the conflict with the 15-mile hard rule. Now says "MUST include AT LEAST 2" and events are pre-filtered to reachable. |
| ~~Event venues all >15mi from driver — existing "within 15 miles" prompt constraint handles this. LLM degrades gracefully to generic venues.~~ | **This mitigation was WRONG.** The 15-mile rule *was* the problem, not the mitigation. "Graceful degradation" turned into "total failure to pick any event venue" because every DFW event venue is >15mi from a Plano snapshot. Fixed in followup by splitting the rule: general ≤15mi, event venues ≤40mi, and pre-filtering events at the fetch layer so every event shown in the prompt is already in range. |
| `place_id` mismatch between `venue_catalog` and `enrichVenues` | Both call same Google Places API. Tertiary name-match fallback handles edge cases. Log mismatches. |
| Prompt becomes too long | `formatBriefingForPrompt` already caps at 10 events via `.slice(0, 10)`. After the followup fix, events are sorted closest-first so the 10 shown are the most driver-relevant. Monitor token usage. |
| `event-matcher.js` has external callers I don't know about | **Grep before rewrite.** Done as step 0 of implementation. |
| Events unsorted in the prompt + unreachable events pollute the candidate pool | **Discovered on first run** — fixed in followup by distance-filtering at the fetch layer and sorting closest-first. See section 12 Bug C. |

---

## 10. Rollback Plan

If any test fails and can't be diagnosed quickly:
1. `git revert` each step in reverse order. Each step is a logically separable change.
2. The plan file itself can stay — it's documentation, not code.
3. Docs (`README.md`, `EVENTS.md`, `CHANGELOG.md`) changes are cosmetic and can be reverted independently.

---

## 11. Status Log

| Timestamp | Event |
|-----------|-------|
| 2026-04-11 | Plan drafted |
| 2026-04-11 | Melody approved plan + implementation in single session |
| 2026-04-11 | Implementation started |
| 2026-04-11 | ✅ Step 2: filter-for-planner.js — `todayEvents` param + rich event format |
| 2026-04-11 | ✅ Step 3: tactical-planner.js — prompt rewritten with event venue priority |
| 2026-04-11 | ✅ Step 4: event-matcher.js — synchronous, strong identity keys |
| 2026-04-11 | ✅ Step 1+5: enhanced-smart-blocks.js — helper added + main function wired |
| 2026-04-11 | ✅ Step 6: Documentation — README (venue, briefing), EVENTS.md section 10, VENUES.md, CHANGELOG.md |
| 2026-04-11 | ✅ Implementation complete — static verification passed (grep + syntax) |
| 2026-04-11 | ❌ **First test run FAILED**: VENUE_SCORER picked 5 generic restaurants (Legacy Hall, North Italia, Haywire, Marriott, Renaissance Dallas) instead of the 22 event venues. Logs: `"[event-matcher] No matches for 5 venues against 22 events"`. |
| 2026-04-11 | ✅ Root cause diagnosed (3 prompt bugs, plumbing was correct) — see Section 12 below |
| 2026-04-11 | ✅ Followup fix implemented — see Section 12 |
| — | Second test (Melody confirmation — **pending**) |
| — | Plan converted to post-mortem |

---

## 12. Section 12 — Followup Fix (2026-04-11, same day, same session)

### What the first attempt got wrong

The first implementation wired the data path correctly (22 events reached the prompt via the verified chain `fetchTodayDiscoveredEventsWithVenue` → `filterBriefingForPlanner` → `formatBriefingForPrompt` → `briefingSection` → `user` prompt → `callModel`), but it failed at the **prompt engineering layer**. VENUE_SCORER saw the events and chose to ignore them because three instructions in the prompt were actively working against the event-venue priority:

**Bug A (primary killer): The 15-mile hard rule was left in place.**
`tactical-planner.js:242` still contained `"All venues must be within 15 miles of driver's current GPS coordinates."` — placed *after* the CRITICAL event-priority block in the user prompt, so it functioned as an overriding constraint. Every DFW event venue (AAC ~25mi, Fair Park ~28mi, Dickies ~42mi, Billy Bob's ~45mi from Legacy West) was outside that radius. The LLM obeyed the absolute constraint and fell back to the nearest generic venues.

**Bug B (framing contradiction): Section header still said "near events".**
`tactical-planner.js:204` had `"=== TODAY'S CONTEXT (prioritize venues near events, avoid traffic issues) ==="` from the 2026-01-31 addition. The inner `formatBriefingForPrompt` header said "INCLUDE THESE VENUES AS PRIMARY RECOMMENDATIONS" but the outer header said "prioritize venues near events" — mixed signal. Combined with Bug A, it pushed the LLM toward the geographic-vicinity interpretation.

**Bug C (unreachable pollution): State-wide events, unsorted, sliced to 10.**
`fetchTodayDiscoveredEventsWithVenue` returned all 22 state-wide Texas events unsorted, and `formatBriefingForPrompt` took `.slice(0, 10)` of them in arbitrary DB order. The first 10 could include Austin or Houston events that a Plano driver could never reach, with no distance information for the LLM to self-filter.

**Bug D (soft language): "Aim for" instead of "MUST".**
The CRITICAL block at `tactical-planner.js:227-237` said `"aim for 3-4 of your 4-6 total slots"` — soft aspiration. When faced with the conflicting 15-mile rule, the soft aspiration lost.

### What the followup fix changes

**Five changes across three code files:**

1. **`server/lib/venue/enhanced-smart-blocks.js`** — Added `haversineMiles(lat1, lon1, lat2, lon2)` helper (inline, ~15 lines). Extended `fetchTodayDiscoveredEventsWithVenue` signature from `(state, eventDate)` to `(state, eventDate, driverLat, driverLng, maxDistanceMiles = 40)`. When driver coords are provided, the function:
   - Computes haversine distance per row using `vc_lat`/`vc_lng`
   - Filters to rows within `maxDistanceMiles` (default 40mi — drivers will travel farther for confirmed event surges than for generic venues)
   - Sorts ascending by distance so the closest events appear first
   - Attaches `_distanceMiles` to each row for downstream display
   - Logs `N state-wide → M within 40mi (dropped K far/orphan)` for observability
   - Orphan events (null `venue_id` → null `vc_*` fields) get `Infinity` distance and fall out naturally — we can't include an event we can't locate

2. **`server/lib/venue/enhanced-smart-blocks.js` call site** — Passes `snapshot.lat`/`snapshot.lng` to the fetch helper so distance filtering is active on every Smart Blocks run.

3. **`server/lib/briefing/filter-for-planner.js :: formatBriefingForPrompt`** — Shows `— X.X mi from driver` on each event line when `_distanceMiles` is attached. Event block header rewritten to explicitly state events are "sorted closest-first, all within reachable range" so the LLM knows the list is curated, not raw.

4. **`server/lib/strategy/tactical-planner.js` user prompt (multiple edits)**:
   - **Outer section header** (was "prioritize venues near events, avoid traffic issues") → "event venues ARE the primary recommendations; avoid traffic issues". Eliminates the framing contradiction.
   - **CRITICAL block** — strengthened from "aim for 3-4" to "You MUST include AT LEAST 2 of those event venues in your 4-6 recommendations. Target: 3-4 event venues + 1-2 general venues." Hard floor of 2, soft ceiling of 4.
   - **Distance rule** — replaced the single `"All venues must be within 15 miles"` hard rule with a two-line split: general venues keep 15mi, event venues get 40mi. Explicitly notes that the event list is already pre-filtered to the 40-mile reachable radius so "any event listed is in range."

5. **`server/lib/strategy/tactical-planner.js` debug log** — Added right before `callModel('VENUE_SCORER', ...)`: dumps `briefingContext.events.length` and a 3-sample preview showing `title @ venue (distance, state, coords)`. This is instrumentation, not behavior. Lets Melody verify in the next log output that events are reaching VENUE_SCORER with the expected shape without needing a separate diagnostic run.

### Why these five changes solve all three bugs

| Bug | Change that addresses it |
|-----|-------------------------|
| **A** (15-mile rule overrides event priority) | Change #4: split into general ≤15mi + event ≤40mi. Change #1: pre-filter at fetch layer so every event in the prompt is guaranteed reachable. Change #3: display distance so LLM has explicit data. |
| **B** (framing contradiction) | Change #4: outer section header rewritten from "near events" to "ARE the primary recommendations". |
| **C** (unsorted state-wide events) | Change #1: distance filter + closest-first sort. Change #2: call site passes driver coords. Change #3: prompt shows `X mi from driver` per event. |
| **D** (soft "aim for" language) | Change #4: CRITICAL block uses "MUST include AT LEAST 2" with explicit target. |

### Why not just remove the 15-mile rule entirely

Removing it would be simpler but wrong. General venues (hotels, dining, airport) legitimately benefit from the 15-mile constraint — a driver does NOT want to drive 40 minutes to a hotel when there are closer options. The 15-mile rule is correct *for general venues*; it was just wrong to apply it uniformly. The split preserves the benefit for generals while unblocking events.

### Why 40 miles specifically

40 miles ≈ 50 min of drive time in a typical DFW traffic state, which is the usual breakeven for a single event pickup. Close enough that the drive is justified by an expected surge, far enough to cover the entire metro from any reasonable snapshot location (Plano to Fort Worth is ~35mi, well within range). Configurable via the `maxDistanceMiles` parameter so different markets (Austin, NYC) can tune it later without a code change.

### What I didn't change (and why)

- **`event-matcher.js`** — Matching logic is correct. Once VENUE_SCORER starts picking event venues, the place_id-based matcher will find them. No changes needed here.
- **`briefing.events` legacy code path in `filter-for-planner.js`** — Unused by any live caller but kept for back-compat. No changes.
- **Catalog promotion ordering in `enhanced-smart-blocks.js`** — Still runs AFTER event matching. `place_id` is already the strong identity key for matching, so no reorder needed.
- **`venue-cache.js` / `venue-address-validator.js`** — Unrelated to this issue.
- **Prompt token budget** — Unchanged. The events are now fewer (distance-filtered to ≤40mi) so token count likely *decreased* compared to the first attempt.

### Expected behavior after the followup fix

For Melody's test snapshot in Plano/north-DFW:

1. `[enhanced-smart-blocks] fetchTodayDiscoveredEventsWithVenue: 22 state-wide → ~10-15 within 40mi (dropped ~7-12 far/orphan)` — Austin and Houston events dropped, most of DFW kept
2. `[Filter] Events: N (state-scoped, pre-fetched)` where N is the distance-filtered count
3. `[VENUE_SCORER DEBUG] briefingContext has N events in prompt`
4. `[VENUE_SCORER DEBUG] First 3 events in prompt:` showing the 3 closest events with distance + coords
5. `VENUE_SCORER returned 4-6 venues` including at least 2 event venues from the list
6. `[event-matcher] ✅ MATCH (place_id): "..." ↔ "..."` for the matched ones
7. `[event-matcher] Matched 2/5 venues to events` (or 3/5, or 4/5 — anything ≥2 is success)

If VENUE_SCORER *still* returns zero event venues after this fix, the next diagnostic step is to look at the debug log output to see whether the event venues are actually reaching the prompt with non-null coords. At that point the issue would be data (orphan events, missing venue_catalog rows) rather than prompt engineering.

---

## 13. Section 13 — Second Revert (2026-04-11, same day, owner direction)

### What the Section 12 followup got wrong

Section 12 documents a followup fix that, among other things, split the distance rule into *"general venues ≤ 15 mi, event venues ≤ 40 mi"* so that distant event venues would become eligible as direct Smart Blocks recommendations. Owner feedback after the next test run was unambiguous:

> "STOP. The owner says the 40-mile expansion was WRONG. The 15-mile rule exists for a reason — drivers need closest high-impact venues first. [A nearby, high-quality venue] is right there and the strategy mentions it but the VENUE_SCORER didn't pick it."

The split distance rule inverted the **core invariant** of Smart Blocks: closest-first. By allowing event venues up to 40 miles, we made it possible (and in practice, common) for VENUE_SCORER to reach for a distant event arena instead of a closer high-impact venue that would benefit from the same event's surge flow. The **"not without losing the best of all"** design constraint from section 1 was violated — we lost the closest high-impact venues.

Section 12 identified four bugs and fixed them, but the fix for Bug A (the 15-mile rule) was wrong: we should have *kept* the 15-mile rule and changed the *framing* of events, not relaxed the rule to accommodate events. Bug A was a symptom of a deeper issue — the prompt was trying to turn events into candidate venues when it should have been using them as reasoning context.

### What the owner wants — unambiguous four-point correction

1. **15-mile radius for ALL venue recommendations. No expansion, no split.**
2. **Events within 15 miles enrich nearby venues** — if an event venue happens to be within 15 miles, flag it with event-specific pro_tips and give it priority as a candidate venue.
3. **Events outside 15 miles tell the AI about surge patterns** — attendees traveling TO those far events create demand NEAR the driver (at hotels, dining, residential/entertainment hubs where attendees depart from), NOT AT the far event.
4. **VENUE_SCORER picks the closest high-impact venues.** Events at distant arenas are intel about surge flow, NOT destinations. The right mental model for a driver with a distant event in range is not "drive 40 miles to the arena"; it's "position at the nearest venue where attendees will request rides on their way there."

### The corrected model — NEAR / FAR buckets

```
Driver location
    │
    ├──── 15 mi radius (candidate zone) ────┐
    │                                        │
    │   NEAR EVENTS                          │      FAR EVENTS (15–60 mi)
    │   (candidate venues — recommend        │      (surge flow intel — NOT
    │    directly with event-specific        │       destinations; used to
    │    pro_tips: pre-show drop-off,        │       reason about where
    │    time window, post-show staging)     │       demand will ORIGINATE)
    │                                        │
    │    ● High-impact event venue           │        ● Attendees depart FROM
    │      → recommend directly              │          hotels, residential,
    │                                        │          dining NEAR driver
    │    ● High-impact non-event venue       │          (which ARE in ≤15 mi
    │      → recommend (benefits from        │          radius)
    │        any nearby or far surge flow)   │
    │                                        │        ● Venue at far arena
    │                                        │          → NOT a destination
    │                                        │          → intelligence only
    │                                        │
    └────────────────────────────────────────┘
```

**Key insight:** far events are not "reachable" destinations. Drivers earn at the **departure end** of the surge flow, not at the event itself. A driver picks up an attendee at a hotel near a freeway on-ramp 5 miles away, not at an arena 40 miles away. So the right recommendation for a driver with a distant event in range is not the event venue — it's the venues near the driver from which the event's attendees will depart.

This reframes event data as a **signal about which close-in venues will see demand** rather than a **list of distant venues to drive to**. The signal is valuable; the distant venue as a destination is not.

### The five code changes in this revert

1. **`server/lib/venue/enhanced-smart-blocks.js :: fetchTodayDiscoveredEventsWithVenue`** — `maxDistanceMiles` default raised from 40 → 60. The parameter is relabeled from a VENUE_SCORER constraint to a "metro context radius" — it only controls what events reach the prompt as surge-flow intel. 60 miles covers a typical large metro with headroom while excluding events from unrelated metros. The haversine distance annotation, closest-first sort, and `_distanceMiles` attachment are preserved — they power the NEAR/FAR bucketing downstream. Log line rewritten to report `X near ≤15mi candidates, Y far >15mi surge intel, dropped K out-of-metro/orphan` so telemetry directly reflects the new mental model.

2. **`server/lib/briefing/filter-for-planner.js :: formatBriefingForPrompt`** — Event section rewritten to emit TWO bucketed blocks based on a new constant `NEAR_EVENT_RADIUS_MILES = 15`. The NEAR block header identifies events as candidate venues and instructs the model to recommend them directly with event-specific pro_tips. The FAR block header explicitly says "do NOT recommend these venues" and explains the surge-flow-origination reasoning. Slice caps: 6 NEAR events, 8 FAR events (bounded prompt size). Unbucketed fallback kept for callers that don't provide driver coords.

3. **`server/lib/strategy/tactical-planner.js` system prompt** — "EVENT VENUE PRIORITY" block replaced with "EVENT INTELLIGENCE" block. The old "Include 3–4 event venues as PRIMARY recommendations" language is gone. New language: "The 15-mile rule OVERRIDES everything. NEVER recommend a venue more than 15 miles from the driver, even for events. Two buckets will appear in the user message: NEAR EVENTS (≤15 mi) are candidate venues; FAR EVENTS (>15 mi) are SURGE FLOW INTELLIGENCE. Do NOT recommend far events as destinations — instead reason about where their demand originates." Rule #4 also qualified with an explicit "WITHIN 15 MILES" clause.

4. **`server/lib/strategy/tactical-planner.js` user prompt** — The "CRITICAL — EVENT VENUES ARE YOUR PRIMARY RECOMMENDATIONS ... You MUST include AT LEAST 2" block replaced with a conceptual briefing: "Events are intelligence, NOT a venue list. HARD RULE: 15 miles. If an event is in the NEAR bucket, prioritize it. If events are in the FAR bucket, reason about where their demand ORIGINATES — recommend the closest high-impact venues within 15 mi that attendees would depart from." The "DISTANCE RULES" split section (general ≤15, event ≤40) replaced with a single "HARD DISTANCE RULE: ALL venue recommendations MUST be within 15 miles of the driver's GPS coordinates. This applies to event venues too. If an event is >15 mi away, it is NOT a valid recommendation — it is intelligence about surge flow, not a destination." The outer section header also changed from "event venues ARE the primary recommendations" to "event intelligence for surge-flow reasoning".

5. **`server/lib/strategy/tactical-planner.js` debug log** — Enhanced to report near/far split counts on every VENUE_SCORER call and tag sampled events with `[NEAR]` or `[FAR]`: `[VENUE_SCORER DEBUG] 22 events in prompt (4 near ≤15mi candidates, 18 far >15mi surge intel)`. The subsequent sample shows up to 3 closest events each tagged `[NEAR]` or `[FAR]`. Pure instrumentation; makes the NEAR/FAR split visible in server logs for every run.

### Why the data pipeline stays but the VENUE_SCORER rule reverts

The Section 12 followup fix built two pieces of infrastructure on top of the initial alignment work:

- **Data pipeline enhancements** — `fetchTodayDiscoveredEventsWithVenue` with driver-coord parameters, `haversineMiles` helper, distance annotation, closest-first sort, and an explicit radius cap.
- **VENUE_SCORER rule change** — split 15/40 distance rule in the tactical-planner prompt.

The data pipeline is **good**. It's what powers the NEAR/FAR bucketing in this revert. Distance annotation is a prerequisite for any kind of bucketing, and closest-first sort improves the LLM's ability to focus on the most relevant items when the slice cap hits.

The mistake was **coupling** the VENUE_SCORER rule to the pipeline's radius. The two concerns are distinct:

- **60-mile metro context radius** is a *data-layer* choice about what's worth reasoning over. Events farther than 60 miles are unlikely to affect demand near any reasonable driver position — they're noise.
- **15-mile VENUE_SCORER rule** is a *tactical-layer* choice about where a driver should drive to. It encodes the operational reality that rideshare earnings degrade rapidly with drive time; the closest high-impact venue nearly always beats a distant one.

These shouldn't have been the same number. Decoupling them — keep the annotation, revert the rule — is the right fix.

### What this does NOT change

- **`event-matcher.js`** — still uses `place_id` / `venue_id` / name matching. It doesn't care about distance. Once VENUE_SCORER picks only ≤15-mile venues, the matcher finds matches only for near-bucket events that were actually selected — a natural consequence, no code change needed.
- **The address correctness / semantic dedup work** from the earlier 2026-04-11 entry — completely independent of this sequence.
- **The plan file's objectives** (section 3) — still valid. The underlying goal "event data should inform Smart Blocks" is preserved; only the *mechanism* is different. Event data informs Smart Blocks via the NEAR/FAR bucket framing instead of via direct venue substitution.
- **Metro-wide visibility (section 3 objective #4)** — still achieved via state-scoped fetching. The NEAR/FAR split happens at the prompt layer, not the fetch layer.

### What the test output should look like after this revert

For a driver snapshot with N events in the state, some within 15 mi and some beyond:

1. `[enhanced-smart-blocks] fetchTodayDiscoveredEventsWithVenue: N state-wide → M within 60mi metro context (X near ≤15mi candidates, Y far >15mi surge intel, dropped K out-of-metro/orphan)` — events grouped visibly in the fetch log.
2. `[VENUE_SCORER DEBUG] M events in prompt (X near ≤15mi candidates, Y far >15mi surge intel)` — same counts from the planner side, confirming the data reached the prompt intact.
3. `[VENUE_SCORER DEBUG] First 3 events (closest-first):` — with each sampled event tagged `[NEAR]` or `[FAR]`.
4. `VENUE_SCORER returned 4-6 venues` — ALL within 15 miles of the driver. A close high-impact venue (whether or not it has an event) wins over any distant event arena.
5. `[event-matcher] ✅ MATCH (place_id): ...` — only for near-bucket events that VENUE_SCORER actually selected; far-bucket events produce no matcher activity (they're not in the venue list).

### Status Log (continued from Section 11)

| Timestamp | Event |
|-----------|-------|
| 2026-04-11 | Section 12 followup fix shipped (split 15/40 rule + distance filter) |
| 2026-04-11 | Owner test: The close high-impact venue was not picked; VENUE_SCORER chose distant arenas |
| 2026-04-11 | Owner direction: revert 40mi expansion, restore 15-mile rule, reframe events as surge-flow intel |
| 2026-04-11 | ✅ Second revert implemented — 3 code files + 5 doc files |
| 2026-04-11 | ✅ Syntax verification (`node --check`) passed on all 3 code files |
| — | Second test (owner confirmation — **pending**) |
| — | Plan converted to post-mortem |

### Lesson for future work on this pipeline

> **The 15-mile rule is not a bug. It encodes the driver's operational reality.**
> Rideshare earnings degrade rapidly with drive time, and the closest high-impact
> venue nearly always beats a distant one, even if the distant one has a confirmed
> event. When event data seems to conflict with the 15-mile rule, the resolution
> is **not** to weaken the rule — it's to find the near-driver venue that benefits
> from the far event's surge flow. Events are a signal about *which close-in venues
> will see demand*, not a *list of distant venues to drive to*.

This is the load-bearing insight for future work on event-aware Smart Blocks. A future session that reads this file and is tempted to expand the 15-mile rule to make event venues "work" should re-read this section before making any changes.
