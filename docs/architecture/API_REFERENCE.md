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

### Offer Analyzer

Canonical doc: `docs/architecture/OFFER_ANALYZER.md`. Hooks are public with optional/required shortcut-token identity; `/api/offer-analyzer/*` requires Bearer auth.

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/hooks/analyze-offer` | POST | `server/api/hooks/analyze-offer.js` | Verdict from OCR text and/or screenshot (JSON, urlencoded, or multipart `image`) → `{ voice, notification, decision, reason, notices }`; token optional |
| `/api/hooks/offer-history` | GET | `server/api/hooks/analyze-offer.js` | Owner's recent analyses (token required) |
| `/api/hooks/offer-override` | POST | `server/api/hooks/analyze-offer.js` | Record override (token required) |
| `/api/hooks/offer-cleanup` | POST | `server/api/hooks/analyze-offer.js` | Batch-delete owner's rows (token required) |
| `/api/offer-analyzer/rules` | GET/PUT | `server/api/offer-analyzer/index.js` | Per-driver ruleset v3 (Zod-validated on PUT) |
| `/api/offer-analyzer/shortcut-token` (+ `/regenerate`, `/label`) | GET/POST | `server/api/offer-analyzer/index.js` | Shortcut token mint / rotate / label |
| `/api/offer-analyzer/offers` (+ `/:id/outcome`) | GET/POST | `server/api/offer-analyzer/index.js` | My offers + outcomes; record what I actually did |
| `/api/offer-analyzer/places/search` | GET | `server/api/offer-analyzer/index.js` | Places picker for avoid-list |

### Location

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/location/resolve` | GET | `server/api/location/location.js` | Resolve GPS coordinates to address, market, and timezone with circuit-breaker protection (Authenticated) |
| `/api/location/snapshot` | POST | `server/api/location/location.js` | Create location snapshot, validate freshness, and generate strategy (Authenticated) |
| `/api/location/news-briefing` | POST | `server/api/location/location.js` | Generate local news briefing for the current location (Authenticated) |

### Health & Diagnostics

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/diagnostics` | GET | `server/api/health/diagnostics.js` | System health check (DB, API Keys, Activity, Pipeline, Storage, Catalog) (Authenticated) |
| `/api/diagnostics/db-data` | GET | `server/api/health/diagnostics.js` | View raw database records for debugging (Authenticated) |