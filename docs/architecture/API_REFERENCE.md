### Chat & Voice

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/chat` | POST | `server/api/chat/chat.js` | Rideshare Coach chat with SSE streaming + action parsing (Notes, Events (Add/Edit/Status), Memos, News, Zone Intel) & validation |
| `/api/chat/notes` | POST | `server/api/chat/chat.js` | Save a coach note about the user |
| `/api/chat/notes` | GET | `server/api/chat/chat.js` | Get user's coach notes |
| `/api/chat/notes/:noteId` | DELETE | `server/api/chat/chat.js` | Delete a coach note (soft delete) |
| `/api/chat/context/:snapshotId` | GET | `server/api/chat/chat.js` | Get full context for strategy coach |
| `/api/chat/conversations` | GET | `server/api/chat/chat.js` | List all conversations for user |
| `/api/chat/conversations/:conversationId` | GET | `server/api/chat/chat.js` | Get messages for a conversation |
| `/api/chat/conversations/:messageId/star` | POST | `server/api/chat/chat.js` | Star a message to mark as important |
| `/api/hooks/analyze-offer` | POST | `server/api/hooks/analyze-offer.js` | Real-time ride offer analysis (Text/Vision/Multipart) for Siri Shortcuts with voice response & analytics |

### Location

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/location/resolve` | POST | `server/api/location/location.js` | Resolve GPS coordinates to address, market, and timezone with circuit-breaker protection (Authenticated) |
| `/api/location/snapshot` | POST | `server/api/location/location.js` | Create location snapshot, validate freshness, and generate strategy (Authenticated) |
| `/api/location/news` | GET | `server/api/location/location.js` | Get local news briefing for the current location (Authenticated) |

### Health & Diagnostics

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/diagnostics` | GET | `server/api/health/diagnostics.js` | System health check (DB, API Keys, Activity, Pipeline, Storage, Catalog) (Authenticated) |
| `/api/diagnostics/db-data` | GET | `server/api/health/diagnostics.js` | View raw database records for debugging (Authenticated) |