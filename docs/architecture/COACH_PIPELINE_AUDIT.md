# Coach Pipeline: Line-Numbered E2E Audit

## 0. Canonical naming and ownership

| File | Lines | Function / area | Status | Audit note |
|---|---:|---|---|---|
| `docs/architecture/RIDESHARE_COACH.md` | `L1-L24` | naming convention | canonical doc | Defines the canonical name as **Rideshare Coach**, component as `RideshareCoach.tsx`, DAL as `rideshare-coach-dal.js`, model role as `AI_COACH`, and DB tables as `coach_conversations`, `user_intel_notes`, and `coach_system_notes`. |
| `docs/architecture/RIDESHARE_COACH.md` | `L28-L47` | architecture overview + data flow | canonical flow | Defines the end-to-end flow: auth → snapshot resolution → DAL context loading → prompt formatting → `callModelStream('AI_COACH')` → SSE → action tags → DB writes. |
| `docs/architecture/RIDESHARE_COACH.md` | `L49-L55` | model role | active contract | `AI_COACH` is the model role; the external role name stays unchanged even if naming elsewhere says Rideshare Coach. |

## 1. Client entrypoint

| File | Lines | Function / area | Status | Audit note |
|---|---:|---|---|---|
| `client/src/components/RideshareCoach.tsx` | doc says `~885` lines | React chat component | active | Canonical frontend component for streaming messages, attachments, notes panel, optimistic notes UI, voice toggle, STT/TTS. |
| `docs/architecture/RIDESHARE_COACH.md` | `L57-L66` | frontend features | canonical doc | Lists streaming message display, attachment support, notes panel, voice integration, and validation error banner. |
| `docs/architecture/RIDESHARE_COACH.md` | `L115-L139` | voice integration | active | Voice currently uses `useSpeechRecognition` and `useTTS`; dead OpenAI Realtime code was removed/resolved. |

### Client-side duplicate risk

| File | Lines | Risk | Status | Audit note |
|---|---:|---|---|---|
| `docs/architecture/RIDESHARE_COACH.md` | `L146-L158` | client event-deactivation regex fallback | resolved | The canonical doc says duplicate client-side event deactivation parsing was resolved/removed. Keep it from returning. |

## 2. Main server route

| File | Lines | Function / call | Status | Audit note |
|---|---:|---|---|---|
| `server/api/chat/chat.js` | `L1-L16` | imports | active | Main Coach route imports `rideshareCoachDAL`, `requireAuth`, `validateAction`, snapshots/strategies, and enhanced context. |
| `server/api/chat/chat.js` | `L33-L145` | `parseActions()` | active | Parses JSON envelope actions and legacy inline `[TAG: {...}]` action tags. Supports notes, events, news, system notes, zone intel, event reactivation, add/update event, coach memos, market intel, and venue intel. |
| `server/api/chat/chat.js` | `L151-L188` | `extractBalancedJson()` | active helper | Balanced-brace JSON extractor used by legacy inline action parsing. |
| `server/api/chat/chat.js` | `L193-L630` | `executeActions()` | active write executor | Validates parsed action tags and routes writes to DAL methods / filesystem memo path. |
| `server/api/chat/chat.js` | `~L704-L735` | `GET /context/:snapshotId` | active read-only context endpoint | Returns snapshot, strategy, briefing, smart blocks, and status through `rideshareCoachDAL.getCompleteContext()`. |
| `server/api/chat/chat.js` | `~L739-L1572` | `POST /api/chat` | active main endpoint | Main streaming Coach endpoint: auth, timezone validation, snapshot resolution, context injection, model streaming, action parsing, persistence, SSE done event. |

## 3. Main chat request flow

| File | Lines | Function / call | Status | Audit note |
|---|---:|---|---|---|
| `server/api/chat/chat.js` | `~L739-L770` | request body + `requireAuth` | active | Requires signed-in user; rejects missing message; uses `req.auth.userId`, not body `userId`. |
| `server/api/chat/chat.js` | `~L771-L795` | timezone validation | active | Requires snapshot timezone; returns `TIMEZONE_REQUIRED` if missing. |
| `server/api/chat/chat.js` | `~L820-L875` | snapshot resolution | active | Uses UI `snapshotId` first, then resolves `strategyId`, then falls back to latest authenticated user snapshot. |
| `server/api/chat/chat.js` | `~L875-L940` | `getCompleteContext()` | active | Calls DAL for full context, then formats context for prompt. |
| `server/api/chat/chat.js` | `~L1161-L1351` | system prompt construction | active prompt contract | Canonical doc identifies this range as the system prompt construction block: identity, capabilities, action tags, data access summary, style, critical rules, and super-user context. |
| `server/api/chat/chat.js` | `~L1350-L1450` | `callModelStream('AI_COACH')` | active model call | Streams Gemini Coach response over SSE. The canonical doc defines this as the model call step. |
| `server/api/chat/chat.js` | `~L1450-L1572` | parse actions, execute writes, save assistant response, done event | active | Completes the stream, parses action tags, executes writes, persists assistant response, sends final SSE done event. |

## 4. Coach DAL context pipeline

| File | Lines | Function / call | Status | Audit note |
|---|---:|---|---|---|
| `server/lib/ai/rideshare-coach-dal.js` | `L1-L27` | imports schema tables | active | DAL imports all Coach context tables: snapshots, strategies, rankings, briefings, feedback, venue catalog/metrics, actions, market intel, user notes, driver profile/vehicle, events, conversations, system notes, news deactivations, zone intel, offer intelligence. |
| `rideshare-coach-dal.js` | `L29-L39` | DAL contract comment | canonical | Defines access pattern: `strategy_id → snapshot_id → user_id + session_id → ALL tables`; scoped reads, null-safe behavior, snapshot as temporal ground truth. |
| `rideshare-coach-dal.js` | `L47-L79` | `resolveStrategyToSnapshot()` | active | Resolves strategy entrypoint to snapshot/user/session. |
| `rideshare-coach-dal.js` | `L87-L154` | `getHeaderSnapshot()` | active | Loads snapshot-local location/time/weather/air context; snapshot is authoritative for time/location. |
| `rideshare-coach-dal.js` | `L163-L215` | `getLatestStrategy()` | active | Loads latest strategy for snapshot and joins snapshot location/holiday context. |
| `rideshare-coach-dal.js` | `L224-L260` | `getComprehensiveBriefing()` | active | Loads events, traffic, news, school closures, weather, and airport from `briefings`; says briefing table is the only source for briefing data. |
| `rideshare-coach-dal.js` | `L268-L281` | `getFeedback()` | active | Loads venue and strategy feedback scoped to snapshot. |
| `rideshare-coach-dal.js` | `L290-L320` | `getVenueData()` | active | Gets ranking candidates for snapshot, derives place IDs, then fetches matching venue catalog rows. |
| `rideshare-coach-dal.js` | `L328-L340` | `getActions()` | active | Loads driver action/session dwell data for snapshot. |
| `rideshare-coach-dal.js` | `L349-L381` | `getBriefing()` | overlap / duplicate-read risk | Older/simple briefing accessor duplicates part of `getComprehensiveBriefing()`. Audit whether both are still needed. |
| `rideshare-coach-dal.js` | `L390-L446` | `getSmartBlocks()` | active | Loads top Smart Blocks / ranking candidates for Coach prompt, including event badge/summary fields. |
| `rideshare-coach-dal.js` | `L455-L535` | `getMarketIntelligence()` | active | Gets market anchor/region type and coach-citable market intelligence. |
| `rideshare-coach-dal.js` | `L544-L576` | `getUserNotes()` | active memory read | Loads active user notes sorted pinned → importance → created. |
| `rideshare-coach-dal.js` | `L585-L635` | `saveUserNote()` | active memory write | Inserts Coach memory into `user_intel_notes`. |
| `rideshare-coach-dal.js` | `~L650-L760` | `getDriverProfile()` | active | Loads driver profile and primary vehicle. |
| `rideshare-coach-dal.js` | `~L790-L890` | `getCompleteContext()` | active context aggregator | Runs first batch in parallel: snapshot, strategy, briefing, Smart Blocks, feedback, venue data, actions; then market intel, notes, driver profile, offer history. |
| `rideshare-coach-dal.js` | `~L900-L920` | `_determineStatus()` | active readiness helper | Returns `missing_snapshot`, `pending_strategy`, `pending_blocks`, or `ready`. |
| `rideshare-coach-dal.js` | `~L930-L1300` | `formatContextForPrompt()` | active formatter | Converts all loaded data into prompt sections for Coach. |

## 5. Prompt context sections

| Source | File | Lines | Status | Audit note |
|---|---|---:|---|---|
| Driver profile | `rideshare-coach-dal.js` | `~L930-L1010` | active | Adds name, email, home, market, platforms, eligibility, vehicle/service preferences. |
| Vehicle info | `rideshare-coach-dal.js` | `~L1010-L1025` | active | Adds primary vehicle year/make/model/color/capacity. |
| Snapshot/location/time | `rideshare-coach-dal.js` | `~L1025-L1065` | active | Adds current location, timezone, day/hour/daypart, weather/air. |
| Strategy | `rideshare-coach-dal.js` | `~L1065-L1100` | active | Adds current strategy text and status. |
| Briefing | `rideshare-coach-dal.js` | `~L1100-L1160` | active | Adds traffic, weather, news, events, closures, airport. |
| Smart Blocks | `rideshare-coach-dal.js` | `~L1160-L1210` | active | Adds top venue recommendations with distance, time, value, events. |
| Feedback/actions | `rideshare-coach-dal.js` | `~L1210-L1250` | active | Adds venue/strategy feedback and session actions. |
| Market intelligence | `rideshare-coach-dal.js` | `~L1250-L1280` | active | Adds market position and coach-citable intelligence. |
| User notes | `rideshare-coach-dal.js` | `~L1280-L1300` | active | Adds Coach memory notes. |

## 6. Action parsing and execution

| File | Lines | Function / call | Status | Audit note |
|---|---:|---|---|---|
| `server/api/chat/chat.js` | `L33-L85` | JSON envelope parsing | active preferred format | Parses JSON blocks containing `actions` array and optional clean `response`. |
| `server/api/chat/chat.js` | `L92-L145` | legacy inline action parsing | compatibility / duplicate-risk | Supports `[TAG: {...}]` inline syntax. Keep only as compatibility; preferred path is JSON envelope. |
| `server/api/chat/chat.js` | `L193-L231` | `SAVE_NOTE` execution | active | Validates note, then writes via `rideshareCoachDAL.saveUserNote()`. |
| `server/api/chat/chat.js` | `L234-L271` | `DEACTIVATE_EVENT` execution | active | Validates and writes event deactivation through DAL. |
| `server/api/chat/chat.js` | `L274-L309` | `REACTIVATE_EVENT` execution | active | Validates and writes event reactivation through DAL. |
| `server/api/chat/chat.js` | `L312-L347` | `DEACTIVATE_NEWS` execution | active | Validates and writes user-specific news hide action. |
| `server/api/chat/chat.js` | `L350-L386` | `SYSTEM_NOTE` execution | active | Writes developer/system observations. |
| `server/api/chat/chat.js` | `L389-L428` | `ADD_EVENT` execution | active / event-pipeline bridge | Allows driver-reported event creation through Coach; derives city/state from snapshot if needed. |
| `server/api/chat/chat.js` | `L431-L466` | `UPDATE_EVENT` execution | active / event-pipeline bridge | Allows driver-corrected event updates. |
| `server/api/chat/chat.js` | `L469-L501` | `COACH_MEMO` execution | active filesystem bridge | Writes to `docs/coach-inbox.md`; separate from DB writes. |
| `server/api/chat/chat.js` | `L504-L548` | `ZONE_INTEL` execution | active | Writes crowd-sourced zone intelligence. |
| `server/api/chat/chat.js` | `L551-L587` | `MARKET_INTEL` execution | active | Writes market intelligence from driver conversation. |
| `server/api/chat/chat.js` | `L590-L623` | `SAVE_VENUE_INTEL` execution | active / venue-catalog bridge | Writes driver-provided venue intel into `venue_catalog`. |

## 7. Action validation

| File | Lines | Function / area | Status | Audit note |
|---|---:|---|---|---|
| `server/api/rideshare-coach/validate.js` | `L1-L10` | module header | active | Pre-flight validation for AI Coach actions. |
| `server/api/rideshare-coach/validate.js` | `L18-L43` | `noteSchema` | active | Validates `SAVE_NOTE`. |
| `server/api/rideshare-coach/validate.js` | `L48-L61` | `eventDeactivationSchema` | active | Validates `DEACTIVATE_EVENT`. |
| `server/api/rideshare-coach/validate.js` | `L66-L72` | `eventReactivationSchema` | active | Validates `REACTIVATE_EVENT`. |
| `server/api/rideshare-coach/validate.js` | `L77-L88` | `zoneIntelSchema` | active | Validates `ZONE_INTEL`. |
| `server/api/rideshare-coach/validate.js` | `L93-L105` | `systemNoteSchema` | active | Validates `SYSTEM_NOTE`. |
| `server/api/rideshare-coach/validate.js` | `L110-L114` | `newsDeactivationSchema` | active | Validates `DEACTIVATE_NEWS`. |
| `server/api/rideshare-coach/validate.js` | `L119-L130` | `addEventSchema` | active | Validates `ADD_EVENT`. |
| `server/api/rideshare-coach/validate.js` | `L135-L147` | `updateEventSchema` | active | Validates `UPDATE_EVENT`. |
| `server/api/rideshare-coach/validate.js` | `L153-L160` | `rideshareCoachMemoSchema` | active | Validates `COACH_MEMO`. |
| `server/api/rideshare-coach/validate.js` | `L164-L175` | `marketIntelSchema` | active | Validates `MARKET_INTEL`. |
| `server/api/rideshare-coach/validate.js` | `L178-L188` | `venueIntelSchema` | active | Validates `SAVE_VENUE_INTEL`. |
| `server/api/rideshare-coach/validate.js` | `L191-L203` | `ACTION_SCHEMAS` | active map | Central action → schema registry. |
| `server/api/rideshare-coach/validate.js` | `L388-L414` | `validateAction()` | active programmatic API | Used by `chat.js` before executing parsed actions. |

## 8. Coach memory / notes APIs

| File | Lines | Function / route | Status | Audit note |
|---|---:|---|---|---|
| `server/api/chat/chat.js` | `L634-L666` | `POST /api/chat/notes` | active / duplicate-surface | Chat route exposes note creation directly. |
| `server/api/chat/chat.js` | `L668-L681` | `GET /api/chat/notes` | active / duplicate-surface | Chat route exposes basic notes listing. |
| `server/api/chat/chat.js` | `L683-L702` | `DELETE /api/chat/notes/:noteId` | active / duplicate-surface | Chat route exposes soft-delete note behavior. |
| `server/api/rideshare-coach/notes.js` | doc says `448` lines | notes CRUD API | active canonical notes API | Canonical doc says this file owns notes CRUD: list, get, create, update, delete, pin, restore, stats. |

### Notes duplicate risk

There appear to be two note surfaces:
- `/api/chat/notes` inside `server/api/chat/chat.js`
- `/api/coach/notes` or `/api/rideshare-coach/notes` via `server/api/rideshare-coach/notes.js`

Expected:
- Keep one canonical notes CRUD surface.
- Keep `/api/chat/notes` only if needed for backwards compatibility.
- All note writes should use `rideshareCoachDAL.saveUserNote()` or a single shared DAL method.

## 9. Schema metadata injection

| File | Lines | Function / area | Status | Audit note |
|---|---:|---|---|---|
| `server/api/rideshare-coach/schema.js` | `L1-L17` | file header/schema metadata | active | Read-only schema metadata for Coach prompt injection. |
| `server/api/rideshare-coach/schema.js` | `L18-L90` | readable tables | active | Lists snapshots, strategies, briefings, discovered events, venue catalog, ranking candidates, market intelligence, zone intelligence, driver profiles, vehicles, notes, offer intelligence. |
| `server/api/rideshare-coach/schema.js` | `L91-L175` | writable tables | active | Documents writable action surfaces: notes, events, zones, coach conversations, system notes, news, market intel, venue intel. |
| `server/api/rideshare-coach/schema.js` | `L176-L220` | relationships/scoping | active | Documents relationships and data scoping rules. |
| `server/api/rideshare-coach/schema.js` | `L221-L261` | schema endpoints | active | Exposes schema metadata endpoints. |

## 10. Conversation persistence

| File | Lines | Function / area | Status | Audit note |
|---|---:|---|---|---|
| `server/api/chat/chat.js` | `~POST /api/chat` body | save user message | active but hardening-risk | Canonical doc says user message is saved to `coach_conversations` before/around model streaming, and assistant response is saved after stream completion. |
| `server/lib/ai/rideshare-coach-dal.js` | search needed | `saveConversationMessage()` / conversation writes | active expected | DAL should own final `coach_conversations` writes. Audit for fire-and-forget saves. |
| `docs/architecture/RIDESHARE_COACH.md` | `L146-L158` | known issues | hardening-risk | Canonical doc flags “conversation saves are fire-and-forget with swallowed errors” as COACH-H8. |

### Conversation persistence risk

Expected:
- User and assistant messages should persist to `coach_conversations`.
- Save failures should be observable and should not silently disappear.
- If streaming succeeds but assistant save fails, SSE `done` should surface an action/persistence warning.

## 11. Read/write target tables

| Table | Source file | Purpose | Status |
|---|---|---|---|
| `coach_conversations` | `shared/schema.js`, DAL | user/assistant/system chat history | active |
| `user_intel_notes` | `shared/schema.js`, DAL, notes API | Coach memory about driver | active |
| `coach_system_notes` | `shared/schema.js`, DAL | developer/system observations | active |
| `discovered_events` | DAL actions | deactivate/reactivate/add/update events | active bridge to Event Catalog Pipeline |
| `news_deactivations` | DAL actions | per-user news hiding | active |
| `zone_intelligence` | DAL actions | crowd-sourced zone knowledge | active |
| `market_intelligence` | DAL actions | driver-sourced market intelligence | active |
| `venue_catalog` | DAL actions | driver-sourced venue intel | active bridge to Venue Catalog |
| `offer_intelligence` | DAL read context | offer analysis history | active read context |

## 12. Duplicate / overlap checks for Claude

### A. Naming must stay stable
Check:
- `docs/architecture/RIDESHARE_COACH.md` (naming convention around L1-L24)
- `server/api/chat/chat.js`
- `server/lib/ai/rideshare-coach-dal.js`
- model role remains `AI_COACH`

### B. Main Coach context must flow through DAL
Check:
- `server/api/chat/chat.js` (`POST /api/chat`)
- `server/lib/ai/rideshare-coach-dal.js` (`getCompleteContext()`, `formatContextForPrompt()`)
- DAL should own data access and context formatting. Do not duplicate large context SQL in the route file.

### C. Action parsing should stay server-owned
Check:
- `server/api/chat/chat.js` (`parseActions()`, `executeActions()`)
- `client/src/components/RideshareCoach.tsx` (ensure old client-side event deactivation parser does not return)

### D. Validation should stay centralized
Check:
- `server/api/rideshare-coach/validate.js` (`ACTION_SCHEMAS`, `validateAction()`)
- `server/api/chat/chat.js` (every write path should call `validateAction()` first)

### E. Notes APIs are overlapping
Check:
- `server/api/chat/chat.js` (`/notes` routes)
- `server/api/rideshare-coach/notes.js` (full notes CRUD)
- Pick canonical notes API, keep duplicate only as backwards-compatible alias if needed. Both should share the same DAL/write semantics.

### F. Event writes from Coach must not bypass Event Catalog rules
Check:
- `server/api/chat/chat.js` (`ADD_EVENT`, `UPDATE_EVENT`)
- `server/lib/ai/rideshare-coach-dal.js`
- `server/lib/events/pipeline/validateEvent.js`
- Coach must not create a parallel unvalidated event pipeline.

### G. Venue intel from Coach must not bypass venue_catalog quality rules
Check:
- `server/api/chat/chat.js` (`SAVE_VENUE_INTEL`)
- `server/lib/ai/rideshare-coach-dal.js` (`saveVenueCatalogEntry()`)
- `server/lib/venue/venue-cache.js`
- Coach venue writes should not mark weak/unverified identity as canonical planner-grade venue data unless quality fields are present.

### H. Streaming fallback remains open hardening
Check:
- `server/api/chat/chat.js` (streaming model call)
- `docs/architecture/RIDESHARE_COACH.md` (COACH-H7)

## 13. Main red flags / hardening backlog

1. **Conversation persistence is still flagged as risky.** The canonical doc lists COACH-H8: conversation saves are fire-and-forget with swallowed errors.
2. **No context size estimation.**
3. **No conversation summarization.**
4. **Action parsing still supports regex legacy mode.** JSON envelope is preferred.
5. **Notes routes overlap.** `chat.js` has `/api/chat/notes` helpers, while canonical Coach notes CRUD lives in `server/api/rideshare-coach/notes.js`.
6. **Coach is a write bridge into multiple pipelines.** Each write must respect the downstream pipeline’s quality gates.

## 14. One-line canonical Coach flow

RideshareCoach.tsx → POST /api/chat → requireAuth + timezone check → snapshot/strategy resolution → rideshareCoachDAL.getCompleteContext() → formatContextForPrompt() → build AI_COACH system prompt → callModelStream('AI_COACH') → SSE chunks → parse JSON/legacy action tags → validateAction() via Zod → execute DAL/filesystem writes → persist assistant response → SSE done with conversation_id and actions_result.
