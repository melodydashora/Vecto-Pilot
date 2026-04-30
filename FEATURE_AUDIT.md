# Feature Audit — 2026-04-16

**Conducted by:** Claude Opus 4.6 (codebase investigation, not inferred)
**Scope:** 5 user-facing systems — Bars/Lounges, Smart Blocks, Rideshare Coach, Translation, Memory/Observability
**Cross-references:** `AUDIT.md` (30 findings, same date), `docs/architecture/full-audit-2026-04-04.md` (37 prior findings)

---

## Audit Matrix

| # | Feature | Current AI Role | User Expectation | Gap | Fix Priority | Owning Files + Lines |
|---|---------|----------------|------------------|-----|-------------|---------------------|
| F-1 | Bars: "Open Now" filter | VENUE_FILTER (Haiku 4.5) | Only shows bars confirmed open | Venues with `isOpen===null` pass filter if Haiku-classified (P0-1) | **P0** | `venue-intelligence.js:487-489, 645-647` |
| F-2 | Bars: Hours display | Inline parser | Shows today's hours accurately | Abbreviated day names ("Thu") fail `startsWith("thursday")` (P0-2) | **P0** | `venue-intelligence.js:99-101` |
| F-3 | Smart Blocks: Venue coords | VENUE_SCORER (GPT-5.4) | Accurate venue locations | AI-generated coords are 50-150m off; 500m search radius compensates but causes false matches (P0-6) | **P0** | `tactical-planner.js:127, 373-376; venue-enrichment.js:391` |
| F-4 | Smart Blocks: Driver prefs | VENUE_SCORER (GPT-5.4) | Scoring reflects driver preferences | `generateTacticalPlan()` accepts NO user preference params — `user_id` is attribution-only | **P1** | `tactical-planner.js:68-81` |
| F-5 | Bars vs Smart Blocks: Strategic intent | N/A (divergent pipelines) | Bars tab shows strategically optimal venues | Bar tab is independent utility (Google Places + Haiku); Smart Blocks uses strategy pipeline | **P1** | `venue-intelligence.js:348-358, 808-839` |
| F-6 | Coach: Conversation persistence | Gemini 3.1 Pro (AI_COACH) | Conversations saved reliably | Fire-and-forget saves swallow errors (P1-14) | **P1** | `chat.js:1322-1352` |
| F-7 | Coach: Action parse limits | Gemini 3.1 Pro (AI_COACH) | Bounded action processing | No limit on parsed actions count or data size (P1-8) | **P1** | `chat.js:33-127` |
| F-8 | Translation: Language selection | UTIL_TRANSLATION (Gemini Flash Lite) | Auto-detect rider language | Explicit selection is intentional policy; `targetLang='auto'` deliberately removed | **Known UX debt** | `TranslationOverlay.tsx:48-50` |
| F-9 | Memory: Cross-surface joins | N/A (3 separate stores) | Unified diagnostics across Coach, Memory API, Observability | No shared IDs (session_id, conversation_id, driver_id) across surfaces | **P2** | `useMemory.ts:93-109; memory/index.js:98-131; chat.js:1332-1345` |
| F-10 | Coach: Streaming fallback | Gemini 3.1 Pro (AI_COACH) | Coach available if Gemini down | No fallback model for AI_COACH role (P1-13) | **P1** | `model-registry.js` (AI_COACH role definition) |

---

## 1. Lounges & Bars Tab

### Current Implementation

The Bars tab is a standalone venue discovery pipeline that operates **independently from the strategy system**. It uses Google Places API (New) for bar/lounge discovery and Claude Haiku 4.5 for quality classification.

**Pipeline flow:**
```
Browser request (driver lat/lng, timezone)
  → GET /api/venues/nearby
    → venue-intelligence.js:discoverNearbyVenues() [line 348]
      → Google Places searchNearby (500m radius) [venue-enrichment.js:391]
      → calculateOpenStatus() per venue [venue-intelligence.js:42-46]
      → VENUE_FILTER (Haiku 4.5): classify P/S/X [model-registry.js]
      → Filter: isOpen===true OR (isOpen===false && expense>=3) OR (isOpen===null && tier) [lines 631-647]
      → Sort by expense_rank descending [line 680]
      → Persist to venue_catalog [lines 960-974]
```

**Key files:**
- `server/lib/venue/venue-intelligence.js` — Discovery, filtering, sorting, DB persist
- `server/lib/venue/venue-enrichment.js` — Google Places API calls, address resolution, name similarity
- `server/lib/venue/venue-cache.js` — venue_catalog CRUD, progressive enrichment
- `server/lib/venue/hours/parsers/google-weekday-text.js` — Canonical weekday parsing with WEEKDAY_MAP
- `server/lib/venue/hours/evaluator.js` — Canonical `getOpenStatus(schedule, timezone)`

### Documented Behavior
- Bars are sorted by expense rank (upscale first)
- Quality tier is set by Haiku classification: Premium (P), Standard (S), Exclude (X)
- `record_status: 'verified'` — Bar Tab discovery is treated as a trusted source (`venue-intelligence.js:964`)
- `is_bar: true` flag set on all discoveries (`venue-intelligence.js:962`)

### Undocumented Behavior
- **Venues with unknown hours are included if Haiku-classified** — `isOpen===null && venue_quality_tier` passes the filter at lines 487-489 (cache path) and 645-647 (fresh path). No UI indicator distinguishes "confirmed open" from "hours unknown."
- **Closed high-value venues are included** — `isOpen===false && expense_rank >= 3` passes with `closed_go_anyway: true` flag (lines 480-482, 636-637). This is useful for staging but the rationale isn't surfaced to the user.
- **The inline weekday parser at line 99 does NOT use WEEKDAY_MAP** — it uses `startsWith(todayName)` which fails on abbreviated day names ("Thu", "Mon", etc.). The canonical parser at `google-weekday-text.js:136` handles this correctly.

### Gap List
1. **P0-1 (AUDIT.md):** `isOpen===null` venues must be excluded from "open now" results or explicitly labeled "Hours Unknown" in UI
2. **P0-2 (AUDIT.md):** Inline weekday parser at line 99 must delegate to `google-weekday-text.js` WEEKDAY_MAP (lines 31-38)
3. No strategic intent — bar tab shows nearby venues by expense, not by earnings optimization potential
4. No driver preference integration (venue-type prefs, home-base proximity, deadhead tolerance)

### Recommended Next Step
Fix P0-1 and P0-2 first (data correctness). Then decide: relabel as "Nearby Lounges" utility or integrate strategy-aware scoring.

---

## 2. Smart Blocks / Event-Aware Strategy

### Current Implementation

Smart Blocks is the primary earnings-optimization pipeline. It runs a 4-phase waterfall: Briefing → Strategy → Venue Scoring → Enrichment.

**Pipeline flow (from `blocks-fast.js:1-36`):**
```
POST /api/blocks-fast
  Phase 1: BRIEFING_* roles → weather, traffic, events, news, airport, schools
  Phase 2: STRATEGY_TACTICAL (Claude Opus 4.6) → strategy_for_now
  Phase 3: VENUE_SCORER (GPT-5.4) → 4-6 venue recommendations with coords
  Phase 4: Google APIs → distances, hours, enrichment → ranking_candidates table
```

**Key files:**
- `server/api/strategy/blocks-fast.js` — Waterfall orchestrator, two-phase advisory locking (lines 86-127, 150-290)
- `server/lib/strategy/tactical-planner.js` — VENUE_SCORER prompt and response handling
- `server/lib/strategy/strategy-generator-parallel.js` — 4-phase parallel strategy generation
- `server/lib/strategy/strategy-triggers.js` — Regeneration trigger detection (movement, day-part change)
- `server/api/strategy/content-blocks.js` — Read-only polling endpoint (lines 42-55)
- `server/lib/venue/venue-enrichment.js` — Google Places enrichment post-scoring

### Documented Behavior
- VENUE_SCORER prompt requests "specific venues with EXACT COORDINATES" (`tactical-planner.js:127`)
- 15-mile hard rule: NEAR events (<=15mi) are candidates, FAR events (>15mi) are surge intel only (`tactical-planner.js:156-172`)
- Event bucketing in prompt separates NEAR vs FAR with explicit counts (`tactical-planner.js:299-332`)
- Null-coord venues are dropped post-scoring (`tactical-planner.js:373-376`)
- Advisory locking via `pg_try_advisory_xact_lock()` prevents concurrent generation (`blocks-fast.js:96-101`)

### Undocumented Behavior
- **`generateTacticalPlan()` accepts NO user preference parameters** (`tactical-planner.js:68-81`). The function signature is `{ strategy, snapshot, briefingContext }`. `user_id` flows through `blocks-fast.js:255-267` as an option but is used only for DB attribution, not scoring.
- **AI-generated coordinates are validated only for null** (`tactical-planner.js:373`) — any numeric lat/lng is accepted. No distance-from-Google-Places validation occurs.
- **500m nearby search radius** (`venue-enrichment.js:391`) was increased from 150m to compensate for AI coordinate imprecision, but introduces false matches in dense commercial areas.
- **Name similarity uses simple word overlap** (`venue-enrichment.js:530-550`) — no fuzzy/phonetic matching. Normalized words under 3 chars are discarded (line 539).

### Gap List
1. **P0-6 (AUDIT.md):** AI coords must be validated against Google Places before ranking/distance/navigation
2. **F-4:** Driver preferences (home base, deadhead tolerance, venue-type prefs) not incorporated into scoring
3. **P0-5 (AUDIT.md):** Advisory lock race condition in briefing-service.js (lines 2570-2587, 2645-2685)
4. Event verification is sequentially chunked at 3, adding 10-25s latency (P2-1)

### Recommended Next Step
Fix P0-6 (coordinate trust) and add `user_preferences` parameter to `generateTacticalPlan()` to inform scoring.

---

## 3. Rideshare Coach

### Current Implementation

The Rideshare Coach is a streaming multimodal AI assistant powered by Gemini 3.1 Pro with Google Search grounding.

**Key files:**
- `client/src/components/RideshareCoach.tsx` — Full UI component (streaming, notes, voice, attachments)
- `client/src/hooks/useMemory.ts` — Memory logging hook (conversation/preference/session persistence)
- `server/api/chat/chat.js` — Server-side coach endpoint (POST /api/chat/ask)
- `server/api/chat/tts.js` — Text-to-speech endpoint
- `server/api/chat/realtime.js` — OpenAI Realtime voice token minting

**Capability inventory (verified line numbers in RideshareCoach.tsx):**

| Capability | Lines | Implementation |
|-----------|-------|----------------|
| Streaming chat (SSE) | 376-435 | `reader.read()` loop with delta accumulation |
| Persistent state | 1322-1352 (chat.js) | `saveConversationMessage()` to `coach_conversations` |
| Notes panel (CRUD) | 90-92, 111-127, 530-647 | Slide-out panel with fetch/delete/pin/edit |
| Memory logging on completion | 216-235 | `useMemory` hook: `logConversation()` fires 500ms after streaming ends |
| Voice input (mic) | 83-84, 246-267, 792-807 | `useSpeechRecognition()` hook with toggle button |
| TTS output | 86-88, 270-281, 437-447 | Auto-speak after stream completes; `cleanTextForTTS()` strips markdown |
| File attachments | 76, 283-307, 716-733 | Multi-file reader with base64 encoding, UI chips with removal |
| Mic preflight | 105-108 | Syncs `speech.transcript` to ref to avoid stale closures |

### Documented Behavior
- Voice toggle persisted in localStorage (`RideshareCoach.tsx:86-88`)
- TTS warm-up on user gesture (`RideshareCoach.tsx:246`: `tts.warmUp()`)
- Notes types: `preference | insight | tip | feedback | pattern | market_update` (`RideshareCoach.tsx:15-27`)
- Action tags parsed from AI responses: notes, events, news, systemNotes, zoneIntel, eventReactivations, addEvents, updateEvents, coachMemos, marketIntel, venueIntel (`chat.js:33-50`)

### Undocumented Behavior
- **Conversation saves are fire-and-forget** — errors in `saveConversationMessage()` are caught and swallowed (`chat.js:1322-1352`). The coach silently forgets conversations on DB errors.
- **No limit on parsed action count or data size** (`chat.js:33-127`) — a malicious or hallucinated AI response could trigger thousands of note-saves.
- **No streaming fallback** — if Gemini 3.1 Pro is down, the coach is completely unavailable (P1-13).
- **OpenAI Realtime token minted before ownership check** (`realtime.js:43-60, 75-87`) — unauthorized users can cause token costs (P1-10).

### Gap List
1. **P1-14 (AUDIT.md):** Coach conversation saves must log errors, not swallow them
2. **P1-8 (AUDIT.md):** Cap parsed actions at 20; truncate action data to 10KB
3. **P1-13 (AUDIT.md):** Add fallback model for AI_COACH role
4. **P1-10 (AUDIT.md):** Move ownership check before OpenAI token minting

### Recommended Next Step
Fix P1-14 (silent conversation loss) — it undermines the Coach's value proposition of persistent context.

---

## 4. Translation

### Current Implementation

Real-time driver-rider translation powered by Gemini 3.1 Flash Lite (UTIL_TRANSLATION role, 512 max tokens).

**Key files:**
- `client/src/components/co-pilot/TranslationOverlay.tsx` — UI component with language selection
- `server/api/translate/index.js` — Translation endpoint (POST /api/translate)
- `server/api/translate/translation-prompt.js` — System prompt, language list, response parser
- `server/api/hooks/translate.js` — Siri Shortcuts hook (POST /api/hooks/translate)

### Documented Behavior
- 15 supported languages defined in `translation-prompt.js:9-30` (Spanish, Polish, French, Arabic, Chinese, Korean, etc.)
- `sourceLang='auto'` is valid — Gemini detects source language from text (`translation-prompt.js:36`)
- Conversational tone: "appropriate for a car ride, not formal/literary" (`translation-prompt.js:38`)
- 3-attempt response parsing fallback chain (`translation-prompt.js:54-92`)

### Documented Design Decision: Explicit Rider Language Selection
**This is intentional policy, not a bug.**

`TranslationOverlay.tsx:48-50`:
```
// 2026-04-05: Removed 'auto' from language list (audit fix 1A).
// targetLang='auto' is undefined behavior — rider language must be explicitly selected.
// Auto-detect is valid for sourceLang (detecting what someone speaks) but NOT for targetLang.
```

The user must select the rider's language before translating (`TranslationOverlay.tsx:168-171`). This prevents mistranslation from auto-detect guessing the wrong target language.

### Gap List
1. **Known UX debt:** Forced explicit language selection adds friction. Product decision required before reverting.
2. No offline/cached translation for common phrases (network-dependent)

### Recommended Next Step
Document the explicit-selection rationale in product decisions log. Do not revert without product signoff.

---

## 5. Memory / Notes / Observability

### Current Implementation

Three separate persistence surfaces exist with no shared identifier scheme:

| Surface | Storage | Access | Key IDs |
|---------|---------|--------|---------|
| Coach Notes (user-visible) | `user_intel_notes` table | `RideshareCoach.tsx` notes panel (lines 530-647) | `note.id`, `user_id` |
| Memory Log | `claudeMemory` table | `POST /api/memory` (`memory/index.js:98-131`) | `session_id`, `category` |
| Agent Memory | `agent_memory`, `assistant_memory`, `eidolon_memory` | `useMemory.ts` → `/agent/memory/*` endpoints | `userId` (string) |

**Coach Notes** (`RideshareCoach.tsx`):
- Full CRUD: fetch (111-127), delete (137-153), pin toggle (156-174), save edit (177-203)
- Types: `preference | insight | tip | feedback | pattern | market_update` (lines 15-27)
- API routes: `GET /api/coach/notes`, `DELETE /api/coach/notes/:id`, `POST /api/coach/notes/:id/pin`, `PUT /api/coach/notes/:id`

**Memory API** (`server/api/memory/index.js`):
- Required fields: `session_id`, `category`, `title`, `content`
- Optional: `status`, `priority`, `tags` (array), `related_files` (array), `parent_id`, `metadata` (JSON)
- Endpoints: `GET /`, `GET /stats`, `GET /rules`, `GET /session/:sessionId`, `POST /`, `PATCH /:id`, `DELETE /:id`

**Agent Memory** (`client/src/hooks/useMemory.ts`):
- Hits: `GET /agent/context` (line 47), `GET /agent/memory/conversations` (line 78), `POST /agent/memory/conversation` (line 95), `POST /agent/memory/preference` (line 114), `POST /agent/memory/session` (line 133), `POST /agent/memory/project` (line 152)

### Undocumented Behavior
- **No shared IDs across surfaces** — Coach Notes use integer `note.id`, Memory API uses `session_id` (string), Agent Memory uses `userId` (string). No `conversation_id` or `driver_id` links them.
- **Coach conversation saves and Memory API are both fire-and-forget** — errors are swallowed in both paths.
- **`claudeMemory` table (Memory API) has no foreign key to `users` or `driver_profiles`** — it's a standalone store.

### Gap List
1. No common ID scheme for cross-surface diagnostics joins
2. No operational observability surface (the third planned surface is TBD)
3. Coach Notes and Memory API could diverge on the same topic with no reconciliation
4. No retention policy — all three stores grow unbounded

### Recommended Next Step
Define common identifiers (`session_id`, `conversation_id`, `driver_id`) and add them to all three surfaces for diagnostics joins.

---

*This audit is observable-only — all findings are verified from source code, not inferred. Cross-reference AUDIT.md for the full 30-finding technical audit.*
