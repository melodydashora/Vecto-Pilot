// Research API endpoint - Internet-powered research via Perplexity
import express from 'express';
import { PerplexityResearch } from '../lib/perplexity-research.js';
import pg from 'pg';

const router = express.Router();
const perplexity = new PerplexityResearch();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Quick research endpoint
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.status(400).json({
        error: 'Missing query parameter: q'
      });
    }

    const result = await perplexity.search(q, {
      systemPrompt: 'Provide concise, technical information for software development. Focus on best practices and actionable insights.',
      maxTokens: 500,
      searchRecencyFilter: 'month'
    });

    res.json({
      ok: true,
      query: q,
      answer: result.answer,
      citations: result.citations,
      relatedQuestions: result.relatedQuestions,
      model: result.model,
      timestamp: result.timestamp
    });
  } catch (error) {
    console.error('[Research API] Error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Deep research endpoint
router.post('/deep', async (req, res) => {
  try {
    const { topic, depth = 'standard' } = req.body;
    
    if (!topic) {
      return res.status(400).json({
        error: 'Missing required field: topic'
      });
    }

    const result = await perplexity.researchTopic(topic, depth);

    res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error('[Research API] Deep research error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Location-based research endpoint (non-blocking)
router.post('/location', async (req, res) => {
  try {
    const { snapshotId, lat, lng, city, state } = req.body;
    
    if (!snapshotId || !lat || !lng) {
      return res.status(400).json({
        error: 'Missing required fields: snapshotId, lat, lng'
      });
    }

    res.json({
      ok: true,
      message: 'Location research started',
      snapshotId
    });

    setImmediate(async () => {
      try {
        console.log(`[Perplexity Research] Starting location research for snapshot ${snapshotId}...`);
        const startTime = Date.now();
        
        const research = await perplexity.researchLocationConditions(lat, lng, city, state);
        const totalLatency = Date.now() - startTime;
        
        for (const queryResult of research.queries) {
          if (queryResult.success) {
            await pool.query(
              `INSERT INTO perplexity_research 
               (snapshot_id, lat, lng, city, state, query_type, perplexity_query, answer, citations, impact_level, model_name, latency_ms, status, metadata)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
              [
                snapshotId,
                lat,
                lng,
                city,
                state,
                queryResult.data.type,
                queryResult.data.query,
                queryResult.data.answer,
                JSON.stringify(queryResult.data.citations || []),
                queryResult.data.impact_level,
                queryResult.data.model,
                queryResult.data.latency_ms,
                'completed',
                JSON.stringify({ timestamp: queryResult.data.timestamp })
              ]
            );
          } else {
            await pool.query(
              `INSERT INTO perplexity_research 
               (snapshot_id, lat, lng, city, state, query_type, perplexity_query, status, metadata)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                snapshotId,
                lat,
                lng,
                city,
                state,
                queryResult.type,
                '',
                'failed',
                JSON.stringify({ error: queryResult.error })
              ]
            );
          }
        }
        
        console.log(`[Perplexity Research] ✅ Completed for snapshot ${snapshotId} in ${totalLatency}ms (${research.successfulQueries}/${research.totalQueries} successful)`);
      } catch (error) {
        console.error('[Perplexity Research] Background research failed:', error);
      }
    });
  } catch (error) {
    console.error('[Research API] Location research error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

export default router;
