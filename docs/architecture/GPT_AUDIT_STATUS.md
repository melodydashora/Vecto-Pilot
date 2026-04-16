# GPT Audit Status Tracker

**Created:** 2026-04-16
**Last updated:** 2026-04-16
**Context:** Phase 8 data-model audit items from BRIEFING-DATA-MODEL.md, plus session-specific fixes.

---

## Audit Items (15 original + 2 session fixes)

| # | Item | Status | Commit / Notes |
|---|------|--------|----------------|
| 1 | Header rewiring (Global Header reads snapshot, not DB user) | NEEDS OWNER APPROVAL | Architectural change — must be scoped and approved by Melody |
| 2 | Market fallback removal (city-as-market substitution) | **DONE** | `ee91885e` — `getMarketForLocation()` returns null; callers use `[unknown-market]` placeholder |
| 3 | `briefings.holiday` column drop (duplicated from snapshot) | NEEDS OWNER APPROVAL | Column exists on both `snapshots` and `briefings`; removing requires migration |
| 4 | `briefings.status` / `generated_at` populate (or drop) | NEEDS OWNER APPROVAL | Both columns currently dead (never written). Decision: populate or remove in Phase 7 |
| 5 | DOW downstream audit (no recomputation when snapshot.dow available) | **DONE** | `2447c306` — 12 call sites audited; 1 violation fixed (`briefing-service.js:1191`); rest are legitimate |
| 6 | Prompt narrative restatement audit | **IN PROGRESS** | See §Prompt Narrative Restatement Findings below |
| 7 | Hard-fail path verification (missing required fields) | NEEDS TESTING | Data model says missing `market`/`timezone` = hard fail; need to verify all code paths enforce this |
| 8 | School closure reopen-date camelCase mismatch | **DONE** | `158161e8` — normalization at ingestion in `fetchSchoolClosures()`; filters updated for legacy rows |
| 9 | News/staleness guardrails | MOSTLY ADDRESSED | Date-based filtering and `published_date` requirement are in place; no formal expiry sweep yet |
| 10 | Event all-day times handling | DONE (previously) | Events without times are estimated by category (Sports=3h, Concert=3h, etc.) |
| 11 | Event dedup | DONE (previously) | Hash-based dedup in event pipeline |
| 12 | SSE condensation | DEFERRED | Low priority; SSE streaming works but is verbose |
| 13 | Google Maps → Google Places migration | NOT VERIFIED | Need to confirm all map/geocoding calls use Places API (new) vs Maps API (legacy) |
| 14 | Translation/audio pipeline | NOT VERIFIED | TTS pipeline exists but not audited for data-model compliance |
| 15 | Feature proposals (from original audit) | NOT VERIFIED | Proposals logged but not reviewed for feasibility |
| S1 | `local_hour` UTC bug in analyze-offer.js | **DONE** | `40b03507` — temporal columns now derived from driver timezone via `resolveTimezoneFromCoords()` |
| S2 | NO DATA voice line in buildVoiceLine | **DONE** | `2447c306` — returns `"No data. Decide manually."` instead of bare `"Unknown."` |

---

## Prompt Narrative Restatement Findings

**Rule (from BRIEFING-DATA-MODEL.md):** Prompts should pass snapshot fields as structured data, not restate them as narrative prose. Narrative restatement creates a second source of truth that can diverge from the snapshot.

### briefing-service.js

| Line | Function | Snapshot Fields Restated | Structured Snapshot Passed? | Severity |
|------|----------|-------------------------|----------------------------|----------|
| 987–1015 | `fetchEventCategory()` | `city`, `state`, `date`, `lat`, `lng`, `market` | No — injected as prose into search prompt | **Low** — these are search prompts for external web search (Gemini grounding), not analysis prompts. The LLM needs the location *as text* to form a web query. Structured JSON wouldn't help Google Search. |
| 1212–1232 | `_fetchEventsWithGemini3ProPreviewLegacy()` | `city`, `state`, `date`, `dayOfWeek` (from snapshot.dow) | No — same pattern, search prompt | **Low** — same justification as above |
| 1601 | `fetchWeatherForecast()` | `city`, `state`, `date` | No — search prompt | **Low** — web search needs text |
| 1838–1873 | `fetchSchoolClosures()` | `city`, `state`, `lat`, `lng`, `country` | No — search prompt | **Low** — web search needs text |
| 2114–2126 | `fetchTraffic()` (Gemini path) | `city`, `state`, `date` | No — search prompt | **Low** — web search needs text |
| 2264–2267 | `fetchAirportConditions()` | `city`, `state`, `date` | No — search prompt | **Low** — web search needs text |
| 2443–2487 | `buildNewsPrompt()` | `city`, `state`, `market`, `date` | No — search prompt | **Low** — web search needs text |
| 584–617 | `fetchNewsWithClaudeWebSearch()` | `city`, `state`, `date` | No — search prompt (Claude fallback) | **Low** — web search needs text |

### concierge-service.js

| Line | Function | Snapshot Fields Restated | Structured Snapshot Passed? | Severity |
|------|----------|-------------------------|----------------------------|----------|
| 789–826 | `buildConciergeSystemPrompt()` | `lat`, `lng`, `timezone`, `date` (recomputed), `dayOfWeek` (recomputed), `localTime` (recomputed) | No — but concierge has no snapshot object, only receives individual fields | **Medium** — `date`/`dayOfWeek`/`localTime` are recomputed from `new Date()` rather than read from a snapshot. The concierge path doesn't receive a snapshot, so this is by design, but if the concierge ever gets snapshot access these should be read not computed. |
| 503 | `geminiDiscoverAndPersist()` | `lat`, `lng`, `todayDate`, `dayOfWeek` | No — search prompt | **Low** — web search needs text |

### consolidator.js (Strategy prompt)

| Line | Function | Snapshot Fields Restated | Structured Snapshot Passed? | Severity |
|------|----------|-------------------------|----------------------------|----------|
| 203–242 | Strategy prompt builder | `city`, `state`, `lat`, `lng`, `timezone`, `day_part_key`, `holiday`, `formatted_address` | **Yes — reads directly from `snapshot.*`** | **None** — this is the correct pattern. The consolidator reads structured snapshot fields and formats them into a labeled `=== DRIVER CONTEXT ===` block. No recomputation, no second source of truth. |

### Summary

**No high-severity violations found.** The briefing-service prompts inject `city`/`state`/`date` as narrative text, but these are all **web-search prompts** where the LLM needs human-readable location text to form Google Search queries. Passing structured JSON to a Gemini grounding call would not improve accuracy.

The consolidator (strategy prompt) correctly reads all fields from the snapshot object — this is the model to follow.

**One medium concern:** `concierge-service.js:789` recomputes `date`/`dayOfWeek`/`localTime` from `new Date()` instead of receiving them from a snapshot. This is currently by-design (concierge doesn't have snapshot access) but should be revisited if the concierge path is ever given a snapshot.

---

## Next Steps

| Priority | Item | Action Needed |
|----------|------|---------------|
| 1 | Items 3, 4 (holiday/status columns) | Present options to Melody: populate or drop |
| 2 | Item 1 (header rewiring) | Scope the architectural change, present plan |
| 3 | Item 7 (hard-fail verification) | Write integration tests for missing-field paths |
| 4 | Item 13 (Google Maps migration) | Audit all geocoding/mapping calls |
| 5 | Items 14, 15 | Review translation pipeline and feature proposals |
