# Events Pipeline E2E Audit

**File:** `events_e2e_audit.md`  
**Purpose:** Full static audit of the current Events pipeline from LLM discovery through validation, deduplication, venue linkage, storage, freshness, and read surfaces.  
**Audited ref:** `d93633b35e4051fb065a1c199e171d4133143280`  
**Baseline:** `events_current_baseline.md`  
**Scope:** System-discovered driver-relevant events stored in `discovered_events`. This does **not** cover the separate public hosted-event sign-up POC.  
**Audit type:** Static code audit. No direct database query or runtime smoke test was run in this pass.

---

## 0. Executive Verdict

The Events pipeline is much cleaner after Workstream 6: ownership moved from the old `briefing-service.js` god-file into `server/lib/briefing/pipelines/events.js`, read-time dedup was architecturally relocated toward write-time, and the 2-hour post-event lifecycle is now aligned between read filtering and cleanup.

However, I would **not** call the pipeline fully hardened yet.

The two most important correctness issues are:

1. **True multi-day events are not correctly represented.**  
   The discovery prompt says multi-day events active today should be included, but also forces `event_start_date` to today. The validator then rejects events whose real `event_start_date` is older than yesterday. This means the system either corrupts multi-day start dates or rejects true multi-day events.

2. **Overnight events can get the wrong `event_end_date`.**  
   `normalizeEvent()` can produce `event_start_time='20:00'` and `event_end_time='02:00'`, but still default `event_end_date` to the start date. That causes cleanup and freshness logic to treat the event as ending earlier on the same date instead of after midnight.

Those two issues directly affect event lifecycle, dedup, active-today selection, and ride-surge availability.

---

## 1. Current E2E Pipeline Map

```text
briefing-aggregator.js
  -> discoverEvents({ snapshot, snapshotId })
    -> pipelines/events.js::fetchEventsForBriefing({ snapshot })
      -> deactivatePastEvents(timezone)
      -> fetchEventsWithGemini3ProPreview({ snapshot })
        -> fetchEventCategory(...) for high_impact
        -> fetchEventCategory(...) for local_entertainment
        -> exact-title merge
        -> deduplicateEventsSemantic(rawEvents)
      -> normalizeEvent(...)
      -> validateEventsHard(...)
      -> deduplicateEvents(...)
      -> deduplicateEventsSemantic(...)
      -> venue resolution
      -> generateEventHash(...)
      -> INSERT discovered_events ON CONFLICT(event_hash) DO UPDATE
      -> SELECT active/current event working set
      -> filterInvalidEvents(...)
      -> return events payload
```

The current Events module declares that it owns the Events section, the `briefing_events_ready` notification channel, and `discovered_events` writes, and it documents the live path as `fetchEventsForBriefing -> fetchEventsWithGemini3ProPreview -> fetchEventCategory -> validateEventsHard -> deduplicateEvents -> deduplicateEventsSemantic -> venue resolution -> discovered_events INSERT -> DB read -> filterInvalidEvents -> return`. [GitHub: `events.js#L1-L29`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/pipelines/events.js#L1-L29)

---

## 2. Positive Findings

### 2.1 Ownership is now clear

`server/lib/briefing/pipelines/events.js` now owns the Events pipeline and explicitly marks old dead paths as deleted, including the Claude WebSearch fallback, legacy Gemini single-search path, old mapper, and old local Zod schema. [GitHub: `events.js#L1-L29`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/pipelines/events.js#L1-L29)

### 2.2 The dedup doctrine is directionally correct

The 2026-04-30 dedup plan rejected read-time dedup as a stage-placement bug and moved toward write-time dedup. The plan explicitly states that `[BRIEFING] [API] [EVENTS] [DEDUP]` is impossible in a correctly staged system because dedup belongs when events enter `discovered_events`, not when the API serves them. fileciteturn79file1

### 2.3 Hash identity is decoupled from UI presentation

`hashEvent.js` defines `event_hash` as computed identity: normalized title, venue name, extracted street, city, and date. It explicitly keeps the hash separate from stored presentation fields. [GitHub: `hashEvent.js#L1-L43`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/events/pipeline/hashEvent.js#L1-L43)

### 2.4 Time strings are normalized before storage

`normalizeEvent()` normalizes raw event times into 24-hour `HH:MM`, which matches the cleanup query’s sortable-string assumption. [GitHub: `normalizeEvent.js#L78-L113`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/events/pipeline/normalizeEvent.js#L78-L113)

### 2.5 2-hour freshness is implemented in both places

Cleanup uses `now - 2 hours` and compares event end date/time against that cutoff. [GitHub: `cleanup-events.js#L34-L63`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/cleanup-events.js#L34-L63)

Read-time freshness uses a 2-hour post-event surge window and comments that it must match cleanup. [GitHub: `strategy-utils.js#L500-L610`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/strategy/strategy-utils.js#L500-L610)

---

# 3. Findings

## P0-1 — True multi-day events are structurally broken

### Severity

**P0 — correctness / lifecycle / dedup risk**

### Evidence

The prompt tells Gemini:

```text
TODAY ONLY — date must be <today>. Multi-day events active today are included.
```

It also shows `event_start_date` and `event_end_date` as today in the required output shape. [GitHub: `events.js#L310-L390`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/pipelines/events.js#L310-L390)

The validator then enforces:

```text
event_start_date must equal today or yesterday
```

for Rule 13. [GitHub: `validateEvent.js#L169-L196`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/events/pipeline/validateEvent.js#L169-L196)

### Why this is wrong

A true multi-day event active today may have:

```text
event_start_date = 2026-04-20
event_end_date   = 2026-04-27
today            = 2026-04-24
```

That is a valid active-today event, but Rule 13 rejects it because start date is older than yesterday.

The current prompt works around that by pushing Gemini to set `event_start_date` to today. That keeps validation green, but corrupts the event’s actual span and creates dedup problems: the same multi-day event can be rediscovered tomorrow with a different `event_start_date`, producing a different hash because the hash includes date. [GitHub: `hashEvent.js#L150-L162`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/events/pipeline/hashEvent.js#L150-L162)

### Expected contract

For discovery:

```markdown
- Return true event_start_date.
- Return true event_end_date.
- Include event if event_start_date <= today AND event_end_date >= today.
- If true start date is unknown but event is active today, classify start_date_confidence='estimated' rather than forcing today's date as fact.
```

For validation:

```js
const isActiveToday =
  event.event_start_date <= today &&
  event.event_end_date >= today;
```

For hash:

```markdown
For single-day events:
  hash date component = event_start_date

For multi-day events:
  hash date component = event_start_date + event_end_date
  OR a canonical event_span_key
```

### Recommended fix

Change Rule 13 in `validateEvent.js` from “start date must be today/yesterday” to “event span must include today,” while still rejecting future-only and already-ended events.

Add tests:

```markdown
- Multi-day event started 3 days ago and ends tomorrow: VALID.
- Multi-day event ended yesterday before surge window: INVALID or stale, depending on lifecycle stage.
- Multi-day event starts tomorrow: INVALID for today discovery.
- Same multi-day event discovered on consecutive days hashes to same identity.
```

---

## P0-2 — Overnight events can get the wrong `event_end_date`

### Severity

**P0 — stale/deactivation correctness**

### Evidence

`normalizeEvent()` defaults all-day and category-based times and can set nightlife defaults to:

```js
event_start_time = '20:00';
event_end_time = '02:00';
```

[GitHub: `normalizeEvent.js#L204-L238`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/events/pipeline/normalizeEvent.js#L204-L238)

`addDuration()` wraps hours past midnight back to `02:00`, but does not return any date rollover flag. [GitHub: `normalizeEvent.js#L173-L184`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/events/pipeline/normalizeEvent.js#L173-L184)

Then `event_end_date` defaults to the same date as `event_start_date`. [GitHub: `normalizeEvent.js#L270-L281`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/events/pipeline/normalizeEvent.js#L270-L281)

### Why this is wrong

For a nightlife event:

```text
event_start_date = 2026-05-04
event_start_time = 20:00
event_end_time   = 02:00
event_end_date   = 2026-05-04   // wrong
```

The true end date should be:

```text
event_end_date = 2026-05-05
```

This affects both:

- cleanup, which compares `event_end_date` + `event_end_time` against cutoff [GitHub: `cleanup-events.js#L52-L63`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/cleanup-events.js#L52-L63)
- read-time freshness, which parses end date/time for the 2-hour surge window [GitHub: `strategy-utils.js#L500-L610`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/strategy/strategy-utils.js#L500-L610)

### Recommended fix

When normalized `event_end_time <= event_start_time`, increment `event_end_date` by one local day unless the provider explicitly supplied a later `event_end_date`.

Add tests:

```markdown
- Nightlife default 20:00 -> 02:00 should end next day.
- Concert 19:00 -> 22:00 should end same day.
- Explicit provider event_end_date should be preserved.
- Cleanup should not deactivate an overnight event at 23:00 on the start date.
```

---

## P0-3 — True multi-day events can duplicate across days because the hash includes only one date

### Severity

**P0/P1 — dedup correctness**

### Evidence

The hash contract is:

```text
normalize(title) | normalize(venue_name) | extract_street(address) | normalize(city) | date
```

[GitHub: `hashEvent.js#L1-L17`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/events/pipeline/hashEvent.js#L1-L17)

`buildHashInput()` uses only `event_start_date` as the date component. [GitHub: `hashEvent.js#L150-L162`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/events/pipeline/hashEvent.js#L150-L162)

### Why this matters

If the current prompt forces every active multi-day event to have `event_start_date = today`, then this same real event can hash differently every day:

```text
Day 1 hash date = 2026-05-04
Day 2 hash date = 2026-05-05
Day 3 hash date = 2026-05-06
```

That bypasses `event_hash` uniqueness and creates one row per discovery day.

### Recommended fix

Fix P0-1 first. Once true start/end dates are preserved, update the hash contract to use:

```text
single_day_hash_date = event_start_date
multi_day_hash_span  = event_start_date + event_end_date
```

or explicitly add `event_span_key`.

---

## P1-1 — Same-title same-venue same-day multiple performances can collapse into one row

### Severity

**P1 — false merge risk**

### Evidence

The v3 hash intentionally excludes time. [GitHub: `hashEvent.js#L1-L32`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/events/pipeline/hashEvent.js#L1-L32)

The plan even includes the test that different start times produce the same hash. fileciteturn79file11

### Why this matters

This is correct for **time corrections**:

```text
Bruno Mars 7:00 PM
Bruno Mars 7:30 PM
```

But it is wrong for **multiple real performances**:

```text
Comedy Show at Venue — 7:00 PM
Comedy Show at Venue — 9:30 PM
```

or:

```text
Matinee and evening theater performance
```

The later discovery can overwrite the earlier one via `ON CONFLICT(event_hash) DO UPDATE`.

### Recommended fix

Add an explicit performance-instance rule:

```markdown
If same title + venue + date appears with distinct start times in the same provider batch,
treat as separate event instances unless the title or provider metadata indicates it is a correction.
```

Implementation options:

1. Include normalized start time in hash only when the raw batch contains multiple same-title/same-venue/same-date records with distinct times.
2. Add `event_instance_key`.
3. Ask Gemini to include `is_multiple_showing` / `showing_label` for repeated same-day performances.

---

## P1-2 — Coordinate validation is incomplete before `lat.toFixed()`

### Severity

**P1 — discovery failure / silent empty results**

### Evidence

`fetchEventsWithGemini3ProPreview()` requires `city`, `state`, and `timezone`, but it does not validate `lat` and `lng` before passing them into category discovery. [GitHub: `events.js#L395-L430`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/pipelines/events.js#L395-L430)

`fetchEventCategory()` directly uses:

```js
lat.toFixed(6)
lng.toFixed(6)
```

inside the prompt. [GitHub: `events.js#L310-L345`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/pipelines/events.js#L310-L345)

### Why this matters

If an older snapshot, malformed caller, or test object passes `lat`/`lng` as missing or string values, the category fetch throws before model dispatch. The catch returns an empty category result with an error, so the top-level event discovery can degrade to “no events found.”

### Recommended fix

At the start of `fetchEventsWithGemini3ProPreview()`:

```js
const driverLat = Number(snapshot.lat);
const driverLng = Number(snapshot.lng);

if (!Number.isFinite(driverLat) || !Number.isFinite(driverLng)) {
  return { items: [], reason: 'Location coordinates unavailable for event discovery' };
}
```

Then pass `driverLat` and `driverLng` downstream.

---

## P1-3 — Read-time validation still re-runs full hard validation instead of schema-gated legacy validation

### Severity

**P1 — stage purity / possible data loss**

### Evidence

`filterInvalidEvents()` is a compatibility shim, but it still calls `validateEventsHard()` on whatever events are passed into it. [GitHub: `events.js#L282-L306`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/pipelines/events.js#L282-L306)

`validateEvent.js` says read-time validation should be used only for legacy rows with schema versions older than the current one. [GitHub: `validateEvent.js#L1-L14`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/events/pipeline/validateEvent.js#L1-L14)

`needsReadTimeValidation(schemaVersion)` exists for this purpose. [GitHub: `validateEvent.js#L230-L239`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/events/pipeline/validateEvent.js#L230-L239)

### Why this matters

The current read defense is not dedup, so it does not violate Rule 16 in the same way. But it is still over-broad: it re-applies today/yesterday validation at read time instead of only applying legacy cleanup where needed.

This can conflict with proper multi-day support once P0-1 is fixed unless the read filter is also corrected.

### Recommended fix

Either:

```js
if (needsReadTimeValidation(event.validation_schema_version)) {
  validateEvent(event, context)
}
```

or split the read shim into a narrow data-quality filter that only removes TBD/Unknown rows and does not enforce active-today logic.

---

## P1-4 — `withTimeout()` creates an AbortController but never passes the signal

### Severity

**P1/P2 — cost / duplicate in-flight LLM work**

### Evidence

`withTimeout()` creates an `AbortController` and calls `controller.abort()` on timeout. [GitHub: `events.js#L55-L88`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/pipelines/events.js#L55-L88)

But `fetchEventCategory()` does not accept or pass an abort signal to `callModel()`. [GitHub: `events.js#L310-L390`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/pipelines/events.js#L310-L390)

### Why this matters

The caller gets a timeout result, but the underlying model call may continue running. This does not directly corrupt event data, but it can increase cost, contention, and log confusion under slow Gemini calls.

### Recommended fix

Either wire `AbortSignal` through the adapter stack or remove the misleading abort comment and log this as “response timeout only; no provider cancellation.”

---

## P1-5 — Prompt says “today only” but DB read window is broader

### Severity

**P1 — contract drift**

### Evidence

The discovery prompt says “TODAY ONLY” and asks Gemini for today’s events. [GitHub: `events.js#L310-L390`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/pipelines/events.js#L310-L390)

`fetchEventsForBriefing()` calculates both `todayStr` and `endDateStr` for a 7-day window. [GitHub: `events.js#L540-L570`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/pipelines/events.js#L540-L570)

The module comments say the DB read is a state + multi-day window read. [GitHub: `events.js#L520-L540`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/pipelines/events.js#L520-L540)

### Why this matters

There are two possible product contracts:

```markdown
A. The briefing event set is today's active events only.
B. The briefing event set is today + upcoming week.
```

The prompt says A. Some DB-read structure appears to support B. Validation Rule 13 says A. This should be made explicit so future code does not keep oscillating.

### Recommended fix

For driver strategy, I recommend:

```markdown
Briefing/planner input = active today only.
Event catalog storage = can hold future discovered events if a future pipeline is added.
```

Then remove misleading 7-day read-window naming unless future events are intentionally used elsewhere.

---

## P2-1 — `normalizeTimeForHash()` is dead or misleading

### Severity

**P2 — cleanup / developer confusion**

### Evidence

`hashEvent.js` defines `normalizeTimeForHash()`, but `buildHashInput()` does not use time. [GitHub: `hashEvent.js#L118-L140`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/events/pipeline/hashEvent.js#L118-L140) [GitHub: `hashEvent.js#L150-L162`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/events/pipeline/hashEvent.js#L150-L162)

### Recommended fix

Either remove it or add an explicit comment:

```js
// Intentionally unused in v3; retained only for future instance-key work.
```

---

## 4. Read Path Audit

### 4.1 Imports look clean

Current `briefing.js` imports `filterInvalidEvents` from the Events pipeline and `filterFreshEvents`, but does not import `deduplicateEvents` or `deduplicateEventsSemantic`. [GitHub: `briefing.js#L1-L18`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/api/briefing/briefing.js#L1-L18)

That is consistent with the plan to strip read-time dedup. The dedup relocation plan explicitly required no `[DEDUP]` lines under API read paths. fileciteturn80file1

### 4.2 Freshness filters are stage-correct

Freshness is time-dependent, so it belongs at read time. The plan explicitly preserves freshness and active filters because they depend on request time. fileciteturn80file1

### 4.3 Remaining concern

The read path should keep `filterFreshEvents()`, but `filterInvalidEvents()` should become schema-gated or narrower after multi-day validation is fixed.

---

## 5. Dedup Audit

### 5.1 Why dedup is still required

Even if the LLM discovers events on every server run, dedup is still required because:

1. The pipeline runs two category searches that can overlap.
2. Gemini can change event titles between runs.
3. Gemini can provide venue variants or wrong large-venue assignments.
4. Persisted rows must update, not duplicate, across repeated runs.
5. Multiple snapshots/users can discover the same event.
6. Existing historical rows may already be duplicated.

The architectural plan explicitly says the hash is a structural backstop and semantic dedup is the smarter pre-filter, both at write time. fileciteturn80file4

### 5.2 Current dedup layers

| Layer | Location | Status |
|---|---|---|
| Exact title merge | `fetchEventsWithGemini3ProPreview()` | Good cheap first pass |
| Semantic discovery merge | `fetchEventsWithGemini3ProPreview()` | Good |
| Hash dedup | `fetchEventsForBriefing()` | Good |
| Semantic pre-insert dedup | `fetchEventsForBriefing()` | Good |
| DB `event_hash` uniqueness | `discovered_events.event_hash` | Good structural backstop |
| Read-time dedup | should be absent | Appears removed from imports |

---

## 6. Venue Linkage Audit

### Current intended sequence

The current Events module imports venue cache, Places text search, geocoding fallback, and venue address validation:

- `findOrCreateVenue`
- `lookupVenue`
- `geocodeEventAddress`
- `searchPlaceWithTextSearch`
- `validateVenueAddress`

[GitHub: `events.js#L31-L49`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/pipelines/events.js#L31-L49)

### Remaining audit risk

I could not fully verify from the static snippets whether `generateEventHash(event)` happens before or after canonical venue/address fields are attached in the insert loop because the long file output truncates around that section.

This should be verified directly in code before the next change:

```markdown
Required invariant:
- final hash should be based on stable normalized fields after venue/address resolution when available,
  OR the code should explicitly document why raw normalized Gemini address is used for identity.
```

If hash is computed before venue resolution, the same real event with unstable Gemini venue/address text can still bypass the DB unique constraint.

---

## 7. Required Fix List

### P0 fixes

```markdown
1. Fix multi-day event contract.
   Files:
   - server/lib/briefing/pipelines/events.js
   - server/lib/events/pipeline/validateEvent.js
   - server/lib/events/pipeline/hashEvent.js
   Tests:
   - true multi-day active today passes validation
   - multi-day event hashes stable across consecutive discovery days

2. Fix overnight end-date rollover.
   Files:
   - server/lib/events/pipeline/normalizeEvent.js
   Tests:
   - nightlife 20:00 -> 02:00 ends next calendar day
   - cleanup does not deactivate before actual next-day end + 2h
```

### P1 fixes

```markdown
3. Add lat/lng numeric validation before prompt interpolation.
4. Decide and implement same-day multiple-performance handling.
5. Make read-time validation schema-gated or narrow it to TBD/Unknown only.
6. Confirm hash timing relative to venue resolution.
```

### P2 cleanup

```markdown
7. Remove or label unused normalizeTimeForHash().
8. Wire AbortSignal through callModel or relabel timeout as non-cancelling.
9. Reconcile docs that still imply old briefing-service line ownership.
```

---

## 8. Tests Claude Should Add Before Declaring This Pipeline Hardened

```markdown
# Events pipeline required tests

## Multi-day validation
- event_start_date < today and event_end_date > today => valid
- event_start_date > today => invalid for today briefing
- event_end_date < today and outside 2h surge => stale/deactivated

## Multi-day hash
- same title/venue/address/city/start/end span discovered on multiple days => same hash
- same title/venue/address/city but different event_end_date => different hash when span truly differs

## Overnight normalization
- nightlife default start 20:00/end 02:00 => end_date = start_date + 1 day
- explicit provider event_end_date wins over inferred rollover

## Same-day multiple performance
- same title/venue/date with 19:00 and 21:30 should not collapse unless marked correction

## Read path purity
- `/api/briefing/events/:snapshotId` emits no `[DEDUP]` logs
- `/api/briefing/snapshot/:snapshotId` emits no `[DEDUP]` logs
- freshness logs are allowed

## Idempotency
- same Gemini batch twice creates no new duplicate `discovered_events` rows
- conflict update refreshes mutable fields

## Venue identity
- wrong/missing place_id does not silently mark event as planner-grade
- venue_id linkage is preferred over loose text when present
```

---

## 9. Recommended Claude Prompt

```markdown
You are auditing and hardening the Vecto-Pilot Events pipeline at ref d93633b35.

Do not reintroduce read-time dedup. Dedup belongs at write time only.

Fix the following in order:

1. Multi-day events:
   - Prompt must ask for true event_start_date and true event_end_date.
   - Validation must accept events where event_start_date <= localToday AND event_end_date >= localToday.
   - Hash must remain stable for the same multi-day event across consecutive discovery days.

2. Overnight events:
   - normalizeEvent must increment event_end_date when normalized end_time <= start_time unless provider supplied a valid later end date.
   - Add unit tests for nightlife 20:00 -> 02:00.

3. Coordinates:
   - Validate/coerce snapshot.lat and snapshot.lng before lat.toFixed/lng.toFixed.
   - Return explicit no-coordinate reason or fall back to market-only prompt.

4. Same-day multiple performances:
   - Decide whether time remains excluded from event_hash.
   - If time remains excluded, add an event_instance_key or batch-detected exception.

5. Read-time validation:
   - Keep freshness filtering.
   - Make filterInvalidEvents schema-gated or split it into a narrow TBD/Unknown compatibility filter.

After edits, provide:
- file-by-file diff summary
- tests added
- exact line ranges changed
- confirmation that API read paths emit no DEDUP logs
```

---

## 10. Final Audit Verdict

```markdown
The current Events pipeline is structurally close but not fully safe.

The dedup relocation and v3 hash design are directionally correct. The most dangerous remaining defects are not “do we dedup?” but “what identity are we deduping?” True multi-day events and overnight events currently have enough date-contract risk to create wrong rows, stale rows, or duplicate rows.

Fix multi-day span validation and overnight end-date rollover before doing more optimization work.
```
