> **Last Verified:** 2026-01-06

# Feedback API (`server/api/feedback/`)

## Purpose

User feedback capture and interaction tracking for ML training.

## Files

| File | Route | Purpose |
|------|-------|---------|
| `feedback.js` | `/api/feedback/*` | User feedback (thumbs up/down) |
| `actions.js` | `/api/actions/*` | User interaction tracking |

## Endpoints

```
POST /api/feedback              - Submit feedback
GET  /api/feedback/:snapshotId  - Get feedback for snapshot
POST /api/actions               - Track user action
```

## Action Types

- `view` - User viewed a venue/strategy
- `click` - User clicked a venue
- `dwell` - User dwelled on content
- `navigate` - User started navigation
- `dismiss` - User dismissed recommendation

## Data Flow

1. Client sends action/feedback
2. Server validates via Zod schema
3. Stores in database linked to snapshot_id
4. Used for ML model training

## Connections

- **Uses:** `../../db/drizzle.js` for database access
- **Uses:** `../../../shared/schema.js` for database schema
- **Called by:** Client venue cards, feedback modals

## Import Paths

```javascript
// Database
import { db } from '../../db/drizzle.js';
import { feedback, actions, snapshots } from '../../../shared/schema.js';

// Middleware
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';

// Semantic search (for ML training)
import { indexFeedback } from '../../lib/external/semantic-search.js';
```
