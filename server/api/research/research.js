// Research API endpoint - Internet-powered research via UTIL_RESEARCH role
import express from 'express';
// @ts-ignore
import { callModel } from '../../lib/ai/adapters/index.js';
// 2026-02-12: Added requireAuth - research endpoints require authentication
import { requireAuth } from '../../middleware/auth.js';

const router = express.Router();

// 2026-02-12: SECURITY FIX - Research routes now require authentication
// These endpoints call AI models which cost money per request
router.use(requireAuth);

// Quick research endpoint
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.status(400).json({
        error: 'Missing query parameter: q'
      });
    }

    const response = await callModel('UTIL_RESEARCH', {
      user: `Provide concise, technical information for software development. Focus on best practices and actionable insights.\n\nQuery: ${q}`
    });

    if (!response.ok) {
      throw new Error(response.error);
    }

    res.json({
      ok: true,
      query: q,
      answer: response.output,
      model: 'util-research',
      timestamp: new Date().toISOString()
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

    const depthInstruction = depth === 'deep' ? 'Provide comprehensive, detailed analysis.' : 'Provide concise summary.';
    
    const response = await callModel('UTIL_RESEARCH', {
      user: `${depthInstruction}\n\nTopic: ${topic}`
    });

    if (!response.ok) {
      throw new Error(response.error);
    }

    res.json({
      ok: true,
      topic: topic,
      depth: depth,
      answer: response.output,
      model: 'util-research',
      timestamp: new Date().toISOString()
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
