# Chat API (`server/api/chat/`)

## Purpose

AI Strategy Coach with streaming and voice capabilities.

## Files

| File | Route | Purpose |
|------|-------|---------|
| `chat.js` | `/api/chat` | AI Coach SSE streaming |
| `chat-context.js` | `/coach/context/*` | Read-only chat context |
| `realtime.js` | `/api/realtime` | OpenAI Realtime voice |
| `tts.js` | `/api/tts` | Text-to-speech |

## Endpoints

```
POST /api/chat                    - AI Coach with streaming (SSE)
GET  /coach/context/:snapshotId   - Get chat context
GET  /api/realtime/session        - Get Realtime session token
POST /api/tts                     - Text-to-speech conversion
```

## AI Coach Flow

1. Client sends message via POST /api/chat
2. Server enriches with snapshot context
3. Calls Claude/GPT model via adapter
4. Streams response back via SSE

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
