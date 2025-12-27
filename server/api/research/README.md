# Research API (`server/api/research/`)

## Purpose

Research queries and vector similarity search for venue/strategy exploration.

## Files

| File | Route | Purpose |
|------|-------|---------|
| `research.js` | `/api/research/*` | Research queries |
| `vector-search.js` | `/api/vector-search/*` | Vector similarity search |

## Endpoints

```
POST /api/research/query          - Execute research query
POST /api/vector-search           - Vector similarity search
GET  /api/vector-search/status    - Search index status
```

## Use Cases

- Semantic search for similar venues
- Historical strategy pattern matching
- Research query execution

## Connections

- **Uses:** `../../lib/external/semantic-search.js` for vector operations (upsertDoc, knnSearch)
- **Called by:** Admin tools, advanced research features

## Import Paths

```javascript
// Database
import { db } from '../../db/drizzle.js';

// Semantic search
import { searchSimilar, indexFeedback, upsertDoc, knnSearch } from '../../lib/external/semantic-search.js';

// Middleware
import { requireAuth } from '../../middleware/auth.js';
```
