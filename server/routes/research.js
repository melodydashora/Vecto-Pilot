// Research API endpoint - Internet-powered research via Perplexity
import express from 'express';
import { PerplexityResearch } from '../lib/perplexity-research.js';

const router = express.Router();
const perplexity = new PerplexityResearch();

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

export default router;
