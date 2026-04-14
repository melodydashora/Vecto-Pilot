# RIDESHARE_COACH.md — Rideshare Coach System

> **Trust Tier:** Canonical
> **Last Updated:** 2026-04-14
> **Consolidates:** AI_RIDESHARE_COACH.md, AI_COACH_VOICE_PLAN.md, ai-coach-enhancements.md, coach-inbox.md

## Naming Convention

| Context | Name | Example |
|---------|------|---------|
| Product name (prose) | **Rideshare Coach** | "The Rideshare Coach helps drivers..." |
| Canonical doc | `RIDESHARE_COACH.md` | This file |
| Component file | `RideshareCoach.tsx` | `client/src/components/RideshareCoach.tsx` |
| Component name | `RideshareCoach` | `export default function RideshareCoach` |
| DAL file | `rideshare-coach-dal.js` | `server/lib/ai/rideshare-coach-dal.js` |
| Class name | `RideshareCoachDAL` | `export class RideshareCoachDAL` |
| Singleton export | `rideshareCoachDAL` | `import { rideshareCoachDAL } from ...` |
| Server chat routes | `chat.js` | `server/api/chat/chat.js` |
| Log prefix | `[RideshareCoach]` | All console.log/error/warn in coach code |
| UI heading | `"Rideshare Coach"` | Header and welcome text shown to driver |
| Model role | `AI_COACH` | `callModelStream('AI_COACH')` — unchanged (external config) |
| API routes | `/api/coach/*` | Stable client contract — unchanged |
| DB tables | `coach_conversations`, `user_intel_notes`, `coach_system_notes` | Schema-level — unchanged |

---

## 1. Architecture Overview

The Rideshare Coach is a conversational assistant powered by Gemini 3.1 Pro Preview with streaming, Google Search, vision/OCR, and 11 action tag types for database writes. It operates through a context-injection model: every chat request loads the driver's full situation (location, strategy, briefing, venues, history, notes, market intel) and injects it as a system prompt.

### Data Flow

```
User message → requireAuth → snapshot resolution →
  rideshare-coach-dal.js loads 11 data sources in parallel →
  formatContextForPrompt() builds ~1200-line system prompt →
  callModelStream('AI_COACH') → SSE streaming to client →
  action tag parsing + Zod validation + DB writes →
  done event with conversation_id + action results
```

### Key Model Role

- **Role:** `AI_COACH` (model-registry.js)
- **Model:** Gemini 3.1 Pro Preview
- **Capabilities:** Streaming, Google Search tool, vision/OCR, 1M token context

---

## 2. Components

### Frontend: `client/src/components/RideshareCoach.tsx` (~885 lines)

- Streaming message display with delta chunk appending
- Attachment support (file picker → base64 → sent to chat API)
- Notes panel (slide-out right panel with pin, delete, edit, optimistic UI)
- Voice integration: mic input via `useSpeechRecognition`, TTS output via `useTTS`
- Voice toggle persisted to localStorage (`COACH_VOICE_ENABLED`)
- Client-side `handleEventDeactivation()` regex fallback (duplicates server-side parsing — see Known Issues)
- Validation error banner for action parsing failures

### Server: `server/api/chat/chat.js` (1,572 lines)

- `POST /api/chat` — main streaming chat endpoint
- System prompt construction (~1200 lines of injected context)
- Action tag parsing (JSON envelope + legacy inline formats)
- Conversation persistence to `coach_conversations` table
- SSE protocol with `done` event carrying `actions_result`
- `POST /api/chat/deactivate-event` — manual event deactivation

### Server: `server/lib/ai/rideshare-coach-dal.js` (2,575 lines)

Data access layer loading 11 parallel context sources:
1. Header snapshot (location, weather, air, timezone, holiday)
2. Latest strategy (consolidated + immediate)
3. Comprehensive briefing (events, traffic, news, weather API, airport, closures)
4. Smart Blocks (top 6 venue recommendations)
5. Feedback (venue + strategy votes)
6. Venue data (catalog entries)
7. Actions (session dwell times)
8. Market intelligence (market position, knowledge base)
9. User notes (coach's saved observations)
10. Driver profile (identity, vehicle, preferences, eligibility)
11. Offer history (Siri ride offer analysis log)

### Server: `server/api/rideshare-coach/` (4 files, 1,153 lines)

| File | Lines | Purpose |
|------|-------|---------|
| `validate.js` | 423 | Zod schemas for all 11 action tag types |
| `notes.js` | 448 | Notes CRUD: list, get, create, update, delete, pin, restore, stats |
| `schema.js` | 261 | Schema metadata exposure for coach context |
| `index.js` | 21 | Route mount |

---

## 3. Action Tag System

| Tag | DB Table | Purpose |
|-----|----------|---------|
| `SAVE_NOTE` | `user_intel_notes` | Save observation about driver |
| `DEACTIVATE_EVENT` | `discovered_events` | Mark event as cancelled/ended |
| `REACTIVATE_EVENT` | `discovered_events` | Un-cancel event |
| `ADD_EVENT` | `discovered_events` | Add driver-reported event |
| `UPDATE_EVENT` | `discovered_events` | Update event details |
| `DEACTIVATE_NEWS` | `news_deactivations` | Hide news item for user |
| `SYSTEM_NOTE` | `coach_system_notes` | Developer feedback from coach |
| `ZONE_INTEL` | `zone_intelligence` | Crowd-sourced zone knowledge |
| `MARKET_INTEL` | `market_intelligence` | Market-specific patterns |
| `SAVE_VENUE_INTEL` | `venue_catalog` | Staging spots, GPS dead zones |
| `COACH_MEMO` | `docs/coach-inbox.md` | Memo to Claude Code (filesystem) |

**Parsing:** JSON envelope (preferred) or legacy inline `[TAG: {...}]` format.
**Validation:** Zod schemas in `validate.js` before any DB write.
**Execution:** After stream completes, parsed actions are validated and executed. Results reported in SSE `done` event.

---

## 4. Voice Integration Status

**Status:** Implemented (2026-04-13). Uses proven hooks from Translation feature.

| Component | Implementation | Status |
|-----------|---------------|--------|
| Speech-to-text (STT) | `useSpeechRecognition` hook (browser Web Speech API, free) | Working |
| Text-to-speech (TTS) | `useTTS` hook → `POST /api/tts` → OpenAI TTS-1-HD | Working |
| Voice toggle | `voiceEnabled` state, persisted to localStorage | Working |
| Mic button | Green/red toggle with pulse animation during recording | Working |
| Auto-speak | TTS fires after streaming completes (action tags stripped) | Working |

**Dead code:** `_startVoiceChat()` and related functions (~180 lines) use the OpenAI Realtime API WebSocket approach. These are prefixed with `_` and never called. The hook-based approach was chosen for lower cost, proven reliability, and zero new dependencies.

**Architecture decision:** Hooks reuse > OpenAI Realtime API. STT is free (browser), TTS is ~$0.015/1K chars vs ~$0.06/min for Realtime. See AI_COACH_VOICE_PLAN.md §8 for full comparison.

---

## 5. Coach Personality

- Warm, friendly, conversational — like a supportive expert friend
- Match user energy: quick answers for quick questions, thorough for planning
- Precise with venue data (exact names, addresses, times)
- Rideshare domain expertise: Gravity Model, deadhead risk, Ant vs Sniper modes, platform algorithms
- Memory: saves notes via `[SAVE_NOTE]`, references them naturally across sessions
- Super User Enhancement: elevated context for `melodydashora@gmail.com`

---

## 6. Known Issues

| # | Issue | Severity | Source |
|---|-------|----------|--------|
| ~~1~~ | ~~Client `handleEventDeactivation()` duplicates server-side parsing~~ | ~~Medium~~ | RESOLVED — removed in Part 3 |
| ~~9~~ | ~~`validateEvent.js` import path wrong in rideshare-coach-dal.js~~ | ~~Critical~~ | RESOLVED — `../../events/` → `../events/` (latent since Pass 1 Issue B, exposed by rename) |
| 2 | No context size estimation — all data injected unconditionally | Medium | AI_RIDESHARE_COACH.md |
| 3 | No conversation summarization — thread history grows unbounded | Medium | AI_RIDESHARE_COACH.md |
| 4 | Action tag extraction is regex-based, can break on malformed JSON | Low | AI_RIDESHARE_COACH.md |
| 5 | No per-user chat rate limit (global only) | Low | AI_RIDESHARE_COACH.md |
| 6 | ~180 lines of dead OpenAI Realtime API code in RideshareCoach.tsx | Low | Voice plan |
| COACH-H7 | No streaming fallback — Gemini outage kills coach entirely | High | DOC_DISCREPANCIES.md |
| COACH-H8 | Conversation saves are fire-and-forget with swallowed errors | High | DOC_DISCREPANCIES.md |

---

## 7. TODO — Hardening Work

- [ ] Remove client-side `handleEventDeactivation()` duplicate (server handles it)
- [ ] Add context size estimation — truncate least-important sections if over budget
- [ ] Conversation summarization — compress old messages into summaries
- [ ] Per-user chat rate limit — 30 messages/hour
- [ ] Remove dead OpenAI Realtime API code (~180 lines)
- [ ] Add streaming fallback for Gemini outages (COACH-H7)
- [ ] Fix fire-and-forget conversation saves (COACH-H8)
- [ ] Unify voice and text on same model (Gemini Live when available)

---

## 8. Coach Inbox Items

The Rideshare Coach writes memos to `docs/coach-inbox.md` via `[COACH_MEMO]` action tags. Key pending items as of 2026-04-14:

- Zombie Snapshot & Auth Boundary Fix (high)
- Briefing pipeline mocked news data (high)
- AI-Gatekeeper Architecture proposal
- Translation API debugging
- Live Context Payload for Chat (bypass snapshot)
- Market Exit Warning ("Code 6")
- PredictHQ Event Integration

See `docs/coach-inbox.md` for the full queue with details.

---

## Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `client/src/components/RideshareCoach.tsx` | 885 | React chat component + voice |
| `server/api/chat/chat.js` | 1,572 | Chat endpoint, streaming, action parsing |
| `server/lib/ai/rideshare-coach-dal.js` | 2,575 | Data access layer (11 sources) |
| `server/api/rideshare-coach/validate.js` | 423 | Zod validation for all action types |
| `server/api/rideshare-coach/notes.js` | 448 | Notes CRUD API |
| `server/api/rideshare-coach/schema.js` | 261 | Schema metadata for coach context |
| `docs/coach-inbox.md` | ~120 | Coach → Claude Code memo queue |
