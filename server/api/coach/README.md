> **Last Verified:** 2026-02-01

# Coach API (`server/api/coach/`)

## Purpose

AI Coach API routes for schema awareness, validation, and notes CRUD operations. Provides the AI Coach with database awareness and the ability to store/retrieve user notes.

## Files

| File | Route | Purpose |
|------|-------|---------|
| `index.js` | `/api/coach/*` | Router index, mounts sub-routers |
| `schema.js` | `/api/coach/schema/*` | Database schema awareness endpoints |
| `validate.js` | `/api/coach/validate/*` | Coach validation endpoints |
| `notes.js` | `/api/coach/notes/*` | User notes CRUD operations |

## Endpoints

### Schema Awareness
```
GET  /api/coach/schema            - Full schema info for AI prompts
GET  /api/coach/schema/tables     - List available tables for Coach
GET  /api/coach/schema/table/:name - Get table schema details
GET  /api/coach/schema/prompt     - Schema formatted for AI context injection
```

### Validation
```
POST /api/coach/validate          - General data validation
GET  /api/coach/validate/schemas  - Get available validation schemas
POST /api/coach/validate/batch    - Batch validate multiple items
POST /api/coach/validate/event    - Validate event data
POST /api/coach/validate/venue    - Validate venue data
```

### Notes CRUD
```
GET    /api/coach/notes              - List user notes
GET    /api/coach/notes/:id          - Get specific note
GET    /api/coach/notes/stats/summary - Notes statistics (counts by type)
POST   /api/coach/notes              - Create new note
PUT    /api/coach/notes/:id          - Update note
DELETE /api/coach/notes/:id          - Delete note (soft delete)
POST   /api/coach/notes/:id/pin      - Pin/unpin a note
POST   /api/coach/notes/:id/restore  - Restore a soft-deleted note
```

## Authentication

All coach routes require authentication via `requireAuth` middleware.

## Connections

- **Uses:** `../../lib/ai/coach-dal.js` for data access
- **Uses:** `../../db/drizzle.js` for database access
- **Uses:** `../../../shared/schema.js` for database schema
- **Mounted by:** `../../bootstrap/routes.js`

## Import Paths

```javascript
// Database
import { db } from '../../db/drizzle.js';
import { user_notes, discovered_events } from '../../../shared/schema.js';

// Middleware
import { requireAuth } from '../../middleware/auth.js';
```

---
*Created: 2026-01-05 - AI Coach enhancements*
