# Chat API (`server/api/chat/`)

## Purpose

AI Strategy Coach with streaming and voice capabilities.

## Files

| File | Route | Purpose | Auth Required |
|------|-------|---------|---------------|
| `chat.js` | `/api/chat` | AI Coach SSE streaming | Yes |
| `chat-context.js` | `/coach/context/*` | Read-only chat context | No |
| `realtime.js` | `/api/realtime` | OpenAI Realtime voice | **Yes** |
| `tts.js` | `/api/tts` | Text-to-speech | **Yes** |

## Endpoints

```
POST /api/chat/:snapshotId/message  - AI Coach with streaming (SSE)
GET  /coach/context/:snapshotId     - Get chat context
POST /api/realtime/token            - Get Realtime session token (AUTH REQUIRED)
POST /api/tts                       - Text-to-speech conversion (AUTH REQUIRED)
```

## Security

**Auth-Protected Endpoints:** The following endpoints require authentication because they incur API costs:

| Endpoint | Reason for Auth |
|----------|-----------------|
| `POST /api/realtime/token` | Mints OpenAI Realtime tokens (expensive) |
| `POST /api/tts` | Calls OpenAI TTS API (has per-request cost) |

Both use `requireAuth` middleware to prevent unauthenticated API cost abuse.

## AI Coach Flow

1. Client sends message via POST /api/chat
2. Server extracts user's timezone from `clientSnapshot.timezone`
3. Server computes user's local date/time for system prompt
4. Server enriches with snapshot context via CoachDAL
5. Calls Gemini model with streaming
6. Parses action tags from response (see below)
7. Streams cleaned response back via SSE

## Action Parsing

The AI Coach can emit special action tags that are parsed and executed server-side:

| Action | Purpose | Example |
|--------|---------|---------|
| `[SAVE_NOTE: {...}]` | Save note about driver | `{"type": "preference", "title": "...", "content": "..."}` |
| `[SYSTEM_NOTE: {...}]` | AI observation for devs | `{"type": "pain_point", "category": "ui", "title": "..."}` |
| `[DEACTIVATE_EVENT: {...}]` | Mark event inactive | `{"event_title": "...", "reason": "event_ended"}` |
| `[REACTIVATE_EVENT: {...}]` | Undo mistaken deactivation | `{"event_title": "...", "reason": "wrong date"}` |
| `[DEACTIVATE_NEWS: {...}]` | Hide news for user | `{"news_title": "...", "reason": "outdated"}` |
| `[ZONE_INTEL: {...}]` | Crowd-sourced zone learning | `{"zone_type": "dead_zone", "zone_name": "..."}` |

### Date/Time Awareness

The Coach receives the user's local date/time prominently in the system prompt:
```
**⏰ CURRENT DATE & TIME (User's Local Time):**
**Wednesday, January 1, 2026 at 11:45 PM** (America/Chicago)
```

This prevents date-related mistakes when deactivating events. If the Coach deactivates an event by mistake (e.g., wrong date assumption), it can use `[REACTIVATE_EVENT: {...}]` to undo.

## Voice Flow

1. Client requests Realtime session token
2. Client connects directly to OpenAI Realtime
3. Voice transcribed and sent as chat message

## Connections

- **Uses:** `../../db/drizzle.js` for database access
- **Uses:** `../../../shared/schema.js` for database schema
- **Uses:** `../../lib/ai/coach-dal.js` for context
- **Uses:** `../../lib/ai/adapters/` for model calls
- **Called by:** Client CoachChat component

## Import Paths

```javascript
// Database
import { db } from '../../db/drizzle.js';
import { snapshots, strategies } from '../../../shared/schema.js';

// AI
import { callModel } from '../../lib/ai/adapters/index.js';
import { CoachDAL } from '../../lib/ai/coach-dal.js';

// External
import { synthesizeSpeech } from '../../lib/external/tts-handler.js';

// Middleware
import { requireAuth } from '../../middleware/auth.js';
import { chatLimiter } from '../../middleware/rate-limit.js';
```
