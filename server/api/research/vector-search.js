// Vector search API routes
import express from 'express';
import { upsertDoc, knnSearch } from '../../lib/external/semantic-search.js';
// 2026-02-12: Added requireAuth - vector search requires authentication
import { requireAuth } from '../../middleware/auth.js';

const router = express.Router();

// 2026-02-12: SECURITY FIX - All vector search routes now require authentication
// Previously the /upsert endpoint was open, allowing anyone to inject documents
router.use(requireAuth);

// POST /api/vector/upsert - Add or update a document with embedding
router.post('/upsert', async (req, res) => {
  try {
    const { id, content, metadata, embedding } = req.body;
    
    if (!id || !content || !embedding) {
      return res.status(400).json({ 
        error: 'Missing required fields: id, content, embedding' 
      });
    }

    await upsertDoc({ id, content, metadata, embedding });
    res.json({ success: true, id });
  } catch (err) {
    console.error('[vector] Upsert error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vector/search - Perform KNN search
router.post('/search', async (req, res) => {
  try {
    const { queryEmbedding, k = 5, minScore = 0.0 } = req.body;
    
    if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
      return res.status(400).json({ 
        error: 'queryEmbedding must be a number array' 
      });
    }

    const results = await knnSearch({ queryEmbedding, k, minScore });
    res.json({ results, count: results.length });
  } catch (err) {
    console.error('[vector] Search error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
