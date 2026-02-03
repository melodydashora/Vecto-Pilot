// Research API endpoint - Internet-powered research via UTIL_RESEARCH role
import express from 'express';

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

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Provide concise, technical information for software development. Focus on best practices and actionable insights.\n\nQuery: ${q}`
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 500
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API failed: ${response.status}`);
    }

    const data = await response.json();
    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    res.json({
      ok: true,
      query: q,
      answer: answer,
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
    
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `${depthInstruction}\n\nTopic: ${topic}`
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2000
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API failed: ${response.status}`);
    }

    const data = await response.json();
    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    res.json({
      ok: true,
      topic: topic,
      depth: depth,
      answer: answer,
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
