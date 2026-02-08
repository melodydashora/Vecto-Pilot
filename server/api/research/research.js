// Research API endpoint - Internet-powered research via UTIL_RESEARCH role
import express from 'express';
// @ts-ignore
import { callGemini } from '../../lib/ai/adapters/gemini-adapter.js';

const router = express.Router();

// Quick research endpoint
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.status(400).json({
        error: 'Missing query parameter: q'
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    }

    const response = await callGemini({
      model: 'gemini-3-pro-preview',
      maxTokens: 500,
      temperature: 0.2,
      user: `Provide concise, technical information for software development. Focus on best practices and actionable insights.\n\nQuery: ${q}`
    });

    if (!response.ok) {
      throw new Error(response.error);
    }

    res.json({
      ok: true,
      query: q,
      answer: response.output,
      model: 'gemini-3-pro-preview',
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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    }

    const depthInstruction = depth === 'deep' ? 'Provide comprehensive, detailed analysis.' : 'Provide concise summary.';
    
    const response = await callGemini({
      model: 'gemini-3-pro-preview',
      maxTokens: 2000,
      temperature: 0.3,
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
      model: 'gemini-3-pro-preview',
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
