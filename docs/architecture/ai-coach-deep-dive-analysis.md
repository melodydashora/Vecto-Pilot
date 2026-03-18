# AI Coach System: Comprehensive Deep-Dive Analysis

**Generated:** 2026-03-18
**Branch:** `claude/analyze-briefings-workflow-Ylu9Q`
**Scope:** Complete analysis of the AI Coach — service layer, data access, action pipeline, system prompt, API endpoints, client integration, and database schema.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Core Service: chat.js](#2-core-service-chatjs)
3. [Data Access Layer: coach-dal.js](#3-data-access-layer-coach-daljs)
4. [System Prompt Architecture](#4-system-prompt-architecture)
5. [Action Tag Pipeline](#5-action-tag-pipeline)
6. [Action Types (9 Total)](#6-action-types-9-total)
7. [Validation Layer](#7-validation-layer)
8. [Super User (Admin) Enhancement](#8-super-user-admin-enhancement)
9. [Model Configuration](#9-model-configuration)
10. [REST API Endpoints](#10-rest-api-endpoints)
11. [Database Schema](#11-database-schema)
12. [Client Integration](#12-client-integration)
13. [SSE Streaming Architecture](#13-sse-streaming-architecture)
14. [Conversation Persistence](#14-conversation-persistence)
15. [Notes CRUD System](#15-notes-crud-system)
16. [Schema Metadata Endpoints](#16-schema-metadata-endpoints)
17. [Error Handling Patterns](#17-error-handling-patterns)
18. [File Inventory](#18-file-inventory)

---

## 1. System Overview

The AI Coach is a conversational AI assistant powered by Gemini 3 Pro Preview with Google Search grounding. It provides rideshare strategy coaching, persistent memory, crowd-sourced intelligence, and full system observability. For the admin user (Melody), it gains elevated "Agent + Eidolon" capabilities with unrestricted system access.

### High-Level Data Flow

```
User sends message via AICoach.tsx
         │
         ▼
POST /api/chat  (SSE streaming endpoint)
         │
    ┌────┴────┐
    │  AUTH   │  requireAuth → extract userId
    └────┬────┘
         │
    ┌────┴────────┐
    │SUPER USER?  │  Check driver_profiles.email === 'melodydashora@gmail.com'
    └────┬────────┘
         │
    ┌────┴──────────────────────────────────────────┐
    │           CONTEXT ASSEMBLY (CoachDAL)          │
    │                                                │
    │  getCompleteContext(strategyId, userId)         │
    │    → snapshot, strategy, briefing, smartBlocks  │
    │    → marketIntelligence, zoneIntelligence       │
    │    → driverProfile, driverVehicle               │
    │    → userNotes, sessionHistory, offerHistory    │
    │    → conversationHistory                        │
    └────┬──────────────────────────────────────────┘
         │
         ▼
    Build System Prompt (base + super-user extension)
         │
         ▼
    callModelStream('AI_COACH', { system, messages, attachments })
         │
         ▼
    Stream response via SSE → Client renders in real-time
         │
         ▼
    After stream completes:
    ├── parseActions(fullResponseText) → extract action tags
    ├── executeActions(actions) → fire-and-forget DB writes
    ├── saveConversationMessage() → coach_conversations
    └── extractAndSaveTips() → extract tips from response
```

### Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Inline action tags | No function calling API — actions embedded in response text, parsed server-side |
| Fire-and-forget execution | Actions execute asynchronously after SSE stream ends — non-blocking |
| Per-user memory | Notes (user_intel_notes) + conversations (coach_conversations) provide cross-session continuity |
| Crowd-sourced learning | Zone intelligence shared across all drivers in a market |
| Super-user elevation | Admin gets full system access — shell, DB, file system, MCP tools |
| Gemini-only streaming | Model is Gemini 3 Pro Preview; no provider fallback for streaming |
| Context injection | Full DB state injected into system prompt (not tool calls) |

---

## 2. Core Service: chat.js

**File:** `server/api/chat/chat.js` (~1,448 lines)
**Role:** Main chat endpoint, system prompt construction, action parsing/execution, streaming handler.

### 2.1 Imports & Dependencies

| Import | Purpose |
|--------|---------|
| `CoachDAL` | Database access layer for all read/write operations |
| `callModelStream` | Gemini streaming adapter |
| `validateAction` | Zod-based action validation |
| `driver_profiles` | Super-user email lookup |
| `db` | Drizzle ORM client |
| `appendFile` | Coach memo file writing |
| `path`, `fileURLToPath` | Coach inbox path resolution |

### 2.2 Function Inventory

| Function | Lines | Purpose |
|----------|-------|---------|
| `parseActions(responseText)` | 33-116 | Extract action tags from AI response (JSON envelope + legacy regex) |
| `extractBalancedJson(str, startIndex)` | 122-171 | Character-by-character balanced brace JSON extraction |
| `executeActions(actions, userId, snapshotId, conversationId)` | 176-440 | Execute all parsed actions against DAL (fire-and-forget) |
| `getEnhancedProjectContext()` | ~490-520 | Load project context for super-user prompt |
| Main `POST /api/chat` handler | 526-1250 | Full streaming chat handler |

---

## 3. Data Access Layer: coach-dal.js

**File:** `server/lib/ai/coach-dal.js` (~2,572 lines)
**Role:** All database read/write operations for the coach.

### 3.1 Read Methods

| Method | Returns | Purpose |
|--------|---------|---------|
| `getCompleteContext(strategyId, userId)` | Full context object | Main entry point — assembles all data for prompt |
| `formatContextForPrompt(context)` | Formatted text | Converts context to AI-readable text |
| `getHeaderSnapshot(snapshotId)` | Snapshot + display info | Location, time, weather, air quality |
| `getLatestStrategy(snapshotId)` | Strategy object | Current AI strategy for session |
| `getComprehensiveBriefing(snapshotId)` | Briefing object | Events, traffic, news, schools, weather |
| `getMarketIntelligence(marketSlug)` | Intel + position | Research-backed market insights |
| `getUserNotes(userId, limit)` | Notes array | Coach's saved notes about driver |
| `getDriverProfile(userId)` | Profile object | Name, home location, platforms |
| `getDriverVehicle(userId)` | Vehicle object | Make, model, year, type |
| `getConversationHistory(userId, convId)` | Messages array | Chat history for context |
| `getConversations(userId)` | Conversations list | All conversations |
| `getOfferHistory(userId)` | Offers array | Siri Shortcut offer analysis |
| `getSnapshotHistory(userId, limit)` | Snapshots array | Recent driving sessions (last 10) |
| `getSystemNotes(status, limit)` | System notes array | Admin review of AI observations |
| `getZoneIntelligence(marketSlug)` | Zones array | Crowd-sourced zone knowledge |

### 3.2 Write Methods

| Method | Target Table | Purpose |
|--------|-------------|---------|
| `saveUserNote(noteData)` | `user_intel_notes` | Save driver preferences/insights |
| `saveSystemNote(noteData)` | `coach_system_notes` | Log system observations (deduped by title+category) |
| `saveZoneIntelligence(data)` | `zone_intelligence` | Crowd-sourced zone knowledge |
| `saveMarketIntelligence(data)` | `market_intelligence` | Market-specific insights |
| `saveVenueCatalogEntry(data)` | `venue_catalog` | Driver-reported venue intel (staging, hours) |
| `addVenueStagingNotes(venueId, notes)` | `venue_catalog` | Append staging tips (JSONB merge) |
| `saveConversationMessage(data)` | `coach_conversations` | Persist user/assistant messages |
| `deactivateEvent(data)` | `discovered_events` | Soft-deactivate event + pg_notify |
| `reactivateEvent(data)` | `discovered_events` | Restore deactivated event + pg_notify |
| `addEvent(data)` | `discovered_events` | Create new event from driver intel |
| `updateEvent(data)` | `discovered_events` | Modify event details |
| `deactivateNews(data)` | `news_deactivations` | Hide news from user |
| `extractAndSaveTips(userId, text, ctx)` | `user_intel_notes` | Auto-extract tips from response |

---

## 4. System Prompt Architecture

### 4.1 Base Prompt (~190 lines, injected for all users)

**Sections:**
1. **Identity:** "You are the AI Coach — powered by Gemini 3 Pro Preview" (explicitly NOT Claude/GPT)
2. **Vision & OCR:** Analyze screenshots, read text from images, interpret maps
3. **Rideshare Strategy:** Venue recommendations, earnings optimization, pattern analysis
4. **Market Intelligence:** Gravity Model theory, deadhead risk, algorithm mechanics
5. **Personal Notes/Memory:** SAVE_NOTE action tag format
6. **Web Search:** Google Search with live data verification
7. **General Knowledge:** Beyond rideshare — life help, research, any topic
8. **Personal Support:** Conversational, motivational
9. **Current Context:** Driver profile, location, weather, venues, strategy, events, traffic, news, notes count, session history
10. **Communication Style:** Warm, friendly, emoji-natural, precise with venue data
11. **Action Tags:** All 9 action types with format examples
12. **Table Access Declaration:** Readable tables + writable tables with action mapping

### 4.2 Context Injection (dynamic per request)

| Data | Source |
|------|--------|
| User local date/time | Snapshot timezone |
| Driver name, vehicle | driver_profiles, driver_vehicles |
| Current location, weather | Snapshot |
| Ranked venues | Smart Blocks (ranking_candidates) |
| Current strategy | strategies table |
| Events/traffic/news | briefings table |
| Market intelligence count | market_intelligence |
| Saved notes count | user_intel_notes |
| Session history | Recent snapshots |
| Market position | Core/Satellite/Rural |

### 4.3 Identity Enforcement

The prompt contains **3 separate identity reminders** that the AI is Gemini 3 Pro Preview:
1. Opening identity statement
2. End of base prompt (CRITICAL IDENTITY REMINDER)
3. End of super-user section (repeated)

---

## 5. Action Tag Pipeline

### 5.1 End-to-End Flow

```
AI generates response with embedded action tags
    │
    ▼
Stream completes → fullResponseText accumulated
    │
    ▼
parseActions(fullResponseText)
    │
    ├── Try JSON envelope: ```json {"actions": [...], "response": "..."} ```
    │   If found → parse all actions from array, return early
    │
    └── Fallback: regex for each of 9 prefixes: [PREFIX: {...}]
        └── extractBalancedJson() for each match
    │
    ▼
{ actions: { notes[], events[], systemNotes[], ... }, cleanedText }
    │
    ▼
executeActions(actions, userId, snapshotId, conversationId)
    │  (fire-and-forget — .then()/.catch(), no await)
    │
    ├── For each action type:
    │   ├── Validate via Zod (some types skip validation)
    │   ├── Call CoachDAL write method
    │   └── Push to results.saved or results.errors
    │
    └── Server-side console.log only — no client feedback
```

### 5.2 Parsing Formats

**Preferred: JSON Envelope**
```json
```json
{
  "actions": [
    {"type": "SYSTEM_NOTE", "data": {"type": "pain_point", ...}},
    {"type": "SAVE_NOTE", "data": {"type": "insight", ...}}
  ],
  "response": "Clean text shown to user"
}
```
```

**Legacy: Inline Tags**
```
I've noted that for you! [SAVE_NOTE: {"type": "preference", "title": "Prefers airport runs", "content": "Driver prefers DFW airport pickups over downtown"}]
```

---

## 6. Action Types (9 Total)

| Action Type | Target Table | Validates? | Purpose |
|-------------|-------------|------------|---------|
| `SAVE_NOTE` | `user_intel_notes` | Yes | Save driver preferences, insights, tips |
| `DEACTIVATE_EVENT` | `discovered_events` | Yes | Mark event as ended/cancelled/incorrect |
| `REACTIVATE_EVENT` | `discovered_events` | No | Restore mistakenly deactivated event |
| `ADD_EVENT` | `discovered_events` | Yes | Create new event from driver intel |
| `UPDATE_EVENT` | `discovered_events` | Yes | Correct event details from driver feedback |
| `DEACTIVATE_NEWS` | `news_deactivations` | No | Hide irrelevant news from user |
| `SYSTEM_NOTE` | `coach_system_notes` | No | Log feature requests, pain points, bugs |
| `ZONE_INTEL` | `zone_intelligence` | Yes | Capture dead zones, honey holes, staging spots |
| `COACH_MEMO` | `docs/coach-inbox.md` | Yes | Write ideas/memories for Claude Code to pick up |

---

## 7. Validation Layer

**File:** `server/api/coach/validate.js`

### 7.1 Zod Schemas

| Schema | Key Fields | Constraints |
|--------|-----------|-------------|
| `noteSchema` | type, category, title, content, importance | title max 200 chars, content max 5000 chars, importance 1-100 |
| `addEventSchema` | title, venue_name, event_start_date, category | date YYYY-MM-DD, category enum |
| `updateEventSchema` | event_title (required), optional fields | All fields optional except event_title |
| `eventDeactivationSchema` | event_title, reason | reason enum (event_ended, incorrect_time, etc.) |
| `eventReactivationSchema` | event_title, reason | Both required |
| `newsDeactivationSchema` | news_title, reason | Both required |
| `systemNoteSchema` | type, category, title, description | type enum, category enum |
| `zoneIntelSchema` | zone_type, zone_name, market_slug, reason | zone_type enum |
| `coachMemoSchema` | type, title, detail, priority | priority enum (high/medium/low) |

### 7.2 Validation Endpoint

`POST /api/coach/validate` — validates action payloads before execution.
`GET /api/coach/validate/schemas` — returns schema documentation.
`POST /api/coach/validate/batch` — batch validation.

---

## 8. Super User (Admin) Enhancement

### 8.1 Detection

```javascript
const [profile] = await db.select({ email: driver_profiles.email })
  .from(driver_profiles)
  .where(eq(driver_profiles.user_id, authUserId))
  .limit(1);

if (profile?.email === 'melodydashora@gmail.com') {
  isSuperUser = true;
}
```

**Hardcoded email check** — `melodydashora@gmail.com` is the only super user.

### 8.2 Additional Capabilities (appended to system prompt)

| Capability | Description |
|------------|-------------|
| Shell execution | Unrestricted bash commands |
| File system | Full read/write/create/delete/rename access |
| Database DBA | SELECT, INSERT, UPDATE, DELETE, DDL on all tables |
| Network/API | HTTP fetch, WebSocket, API integration |
| MCP tools | Web search, fetch, code execution, memory ops |
| Memory | Agent memory with 730-day TTL |
| Self-healing | Circuit breaker, error prediction |
| Code access | Full transparency into codebase and architecture |
| Coach Memo | `[COACH_MEMO: {...}]` writes to `docs/coach-inbox.md` |

### 8.3 Enhanced Context Injection

The super-user prompt injects:
- Full project context (via `getEnhancedProjectContext()`)
- Table listing with write access declaration
- Explicit statement: "No restrictions. Full transparency. Maximum capability."

---

## 9. Model Configuration

**From `server/lib/ai/model-registry.js`:**

```
AI_COACH: {
  envKey: 'AI_COACH_MODEL',
  default: 'gemini-3-pro-preview',
  purpose: 'AI Coach conversation (streaming, multimodal)',
  maxTokens: 8192,
  temperature: 0.7,
  features: ['google_search', 'vision', 'ocr'],
  requiresStreaming: true
}
```

**Override:** `AI_COACH_OVERRIDE_MODEL` env var for testing.
**Streaming:** Required — uses `callModelStream()` → `callGeminiStream()`.
**No fallback provider** — Gemini-only for streaming.

---

## 10. REST API Endpoints

### 10.1 Chat Endpoints (`server/api/chat/chat.js`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/chat` | requireAuth | Main streaming chat (SSE) |
| POST | `/api/chat/notes` | requireAuth | Save a coach note |
| GET | `/api/chat/notes` | requireAuth | List user notes |
| GET | `/api/chat/system-notes` | requireAuth | Get system notes (admin) |

### 10.2 Coach Endpoints (`server/api/coach/`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/coach/schema` | requireAuth | Full schema metadata |
| GET | `/api/coach/schema/tables` | requireAuth | Compact table list |
| GET | `/api/coach/schema/prompt` | requireAuth | Schema formatted for prompt |
| POST | `/api/coach/validate` | requireAuth | Validate action payload |
| GET | `/api/coach/validate/schemas` | requireAuth | Schema documentation |
| POST | `/api/coach/validate/batch` | requireAuth | Batch validation |
| GET | `/api/coach/notes` | requireAuth | List notes (paginated) |
| GET | `/api/coach/notes/:id` | requireAuth | Get single note |
| POST | `/api/coach/notes` | requireAuth | Create note |
| PUT | `/api/coach/notes/:id` | requireAuth | Update note |
| DELETE | `/api/coach/notes/:id` | requireAuth | Soft delete note |
| POST | `/api/coach/notes/:id/pin` | requireAuth | Pin/unpin note |
| POST | `/api/coach/notes/:id/restore` | requireAuth | Restore deleted note |
| GET | `/api/coach/notes/stats/summary` | requireAuth | Note statistics |

---

## 11. Database Schema

### 11.1 Readable Tables (12)

| Table | Key Columns | Purpose |
|-------|------------|---------|
| `snapshots` | user_id, city, state, lat, lng, timezone, dow, hour | Location sessions |
| `strategies` | snapshot_id, consolidated_strategy, strategy_for_now | AI strategy |
| `briefings` | snapshot_id, events, traffic, news, weather | Briefing data |
| `discovered_events` | title, venue_name, event_start_date, category, is_active | Events |
| `venue_catalog` | venue_name, city, expense_rank, business_hours | Venues |
| `ranking_candidates` | snapshot_id, venue_name, rank, features, distance_mi | Smart Blocks |
| `market_intelligence` | market_slug, intel_type, title, content, priority | Market insights |
| `zone_intelligence` | market_slug, zone_type, zone_name, confidence_score | Zone knowledge |
| `driver_profiles` | user_id, first_name, home_city, platforms | Driver profile |
| `driver_vehicles` | user_id, make, model, year, vehicle_type | Vehicle details |
| `user_intel_notes` | user_id, note_type, title, content, importance | Coach notes |
| `offer_intelligence` | price, per_mile, product_type, platform, decision | Offer analysis |

### 11.2 Writable Tables (6 via action tags + 1 auto-saved)

| Table | Action Tag | Scoping |
|-------|-----------|---------|
| `user_intel_notes` | `[SAVE_NOTE]` | Per user_id |
| `discovered_events` | `[ADD/UPDATE/DEACTIVATE/REACTIVATE_EVENT]` | By event_title match |
| `zone_intelligence` | `[ZONE_INTEL]` | Per market_slug |
| `coach_system_notes` | `[SYSTEM_NOTE]` | Global (deduped by title+category) |
| `news_deactivations` | `[DEACTIVATE_NEWS]` | Per user_id |
| `docs/coach-inbox.md` | `[COACH_MEMO]` | File system (not DB) |
| `coach_conversations` | Auto-saved | Per user_id + conversation_id |

---

## 12. Client Integration

### 12.1 Component: AICoach.tsx

**Props:** userId, snapshotId, strategyId, strategy, snapshot, blocks, strategyReady

**Features:**
- Streaming chat UI with SSE
- Notes panel (side drawer) with CRUD operations
- File attachment support for images/documents
- Chat persistence via `useChatPersistence` hook
- Memory integration via `useMemory` hook

### 12.2 Notes Panel

| Operation | Method | Optimistic UI? |
|-----------|--------|----------------|
| Fetch notes | `GET /api/coach/notes` | No |
| Delete note | `DELETE /api/coach/notes/:id` | Yes (rollback on error) |
| Pin/unpin | `POST /api/coach/notes/:id/pin` | Yes (rollback on error) |
| Edit note | `PUT /api/coach/notes/:id` | Yes |

**Trigger:** Notes panel fetches only when opened AND `notes.length === 0`.

---

## 13. SSE Streaming Architecture

### 13.1 Stream Flow

```
callModelStream('AI_COACH', params) → Response with ReadableStream
    │
    ▼
Read chunks: TextDecoder → split by 'data: ' lines
    │
    ▼
Parse each chunk: { candidates: [{ content: { parts: [{ text }] } }] }
    │
    ▼
Send to client: res.write(`data: ${JSON.stringify({ delta: text })}\n\n`)
    │
    ▼
Accumulate fullResponseText += text
    │
    ▼
On stream end: res.write(`data: ${JSON.stringify({ done: true, conversation_id })}\n\n`)
```

### 13.2 SSE Event Types

| Event | Data | When |
|-------|------|------|
| `{ delta: text }` | Text chunk | During streaming |
| `{ error: message }` | Error string | On API failure |
| `{ done: true, conversation_id }` | Completion signal | Stream ends |

**No action confirmation events** — client is not informed whether actions succeeded.

---

## 14. Conversation Persistence

### 14.1 Save Flow

```
User message → saveConversationMessage({ role: 'user', content, ... })
    │                                                 ↓
    │                                    coach_conversations INSERT
    │
Stream completes → saveConversationMessage({ role: 'assistant', content: cleanedText, ... })
    │                                                 ↓
    │                                    coach_conversations INSERT
    └── extractAndSaveTips(userId, cleanedText, ...) → auto-save tips as notes
```

### 14.2 Conversation Fields

| Field | Purpose |
|-------|---------|
| `conversation_id` | Thread grouping (persistent across messages) |
| `parent_message_id` | Threading support |
| `content_type` | text/image/file |
| `topic_tags` | GIN-indexed topic classification |
| `extracted_tips` | Auto-extracted tips from response |
| `sentiment` | Conversation mood |
| `tokens_in`, `tokens_out` | Token tracking |
| `model_used` | Model identifier |

---

## 15. Notes CRUD System

**Endpoint base:** `/api/coach/notes`

| Operation | Method | Path | Features |
|-----------|--------|------|----------|
| List | GET | `/notes` | Paginated, sortable by importance/created_at, filter by type/category |
| Read | GET | `/notes/:id` | Single note with full content |
| Create | POST | `/notes` | User or AI-created notes |
| Update | PUT | `/notes/:id` | Edit title, content, type, category, importance |
| Delete | DELETE | `/notes/:id` | Soft delete (is_active = false) |
| Pin | POST | `/notes/:id/pin` | Toggle pin status |
| Restore | POST | `/notes/:id/restore` | Restore soft-deleted note |
| Stats | GET | `/notes/stats/summary` | Counts by type, category, pinned |

---

## 16. Schema Metadata Endpoints

**File:** `server/api/coach/schema.js`

Provides schema introspection for the AI Coach prompt:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/coach/schema` | Full schema with table descriptions, column details, readable/writable lists |
| `GET /api/coach/schema/tables` | Compact table name list |
| `GET /api/coach/schema/prompt` | Pre-formatted schema text for system prompt injection |

**Readable tables:** snapshots, strategies, briefings, discovered_events, venue_catalog, ranking_candidates, market_intelligence, zone_intelligence, driver_profiles, driver_vehicles, user_intel_notes, offer_intelligence

**Writable tables:** user_intel_notes, discovered_events, zone_intelligence, coach_system_notes, news_deactivations

---

## 17. Error Handling Patterns

### Pattern 1: DAL Returns Null on Failure

All DAL write methods follow:
```javascript
async saveX(data) {
  try {
    // validate required fields → return null if missing
    // INSERT → return row
  } catch (error) {
    console.error('[CoachDAL] saveX error:', error);
    return null;  // ← silent failure
  }
}
```

### Pattern 2: executeActions Collects Errors

```javascript
try {
  await coachDAL.saveX(data);
  results.saved++;
} catch (e) {
  results.errors.push(`Type: ${e.message}`);
}
```

Errors are collected in `results.errors` array, logged to server console with `console.warn`, but **never sent to client**.

### Pattern 3: Fire-and-Forget

```javascript
executeActions(actions, userId, snapshotId, conversationId)
  .then(result => { console.log(...) })
  .catch(e => console.error(...));
// SSE "done" sent immediately — no await
```

---

## 18. File Inventory

### Core Service Files

| File | Lines | Purpose |
|------|-------|---------|
| `server/api/chat/chat.js` | ~1,448 | Main chat endpoint, streaming, actions |
| `server/lib/ai/coach-dal.js` | ~2,572 | Data access layer |
| `server/api/coach/schema.js` | ~150 | Schema metadata endpoints |
| `server/api/coach/validate.js` | ~250 | Zod validation schemas |
| `server/api/coach/notes.js` | ~300 | Notes CRUD endpoints |
| `server/api/coach/index.js` | ~20 | Route aggregator |

### Client Files

| File | Purpose |
|------|---------|
| `client/src/components/AICoach.tsx` | Main chat + notes panel UI |
| `client/src/pages/co-pilot/StrategyPage.tsx` | Page integration |

### Supporting Files

| File | Purpose |
|------|---------|
| `server/lib/ai/model-registry.js` | AI_COACH role config |
| `server/lib/ai/adapters/index.js` | callModelStream dispatcher |
| `server/lib/ai/adapters/gemini-adapter.js` | Gemini streaming adapter |
| `docs/coach-inbox.md` | Coach-to-Claude Code memo inbox |
| `docs/architecture/ai-coach.md` | Architecture documentation |
| `docs/review-queue/ai-coach-enhancements.md` | Enhancement TODO |

### Scripts

| File | Purpose |
|------|---------|
| `scripts/check_coach_table.js` | Verify coach_conversations table exists |
| `scripts/debug_coach_columns.js` | Introspect coach table columns |
| `scripts/fetch_coach_data.js` | Fetch and display coach data |
