# AI_RIDESHARE_COACH.md — AI Coach System End-to-End

> **Canonical reference** for the AI Coach chat system: context injection, prompt construction, streaming, action tags, and coaching personality.
> Last updated: 2026-04-10

## Supersedes
- `docs/architecture/ai-coach.md` — Previous coach architecture doc (merged and expanded here)

---

## Table of Contents

1. [Chat API Endpoint](#1-chat-api-endpoint)
2. [Context Injection (Coach DAL)](#2-context-injection-coach-dal)
3. [System Prompt Construction](#3-system-prompt-construction)
4. [Coach Personality and Tone](#4-coach-personality-and-tone)
5. [Streaming Response Implementation](#5-streaming-response-implementation)
6. [Action Tags: Parse and Execute](#6-action-tags-parse-and-execute)
7. [Message History and Persistence](#7-message-history-and-persistence)
8. [Coach Notes System](#8-coach-notes-system)
9. [Real-Time Data vs Cached Snapshot](#9-real-time-data-vs-cached-snapshot)
10. [Client-Side Coach Component](#10-client-side-coach-component)
11. [Current State](#11-current-state)
12. [Known Gaps](#12-known-gaps)
13. [TODO — Hardening Work](#13-todo--hardening-work)

---

## 1. Chat API Endpoint

**Route:** `POST /api/chat`
**File:** `server/api/chat/chat.js` (1,572 lines)
**Auth:** `requireAuth`
**Model:** `AI_COACH` → Gemini 3.1 Pro Preview (streaming, Google Search, vision, OCR)

### Request

```json
{
  "userId": "uuid",
  "message": "Where should I position for the concert tonight?",
  "threadHistory": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}],
  "snapshotId": "uuid",
  "attachments": [{"name": "heatmap.png", "type": "image/png", "data": "base64..."}],
  "snapshot": {"timezone": "America/Chicago", "city": "Frisco", "state": "TX", "hour": 20},
  "conversationId": "uuid"
}
```

### Flow

```
1. requireAuth → validates JWT, attaches req.auth.userId
2. Timezone validation (required, returns 400 if missing)
3. Snapshot resolution: snapshotId → strategyId fallback → latest snapshot for user
4. SECURITY (F-6): Uses authUserId from JWT, not req.body.userId
5. Load context: coachDAL.getCompleteContext(snapshotId, null, authUserId)
6. Format context: coachDAL.formatContextForPrompt(fullContext)
7. Load extras: snapshot history (10), zone intelligence, session enrichment
8. Save user message to coach_conversations (non-blocking)
9. Build system prompt (~1200 lines of context)
10. callModelStream('AI_COACH', { system, messageHistory })
11. Stream response chunks via SSE to client
12. Parse action tags from complete response
13. Execute actions (DB writes)
14. Save assistant response to coach_conversations
15. Send done event with { conversation_id, actions_result }
```

---

## 2. Context Injection (Coach DAL)

**File:** `server/lib/ai/coach-dal.js` (2,572 lines)

### getCompleteContext(snapshotId, strategyId, authUserId)

**Parallel Batch 1** (7 queries):
- `getHeaderSnapshot()` → location, weather, air, timezone, holiday
- `getLatestStrategy()` → consolidated + immediate strategy, status
- `getComprehensiveBriefing()` → events, traffic, news, weather API, airport, closures
- `getSmartBlocks()` → top 6 venue recommendations with enrichment
- `getFeedback()` → venue + strategy feedback
- `getVenueData()` → venue catalog entries
- `getActions()` → session actions (dwell times)

**Conditional Batch 2** (depends on snapshot existing):
- `getMarketIntelligence(city, state)` → market position, knowledge base
- `getUserNotes(userId, 20)` → coach's saved notes about this driver
- `getDriverProfile(userId)` → name, vehicle, platforms, eligibility, preferences
- `getOfferHistory(20)` → Siri ride offer analysis log

### formatContextForPrompt(context)

Converts all data into AI-readable markdown sections:

1. **DRIVER PROFILE:** Name, email, home, platforms, eligibility tiers, vehicle attributes
2. **VEHICLE INFO:** Year, make, model, color, capacity
3. **CURRENT LOCATION & TIME:** Address, coords, day, hour, timezone, weather, AQI
4. **STRATEGY:** Consolidated (8-12hr) + Immediate (1hr)
5. **COMPREHENSIVE BRIEFING:** Traffic, weather, news, events
6. **SMART BLOCKS:** Top 6 venues with distance, drive time, value grade, event badges
7. **FEEDBACK:** Community venue & strategy votes
8. **DRIVER ACTIONS:** Session activity, dwell times
9. **MARKET INTELLIGENCE:** Market position, knowledge base by type
10. **USER NOTES (Coach Memory):** Last 20 notes with type icons, pin status
11. **OFFER ANALYSIS LOG:** Accept rate, $/mile, response time stats
12. **SNAPSHOT HISTORY:** Recent 5 sessions with dates, cities

---

## 3. System Prompt Construction

**File:** `chat.js` (lines 1161–1351)

### Structure

1. **Identity:** "You are the AI Coach — powered by Gemini 3 Pro Preview" (NOT Claude, NOT GPT)
2. **Capabilities:** Vision, OCR, Google Search, rideshare strategy, market intel, personal notes, general knowledge
3. **Action Tags:** Full syntax docs for all 11 tag types
4. **Data Access Summary:** Counts of venues, events, notes, sessions available
5. **Communication Style:** Warm, match energy, emojis, precise with data
6. **Critical Rules:** No hallucination, full schema read access, write via action tags only
7. **Super User Enhancement:** Elevated context for `melodydashora@gmail.com` (Melody)

---

## 4. Coach Personality and Tone

### Core Personality

- Warm, friendly, conversational — like a supportive expert friend
- Match the user's energy: quick answers for quick questions, thorough for planning
- Emojis used naturally (not forced)
- Precise with venue data (exact names, addresses, times)
- References market intelligence naturally

### Rideshare Domain Expertise

- Gravity Model knowledge (Core/Satellite/Rural markets)
- Deadhead risk calculation
- Ant (cruise activity) vs Sniper (hunt surges) strategy modes
- Platform algorithm mechanics (Upfront Pricing, Area Preferences, Heatmaps)
- Market-specific insights and zone intelligence
- Timing window optimization by daypart

### Memory and Personalization

- Saves notes via `[SAVE_NOTE]` action tags
- References saved notes naturally ("Since you mentioned last time...")
- Learns driver preferences over sessions
- Cross-session continuity via snapshot history

---

## 5. Streaming Response Implementation

### Protocol: Server-Sent Events (SSE)

**Headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

### Server → Client Chunks

```
data: {"delta": "Based on the concert at Toyota Music Factory..."}

data: {"delta": " I recommend positioning at..."}

data: {"done": true, "conversation_id": "uuid", "actions_result": {"saved": 2, "errors": []}}
```

### Server Implementation (chat.js lines 1385–1430)

```javascript
const response = await callModelStream('AI_COACH', { system, messageHistory });
const reader = response.body.getReader();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  // Parse Gemini SSE chunks → extract text → write to client
  res.write(`data: ${JSON.stringify({ delta: text })}\n\n`);
}
```

### Safety Block Detection

If Gemini returns `finishReason === 'SAFETY'`, the response is blocked. The server logs the safety block and sends an appropriate message to the client.

---

## 6. Action Tags: Parse and Execute

### Supported Actions

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

### Parsing (chat.js lines 27–173)

Two formats supported:

**JSON envelope (preferred):**
```json
```json
{"actions": [{"type": "SAVE_NOTE", "data": {...}}], "response": "clean text"}
```
```

**Legacy inline:**
```
[SAVE_NOTE: {"note_type": "preference", "title": "...", "content": "..."}]
```

### Validation

Each action validated via Zod schemas in `server/api/coach/validate.js` (428 lines) before DB write. On validation failure, the action is skipped and the error is reported in `actions_result.errors`.

### Execution Safety

- **Null-return check (C-2 fix):** If DAL returns null (DB write failed), the error is logged and counted
- **Non-blocking:** Action execution is awaited but doesn't block the SSE response (actions parsed after stream completes)

---

## 7. Message History and Persistence

### Storage: `coach_conversations` Table

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | Message ID |
| `user_id` | UUID FK | Owner |
| `snapshot_id` | UUID FK (nullable) | Location context |
| `conversation_id` | UUID | Thread grouping |
| `parent_message_id` | UUID | Threading (user→assistant) |
| `role` | text | 'user' / 'assistant' |
| `content` | text | Message body |
| `content_type` | text | 'text' / 'text+attachment' / 'image' / 'audio' |
| `model_used` | text | e.g., 'gemini-3.1-pro-preview' |
| `market_slug` | text | For cross-driver learning |
| `location_context` | json | {city, state, country} |
| `time_context` | json | {local_time, daypart} |

### Context Window Management

- **Thread history** passed from client on each request (client manages conversation state)
- **Snapshot history:** Last 10 sessions loaded for cross-session pattern analysis
- **No explicit token counting** — relies on model's context window (Gemini 3.1 Pro: 1M tokens)

---

## 8. Coach Notes System

**File:** `server/api/coach/notes.js` (449 lines)

### Endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/coach/notes` | List notes (sort: recent/importance/pinned) |
| GET | `/api/coach/notes/:id` | Get single note |
| POST | `/api/coach/notes` | Create note manually |
| PUT | `/api/coach/notes/:id` | Update note |
| DELETE | `/api/coach/notes/:id` | Soft delete (is_active = false) |
| POST | `/api/coach/notes/:id/pin` | Toggle pin status |
| POST | `/api/coach/notes/:id/restore` | Restore soft-deleted note |
| GET | `/api/coach/notes/stats/summary` | Aggregated statistics |

### Note Types

`preference`, `insight`, `tip`, `feedback`, `pattern`, `market_update`

### Note Categories

`timing`, `location`, `strategy`, `vehicle`, `earnings`, `safety`

---

## 9. Real-Time Data vs Cached Snapshot

| Data Source | Type | Freshness |
|-------------|------|-----------|
| Briefing weather (API) | Real-time | Current at briefing generation |
| Briefing traffic | Real-time | Current at briefing generation |
| Briefing news | Real-time | Today's articles |
| Briefing events | Real-time | Today's events |
| Google Search (Gemini tool) | Live | Coach can search in real-time |
| Snapshot location | Cached | At GPS fix time |
| Snapshot weather | Cached | At snapshot creation |
| Strategy | Cached | At generation time |
| Venues/SmartBlocks | Cached | At generation time |
| Driver profile | Fresh | Fetched each request |
| Market intelligence | Fresh | Fetched each request |
| User notes | Fresh | Fetched each request |

---

## 10. Client-Side Coach Component

**File:** `client/src/components/AICoach.tsx` (945 lines)

### Features

- **Streaming message display:** Appends delta chunks to last assistant message
- **Attachment support:** File picker → base64 data URL → sent as attachment
- **Notes panel:** Slide-out right panel with pin, delete, edit
- **Optimistic UI:** Notes updated immediately, rolled back on error
- **Voice chat:** OpenAI Realtime API integration (ephemeral token, MediaRecorder)
- **Validation error banner:** Shows action parsing errors, clears after 8 seconds

---

## 11. Current State

| Area | Status |
|------|--------|
| Chat streaming (Gemini 3.1 Pro) | Working |
| Context injection (11 data sources) | Working |
| Action tags (11 types) | Working |
| Zod validation on all actions | Working |
| Notes CRUD with pin/restore | Working |
| Coach memory (cross-session notes) | Working |
| Google Search in coach | Working |
| Vision/OCR (screenshot analysis) | Working |
| Zone intelligence writing | Working |
| Market intelligence writing | Working |

---

## 12. Known Gaps

1. **No context size estimation** — All data injected unconditionally. For power users with 100+ notes and extensive history, context could approach model limits.
2. **No conversation summarization** — Long conversations aren't compressed. Thread history grows unbounded within a session.
3. **No coach response quality metrics** — No automated scoring of coach advice quality.
4. **Action tag extraction is regex-based** — Can break on malformed JSON from the LLM.
5. **No rate limiting per user on chat** — Global rate limit only. A user could spam the coach endpoint.
6. **Voice chat via OpenAI (separate from Gemini)** — Two different AI providers for text vs voice creates inconsistent experience.

---

## 13. TODO — Hardening Work

- [ ] **Add context size estimation** — Count tokens before LLM call, truncate least-important sections if over budget
- [ ] **Conversation summarization** — Compress old messages into summaries to stay within context window
- [ ] **Per-user chat rate limit** — 30 messages/hour per user
- [ ] **Coach response quality scoring** — Heuristic: does response reference real data? Is it actionable?
- [ ] **Unify voice and text on same model** — Use Gemini Live for voice to maintain context consistency
- [ ] **Add conversation export** — Let drivers download chat history as PDF/text
- [ ] **Coach proactive alerts** — Push notifications when conditions change significantly

---

## Key Files

| File | Purpose |
|------|---------|
| `server/api/chat/chat.js` | Main chat endpoint (1,572 lines) |
| `server/lib/ai/coach-dal.js` | Data access layer (2,572 lines) |
| `server/api/coach/validate.js` | Zod validation schemas (428 lines) |
| `server/api/coach/notes.js` | Notes CRUD endpoints (449 lines) |
| `server/api/chat/chat-context.js` | Read-only strategy context (92 lines) |
| `client/src/components/AICoach.tsx` | React chat component (945 lines) |
