# Vector DB Setup Complete ✅

## What Was Implemented

### 1. Database Migration
- **File**: `migrations/001_init.sql`
- Enables `pgvector` extension
- Creates `documents` table with 1536-dim embeddings (OpenAI text-embedding-3-small)
- Creates IVFFlat index for fast KNN search using cosine distance

### 2. Helper Scripts
- **`server/scripts/run-sql-migration.js`**: Run SQL migrations manually
- **`server/scripts/db-doctor.js`**: Diagnose DB health and schema

### 3. Gateway Integration
- **File**: `gateway-server.js`
- DB pool created only if `DATABASE_URL` is set
- `prepareDb()` runs migration on startup (safe to run repeatedly)
- Updated `/readyz` endpoint to check DB connection
- Exported functions:
  - `upsertDoc({ id, content, metadata, embedding })`: Add/update documents
  - `knnSearch({ queryEmbedding, k, minScore })`: Semantic search

### 4. API Routes (Example)
- **File**: `server/routes/vector-search.js`
- `POST /api/vector/upsert`: Add documents with embeddings
- `POST /api/vector/search`: KNN semantic search

## How to Use

### Add to package.json scripts (manually):
```json
"db:migrate:run": "node server/scripts/run-sql-migration.js migrations/001_init.sql",
"db:doctor": "node server/scripts/db-doctor.js"
```

### Run Migration
```bash
npm run db:migrate:run
```

### Check DB Health
```bash
npm run db:doctor
```

### Example: Upsert Document
```javascript
import { upsertDoc } from './gateway-server.js';

await upsertDoc({
  id: 'doc-123',
  content: 'Sample document text',
  metadata: { source: 'user-input', timestamp: Date.now() },
  embedding: [0.1, 0.2, ...] // 1536-dim array from OpenAI
});
```

### Example: Search
```javascript
import { knnSearch } from './gateway-server.js';

const results = await knnSearch({
  queryEmbedding: [0.1, 0.2, ...], // 1536-dim query vector
  k: 5,                            // top 5 results
  minScore: 0.7                    // minimum similarity score
});

console.log(results);
// [{ id, content, metadata, score }, ...]
```

## Important Notes

1. **Embedding Dimension**: Currently set to 1536 (OpenAI text-embedding-3-small)
   - If using a different model, update the dimension in `migrations/001_init.sql` and `INIT_SQL` in `gateway-server.js`

2. **Auto-Migration**: The `prepareDb()` function runs on every startup, so manual migration is optional

3. **Graceful Degradation**: If `DATABASE_URL` is not set, the app starts normally but vector features are disabled

4. **Health Checks**: `/readyz` now validates DB connection for production deployments

5. **Distance Metric**: Using cosine distance (`<=>`) for semantic similarity

## Next Steps

To integrate vector search into your ML pipeline:
1. Generate embeddings using OpenAI or another provider
2. Call `upsertDoc()` when ingesting training data
3. Call `knnSearch()` for retrieval-augmented generation (RAG)
4. Monitor performance with `npm run db:doctor`
