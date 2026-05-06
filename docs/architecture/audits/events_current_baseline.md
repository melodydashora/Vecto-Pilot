# Events Pipeline Current Baseline

**File:** `events_current_baseline.md`  
**Purpose:** Rebuild a fresh baseline before the complete audit from event discovery through deduplication rationale.  
**Audited indexed ref:** `d93633b35e4051fb065a1c199e171d4133143280`  
**Scope:** system-discovered driver-relevant events in `discovered_events`, not public/hosted event sign-up POC tables.  
**Status:** Baseline only. This does **not** yet perform the full defect audit; it establishes the current known-good map after recent changes.

---

## 0. Why this baseline exists

The Events pipeline changed materially after the earlier audits:

1. Workstream 6 split `briefing-service.js` and moved the live Events pipeline into `server/lib/briefing/pipelines/events.js`.
2. Rule 16 moved dedup doctrine from read-time toward write-time identity.
3. The hash contract was updated to v3.
4. The event lifecycle window changed to 2 hours post-event.
5. `briefing-aggregator.js` now owns orchestration and calls `discoverEvents()` / `fetchEventsForBriefing()`.
6. Older docs still contain stale references to `briefing-service.js` line numbers and older 1-hour freshness language.

This document is the replacement baseline for a new full audit.

---

## 1. Branch / PR lineage that matters for Events

| PR / Branch | Status | Event relevance |
|---|---|---|
| PR #18 `coach-pass2-phase-b` | merged | Included Events hardening: timezone-aware validation, multi-day fixes, planner-grade venue gating. It also introduced logging/control-plane work that changed how pipeline placement is reasoned about. |
| PR #25 `feat/logger-tier3-auth-loc` | merged | Did not directly rewrite the Events pipeline, but surfaced Workstream 6 debt: `briefing-service.js` god-file, `venue_catalog` column pollution, and event/venue ownership concerns. |
| PR #26 `feat/workstream6-briefing-split` | merged | Major Events baseline change. Extracted event logic from `briefing-service.js` into `server/lib/briefing/pipelines/events.js`; `briefing-service.js` became a facade/shim. |
| PR #27 `feat/workstream6-step3-cache-enforcement` | merged | Primarily Strategy/Venue cache enforcement; affects how venue catalog is used downstream but is not the Events discovery pipeline. |
| PR #28-#30 | merged | Governance/case-collision/auth. Relevant only because docs/rules changed and line anchors moved. |
| PR #31 | merged | Coach hands-free work; not an Events pipeline change. |

---

## 2. Canonical current Events flow

```text
generateAndStoreBriefing()
  -> discoverEvents({ snapshot, snapshotId })
      -> fetchEventsForBriefing({ snapshot })
          -> deactivatePastEvents(timezone)
          -> fetchEventsWithGemini3ProPreview({ snapshot })
              -> fetchEventCategory(...) x 2 in parallel
              -> exact title merge
              -> deduplicateEventsSemantic(rawEvents)
          -> normalizeEvent(...)
          -> validateEventsHard(...)
          -> deduplicateEvents(...)
          -> deduplicateEventsSemantic(...)
          -> venue resolution:
              -> lookupVenue(place_id)
              -> searchPlaceWithTextSearch(...)
              -> geocodeEventAddress(...)
              -> findOrCreateVenue(...)
              -> validateVenueAddress(...)
          -> generateEventHash(...)
          -> INSERT discovered_events ON CONFLICT(event_hash) DO UPDATE
          -> SELECT active-today / date-window events from discovered_events + venue_catalog
          -> filterInvalidEvents(..., { timezone })
          -> return { items, reason, provider }
  -> briefing-aggregator final assembly
      -> eventsResult.events.items
      -> briefings.events
      -> pg_notify / SSE section updates
```

The current Events file itself states the live path as `fetchEventsForBriefing -> fetchEventsWithGemini3ProPreview -> fetchEventCategory -> validateEventsHard -> deduplicateEvents -> deduplicateEventsSemantic -> venue resolution -> discovered_events INSERT -> DB read -> filterInvalidEvents -> return`.

---

## 3. Current ownership map

| Area | Current owner | File / line anchors |
|---|---|---|
| Briefing orchestration / fan-out | `briefing-aggregator.js` | [`briefing-aggregator.js#L1-L37`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/briefing-aggregator.js#L1-L37) |
| Events pipeline runtime | `pipelines/events.js` | [`events.js#L1-L29`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/pipelines/events.js#L1-L29) |
| Event discovery categories | `EVENT_CATEGORIES` | [`events.js#L89-L118`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/pipelines/events.js#L89-L118) |
| Category-level LLM prompt | `fetchEventCategory()` | [`events.js#L310-L390`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/pipelines/events.js#L310-L390) |
| Primary Gemini discovery | `fetchEventsWithGemini3ProPreview()` | [`events.js#L395-L505`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/pipelines/events.js#L395-L505) |
| Top-level event fetch | `fetchEventsForBriefing()` | [`events.js#L520-L820`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/pipelines/events.js#L520-L820) |
| Hash-style batch dedup | `deduplicateEvents()` | [`events.js#L123-L280`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/pipelines/events.js#L123-L280) |
| Read compatibility validation shim | `filterInvalidEvents()` | [`events.js#L282-L306`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/pipelines/events.js#L282-L306) |
| Canonical hash identity | `hashEvent.js` | [`hashEvent.js#L1-L43`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/events/pipeline/hashEvent.js#L1-L43) |
| Hash input builder | `buildHashInput()` | [`hashEvent.js#L150-L162`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/events/pipeline/hashEvent.js#L150-L162) |
| Hash generator | `generateEventHash()` | [`hashEvent.js#L171-L174`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/events/pipeline/hashEvent.js#L171-L174) |
| Existing-row hash migration | `migrate-event-hashes.js` | [`migrate-event-hashes.js#L1-L79`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/scripts/migrate-event-hashes.js#L1-L79) |
| Event cleanup / deactivation | `deactivatePastEvents()` | [`cleanup-events.js#L1-L78`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/cleanup-events.js#L1-L78) |
| Read-side freshness | `isEventFresh()` / `filterFreshEvents()` | [`strategy-utils.js#L500-L610`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/strategy/strategy-utils.js#L500-L610) |
| Events section assembly | `discoverEvents()` into aggregator | [`briefing-aggregator.js#L250-L345`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/briefing-aggregator.js#L250-L345) |
| Final briefing write | `briefings.events` | [`briefing-aggregator.js#L430-L520`](https://github.com/melodydashora/Vecto-Pilot/blob/d93633b35e4051fb065a1c199e171d4133143280/server/lib/briefing/briefing-aggregator.js#L430-L520) |

> Note: GitHub line anchors above are tied to indexed ref `d93633b35e4051fb065a1c199e171d4133143280` and should be re-anchored if main moves.

---

## 4. Current event discovery contract

### 4.1 Trigger

Events are discovered per snapshot, not by background sync.

Current governing principle:

```text
snapshot context is authoritative:
city, state, market, lat, lng, timezone, local date
```

The Events pipeline is called from the briefing waterfall, through `discoverEvents()` / `fetchEventsForBriefing()`.

### 4.2 Gemini role

Gemini is used for discovery, not canonical venue truth.

It is asked to find events for:
- `high_impact`
- `local_entertainment`

The current prompt tells the model to:
- search the whole market, not only the city
- prioritize within 15 miles of the driver first
- include high-impact market events beyond the immediate radius
- return TODAY-only events, including multi-day events active today
- return all required date/time fields
- return a venue name and possible Google Places ID

### 4.3 Why two category searches can duplicate events

Gemini runs two category searches in parallel. The same real event can be returned in both:

```text
high_impact search:
  "Jon Wolfe Concert" at Venue A

local_entertainment search:
  "Jon Wolfe Live" at Venue A
```

This is one reason dedup remains required even though discovery is fresh per run.

---

## 5. Current dedup doctrine

### 5.1 Rule

Dedup belongs at write/ingestion time, not API read time.

Current doctrine in `CLAUDE.md` Rule 16:

```text
dedup at write, never at read
identity computed at INSERT via generateEventHash v3
DB UNIQUE(discovered_events.event_hash) enforces it structurally
read paths should be pure SELECT + clock-dependent filters
```

### 5.2 Dedup layers

| Layer | Where | Purpose |
|---|---|---|
| Exact title merge | inside `fetchEventsWithGemini3ProPreview()` | Cheap duplicate suppression across the two category result sets. |
| `deduplicateEvents()` | inside `fetchEventsForBriefing()` | Hash-style application dedup using normalized event name + street-ish address + start time. |
| `deduplicateEventsSemantic()` | inside discovery merge and write path | Handles title variants and wrong-venue/stadium assignment cases. |
| `event_hash` unique constraint | DB storage | Structural backstop across repeated server runs / repeated snapshot discoveries. |
| `migrate-event-hashes.js` | one-off script | Repairs historical rows after the hash contract changes. |

### 5.3 Why dedup is still needed if the LLM fetches events on every run

Fresh discovery does not imply unique discovery.

Dedup is still required because:

1. **The LLM can return the same real event in both category searches.** The pipeline deliberately fans out into `high_impact` and `local_entertainment`; overlap is expected.
2. **The LLM can vary titles run-to-run.** Example forms: `"Live Music: X"`, `"X Live"`, `"X at Venue"`, `"X (Special Edition)"`.
3. **The LLM can vary venue names or assign the wrong large venue.** Semantic dedup exists partly to catch correct small venue vs wrong stadium duplicates.
4. **The app persists events across runs.** `discovered_events` is a working set, not a temp scratchpad. A fresh server run must update existing rows instead of inserting duplicate rows.
5. **Time corrections should update, not duplicate.** Hash v3 intentionally excludes time so `"7:00 PM"` and `"7:30 PM"` at same venue/date become one event row with updated content.
6. **Historical rows exist.** The migration script is needed because older rows were written under weaker hash normalization.
7. **Multiple snapshots can discover the same event.** The same market event can be discovered by different drivers or same user sessions; `event_hash` prevents repeated physical event rows.

---

## 6. Current hash contract

`hashEvent.js` defines v3 identity:

```text
normalize(title)
| normalize(venue_name)
| extract_street(address)
| normalize(city)
| event_start_date
```

Important choices:

| Field | In hash? | Reason |
|---|---:|---|
| normalized title | yes | core event identity |
| venue name | yes | venue-level identity |
| street name | yes | catches address number variations on same venue block |
| city | yes | prevents cross-city collisions |
| date | yes | same event on different dates should be distinct |
| time | no | time corrections should update the row |
| category | no | category is metadata; LLM can classify inconsistently |
| impact | no | impact is metadata; can change |
| attendance | no | metadata; can change |

This is why dedup does not mangle stored `title`/`venue_name`/`address`. The stored fields remain presentation; `event_hash` is identity.

---

## 7. Current freshness / lifecycle contract

### 7.1 Cleanup

`deactivatePastEvents(timezone)` uses a 2-hour buffer:

```text
cutoff = now - 2 hours in the user's timezone
deactivate if event_end_date < cutoffDate
or event_end_date == cutoffDate and event_end_time < cutoffTime
```

### 7.2 Read-side freshness

`isEventFresh()` uses `POST_EVENT_SURGE_MS = 2 * 60 * 60 * 1000`.

That means events remain visible for roughly two hours after end time to capture post-event pickup surge.

### 7.3 Clock-dependent filters are allowed at read time

Freshness is not dedup. It depends on request time, so it is legitimate at read time.

Allowed read-time operations:

```text
filterFreshEvents()
filterInvalidEvents() for compatibility / TBD-Unknown removal
active-today / multi-day window filtering
```

Disallowed read-time operation:

```text
deduplicateEvents()
deduplicateEventsSemantic()
```

Except as explicitly documented migration/backcompat repair, read dedup should not run.

---

## 8. Current event-to-venue relationship

Events are stored in `discovered_events`.

Venues are canonicalized in `venue_catalog`.

Event rows should link to `venue_catalog` by `venue_id` once resolved.

Venue resolution sequence:

```text
place_id cache
  -> Places Text Search
  -> Geocode fallback
  -> findOrCreateVenue()
  -> address quality validation
  -> store resolved venue_id / address / city / state
```

Gemini may provide venue name and possible `place_id`, but Google Places / `venue_catalog` is the canonical source of venue identity.

---

## 9. Current storage contract

`discovered_events` should be upserted by `event_hash`.

Expected behavior:

```text
same event rediscovered
  -> same event_hash
  -> ON CONFLICT(event_hash) DO UPDATE
  -> row content refreshed
  -> no duplicate row
```

The hash is the identity; presentation fields can update.

---

## 10. Current migration / historical repair contract

`migrate-event-hashes.js` exists to repair rows created before v3 hash normalization.

Key rules:

1. Compute new hash with current `generateEventHash()`.
2. Group all rows by new hash.
3. If a group has duplicates, keep the oldest row.
4. Delete duplicate rows before updating survivor hash.
5. Support dry-run mode.

This matters because the DB constraint only prevents future duplicates once hashes are computed correctly; it does not automatically fix historical rows already present.

---

## 11. Things this baseline does not yet prove

The full audit still needs to verify:

1. Whether read-path dedup was fully stripped from `server/api/briefing/briefing.js`.
2. Whether `fetchEventsForBriefing()` truly runs both `deduplicateEvents()` and `deduplicateEventsSemantic()` after validation and before insert.
3. Whether `generateEventHash(event)` is called after venue resolution using canonical address/city/state or before resolution using weaker LLM values.
4. Whether `discovered_events` conflict update always writes resolved venue data, not raw Gemini values.
5. Whether `source_model` / event telemetry belongs only on event rows, not `venue_catalog`.
6. Whether venue-less events are correctly classified and not silently treated as planner-ready.
7. Whether old docs still claim read-time dedup or 1-hour freshness.
8. Whether `briefing.js` still imports `deduplicateEvents` / `deduplicateEventsSemantic`.
9. Whether `EVENTS.md` is stale compared with Rule 16 and the 2-hour lifecycle.

---

## 12. Full audit checklist to run next

```markdown
# Events Full Audit Checklist

## A. Entry / orchestration
- `briefing-aggregator.js`
- `discoverEvents()`
- `fetchEventsForBriefing()`

## B. LLM discovery
- `fetchEventsWithGemini3ProPreview()`
- `fetchEventCategory()`
- prompt requirements
- category overlap

## C. Validation / normalization
- `normalizeEvent.js`
- `validateEvent.js`
- `filterInvalidEvents()` compatibility shim

## D. Dedup
- `deduplicateEvents()`
- `deduplicateEventsSemantic()`
- `generateEventHash()`
- `event_hash` DB uniqueness
- `migrate-event-hashes.js`

## E. Venue resolution
- `lookupVenue()`
- `searchPlaceWithTextSearch()`
- `geocodeEventAddress()`
- `findOrCreateVenue()`
- `validateVenueAddress()`
- `maybeReResolveAddress()`

## F. Storage
- `discovered_events` insert/upsert
- conflict update fields
- `venue_id` linkage
- `source_model` / telemetry placement

## G. Freshness
- `deactivatePastEvents()`
- `filterFreshEvents()`
- active-today / multi-day read predicates
- 2-hour post-event window consistency

## H. Read surfaces
- `server/api/briefing/briefing.js`
- Strategy Venues / Smart Blocks event intake
- Coach event context
- client rendering fallback filters

## I. Docs / doctrine
- `docs/EVENTS.md`
- `docs/EVENT_FRESHNESS_AND_TTL.md`
- `CLAUDE.md` Rule 11 and Rule 16
- `LESSONS_LEARNED.md`
```

---

## 13. One-line current baseline

```markdown
The current Events pipeline is per-snapshot discovery in `server/lib/briefing/pipelines/events.js`, orchestrated by `briefing-aggregator.js`, using Gemini for event candidates, validation + write-time dedup before `discovered_events` upsert, venue identity from `venue_catalog`, and 2-hour post-event freshness/deactivation windows; dedup is still required because fresh LLM discovery can return overlapping/variant events and because persisted rows must update rather than duplicate across repeated runs.
```
