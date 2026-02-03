# AI Coach Architecture

> **Last Updated**: 2026-01-05
>
> The AI Coach is a conversational assistant that helps rideshare drivers with strategy, tips, and insights. It has full read access to the database and can write to specific tables to capture learnings.

---

## Overview

The AI Coach is a streaming chat interface powered by Claude Opus 4.5, with capabilities to:

1. **Read** driver context (location, weather, strategy, events, venues)
2. **Write** notes, zone intel, and system observations
3. **Execute actions** via embedded tags (deactivate events, save notes)
4. **Remember** driver preferences across sessions

### Architecture Components

```
┌─────────────────────────────────────────────────────────────┐
│                     CoachChat.tsx                           │
│  (React component with notes panel & streaming chat)        │
└────────────────────────────┬────────────────────────────────┘
                             │ POST /api/chat
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    chat.js (Router)                         │
│  - Schema metadata injection into system prompt             │
│  - Action tag parsing & validation                          │
│  - SSE streaming to client                                  │
└────────────────────────────┬────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │CoachDAL  │  │validate.js│  │schema.js│
        │(2300+ LOC)│  │(Zod)     │  │(metadata)│
        └──────────┘  └──────────┘  └──────────┘
```

---

## API Endpoints

### Coach API (`/api/coach/*`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/coach/schema` | GET | Schema metadata for prompt injection |
| `/api/coach/schema/tables` | GET | Compact table list |
| `/api/coach/schema/prompt` | GET | Formatted string for system prompt |
| `/api/coach/validate` | POST | Pre-flight action validation |
| `/api/coach/validate/batch` | POST | Validate multiple actions |
| `/api/coach/validate/schemas` | GET | Schema documentation |
| `/api/coach/notes` | GET | List user's notes (with pagination) |
| `/api/coach/notes/:id` | GET | Get single note |
| `/api/coach/notes` | POST | Create note |
| `/api/coach/notes/:id` | PUT | Update note |
| `/api/coach/notes/:id` | DELETE | Soft delete note |
| `/api/coach/notes/:id/pin` | POST | Toggle pin status |
| `/api/coach/notes/:id/restore` | POST | Restore deleted note |
| `/api/coach/notes/stats/summary` | GET | Note statistics |

### Chat API (`/api/chat`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/chat` | POST | Streaming chat with full context |

---

## Database Access

### Tables the Coach Can READ

| Table | Description | Key Columns |
|-------|-------------|-------------|
| `snapshots` | User location sessions | `id`, `user_id`, `city`, `state`, `timezone`, `lat`, `lng`, `weather` |
| `strategies` | AI-generated strategies | `id`, `snapshot_id`, `consolidated_strategy`, `immediate_strategy` |
| `briefings` | Events, traffic, news, weather | `id`, `snapshot_id`, `events`, `traffic`, `news`, `weather` |
| `discovered_events` | Local events | `id`, `title`, `venue_name`, `event_start_date`, `event_start_time`, `city`, `is_active` |
| `venue_catalog` | Venue database | `venue_id`, `venue_name`, `city`, `expense_rank`, `opening_hours` |
| `ranking_candidates` | Venue recommendations | `id`, `snapshot_id`, `venue_name`, `rank`, `features` |
| `market_intelligence` | Market-specific intel | `id`, `market_slug`, `intel_type`, `title`, `content` |
| `zone_intelligence` | Crowd-sourced zones | `id`, `market_slug`, `zone_type`, `zone_name` |
| `driver_profiles` | Driver preferences | `id`, `user_id`, `first_name`, `home_city`, `platforms` |
| `driver_vehicles` | Vehicle information | `id`, `user_id`, `make`, `model`, `year`, `vehicle_type` |
| `user_intel_notes` | Coach's memory about driver | `id`, `user_id`, `note_type`, `title`, `content`, `is_pinned` |

### Tables the Coach Can WRITE

| Table | Action Tag | Purpose |
|-------|------------|---------|
| `user_intel_notes` | `[SAVE_NOTE: {...}]` | Save driver preferences and insights |
| `discovered_events` | `[DEACTIVATE_EVENT: {...}]` | Mark events as inactive |
| `discovered_events` | `[REACTIVATE_EVENT: {...}]` | Restore deactivated events |
| `zone_intelligence` | `[ZONE_INTEL: {...}]` | Capture zone knowledge |
| `coach_system_notes` | `[SYSTEM_NOTE: {...}]` | Log system observations |
| `news_deactivations` | `[DEACTIVATE_NEWS: {...}]` | Hide news items |

---

## Action Tags

The AI Coach embeds action tags in its responses that are parsed and executed by `chat.js`.

### SAVE_NOTE

Save a note about driver preferences or insights.

```json
[SAVE_NOTE: {
  "note_type": "preference",
  "category": "timing",
  "title": "Prefers morning shifts",
  "content": "Driver mentioned they like 5-10am because of airport runs",
  "importance": 75,
  "market_slug": "dallas-tx"
}]
```

**Fields:**
- `note_type`: `preference` | `insight` | `tip` | `feedback` | `pattern` | `market_update`
- `category`: `timing` | `location` | `strategy` | `vehicle` | `earnings` | `safety` (optional)
- `title`: Short title (max 200 chars)
- `content`: Full note content (max 5000 chars)
- `importance`: 1-100 (default 50)
- `market_slug`: e.g., `dallas-tx` (optional)

### DEACTIVATE_EVENT

Mark an event as inactive.

```json
[DEACTIVATE_EVENT: {
  "event_title": "Taylor Swift Concert",
  "reason": "event_ended",
  "notes": "Concert finished at 11pm"
}]
```

**Fields:**
- `event_id`: UUID (optional if using title)
- `event_title`: Event name for fuzzy lookup
- `reason`: `event_ended` | `incorrect_time` | `no_longer_relevant` | `cancelled` | `duplicate` | `other`
- `notes`: Additional context (optional)

### ZONE_INTEL

Capture crowd-sourced zone knowledge.

```json
[ZONE_INTEL: {
  "zone_type": "honey_hole",
  "zone_name": "Deep Ellum Bar District",
  "market_slug": "dallas-tx",
  "reason": "Friday/Saturday nights 10pm-2am, constant short rides",
  "time_constraints": "Fri-Sat 22:00-02:00",
  "address_hint": "Main St between Elm and Commerce"
}]
```

**Fields:**
- `zone_type`: `dead_zone` | `danger_zone` | `honey_hole` | `surge_trap` | `staging_spot` | `event_zone`
- `zone_name`: Human-readable name (max 200 chars)
- `market_slug`: Required (e.g., `dallas-tx`)
- `reason`: Why this zone matters (max 1000 chars)
- `time_constraints`: When this applies (optional)
- `address_hint`: Location hint (optional)
- `lat`, `lng`: Coordinates (optional)

### SYSTEM_NOTE

Log a system observation for developers.

```json
[SYSTEM_NOTE: {
  "type": "feature_request",
  "category": "coach",
  "title": "Driver wants multi-stop routing",
  "description": "User asked about planning routes with multiple pickups",
  "user_quote": "Can you show me the best order for these 3 stops?"
}]
```

**Fields:**
- `type`: `feature_request` | `pain_point` | `bug_report` | `aha_moment` | `workaround` | `integration_idea`
- `category`: `ui` | `strategy` | `briefing` | `venues` | `coach` | `map` | `earnings` | `general`
- `title`: Short description (max 200 chars)
- `description`: Full details (max 2000 chars)
- `user_quote`: Direct quote if applicable (optional)
- `priority`: 1-100 (optional)

---

## Validation

All action payloads are validated using Zod schemas before execution.

### Validation Endpoint

```bash
# Validate a single action
curl -X POST /api/coach/validate \
  -H "Content-Type: application/json" \
  -d '{
    "action_type": "SAVE_NOTE",
    "payload": {
      "note_type": "preference",
      "title": "Test",
      "content": "Test content"
    }
  }'

# Response (success)
{
  "ok": true,
  "action_type": "SAVE_NOTE",
  "validated": { ... }
}

# Response (failure)
{
  "ok": false,
  "error": "VALIDATION_ERROR",
  "action_type": "SAVE_NOTE",
  "details": [
    { "field": "title", "message": "Title is required", "code": "too_small" }
  ]
}
```

### Market Slug Format

Market slugs must be lowercase alphanumeric with hyphens:
- Valid: `dallas-tx`, `new-york-ny`, `los-angeles-ca`
- Invalid: `Dallas TX`, `dallas_tx`, `DALLAS-TX`

---

## Frontend Integration

### CoachChat.tsx

The main chat component includes:

1. **Streaming Chat**: SSE-based streaming responses
2. **Notes Panel**: Slide-out panel showing coach's notes about the driver
3. **Optimistic UI**: Immediate updates with rollback on error
4. **File Attachments**: Support for images and documents
5. **Validation Errors**: Banner display for action validation failures

### State Management

```typescript
// Notes panel state
const [notes, setNotes] = useState<UserNote[]>([]);
const [notesOpen, setNotesOpen] = useState(false);
const [notesLoading, setNotesLoading] = useState(false);
const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
const [editingNote, setEditingNote] = useState<string | null>(null);
```

### Optimistic Update Pattern

```typescript
// Example: deleteNote with rollback
const deleteNote = async (noteId: string) => {
  const original = notes;
  setNotes(prev => prev.filter(n => n.id !== noteId)); // Optimistic

  try {
    const res = await fetch(`/api/coach/notes/${noteId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
  } catch (err) {
    setNotes(original); // Rollback on error
  }
};
```

---

## Schema Injection

The coach's system prompt is enhanced with database schema awareness:

```typescript
// In chat.js
const schemaPrompt = formatSchemaForPrompt(coachSchemaMetadata);
systemPrompt += schemaPrompt;
```

This allows the coach to:
- Know what tables exist and their columns
- Understand which tables it can read vs write
- Generate accurate action tags with correct field names

---

## Voice Chat

The coach supports real-time voice conversations via OpenAI's Realtime API:

1. **WebSocket Connection**: Direct to OpenAI's `wss://api.openai.com/v1/realtime`
2. **Audio Streaming**: MediaRecorder captures audio in 100ms chunks
3. **Transcription**: Whisper-1 for speech-to-text
4. **Voice Output**: Alloy voice for TTS

### Enabling Voice

```typescript
// Get ephemeral token
const res = await fetch('/api/realtime/token', {
  method: 'POST',
  body: JSON.stringify({ snapshotId, userId, strategyId })
});

// Connect to OpenAI
const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${model}&token=${token}`);
```

---

## File Structure

```
server/api/coach/
├── index.js      # Route aggregator (mounts schema, validate, notes)
├── schema.js     # Schema metadata endpoint
├── validate.js   # Zod validation schemas and endpoint
└── notes.js      # Notes CRUD endpoints

server/lib/ai/
└── coach-dal.js  # Data Access Layer (2300+ lines, full DB access)

client/src/components/
└── CoachChat.tsx # Main chat component with notes panel
```

---

## Related Files

| File | Purpose |
|------|---------|
| `server/api/chat/chat.js` | Chat router with action parsing |
| `server/api/chat/tts.js` | Text-to-speech endpoint |
| `server/api/chat/realtime.js` | OpenAI Realtime token endpoint |
| `shared/schema.js:1188-1320` | Drizzle schema for notes tables |

---

## Testing

### Manual Testing

```bash
# Test schema endpoint
curl /api/coach/schema | jq .

# Test validation
curl -X POST /api/coach/validate \
  -H "Content-Type: application/json" \
  -d '{"action_type":"SAVE_NOTE","payload":{"note_type":"tip","title":"Test","content":"Test"}}'

# Test notes CRUD
curl -H "Authorization: Bearer $TOKEN" /api/coach/notes
```

### Automated Tests

See `tests/integration/coach-*.test.js` for integration tests covering:
- Schema endpoint returns valid structure
- Validation catches invalid payloads
- Notes CRUD operations
- Action tag parsing

---

## Changelog

### 2026-01-05

- Added `/api/coach/*` endpoints (schema, validate, notes)
- Integrated schema metadata into chat system prompt
- Added notes panel to CoachChat.tsx with optimistic UI
- Fixed SQL bug: `discovered_events.created_at` → `discovered_events.discovered_at`
