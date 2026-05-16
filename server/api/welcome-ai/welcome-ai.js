// server/api/welcome-ai/welcome-ai.js
// 2026-05-15: Public Gemini-backed endpoints for the /welcome iPad kiosk's
// AI Co-Pilot slide. Two endpoints — POST /icebreaker and POST /ask — both
// PUBLIC (no auth) with aggressive per-IP rate limiting since the iPad kiosk
// has no user identity. Server holds GEMINI_API_KEY; never exposed to client.

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { callGemini } from '../../lib/ai/adapters/gemini-adapter.js';

const router = Router();

const publicLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20,                  // 20 calls per IP per window — generous for a real rider, hostile to scraping
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests — please wait a minute before trying again.' },
});

router.post('/icebreaker', publicLimiter, async (req, res) => {
  try {
    const result = await callGemini({
      model: 'gemini-flash-latest',
      system: 'You are an expert in casual conversation and rideshare etiquette. Output only the conversation starter directly — no quotes, no framing, no "Here is" preamble. Just the question or comment a passenger could actually say.',
      user: 'Generate a single fun, polite icebreaker a passenger can use with their rideshare driver. Keep it casual, friendly, and short (1–2 sentences). Avoid politics, religion, romance, and anything personal or sensitive.',
      maxTokens: 200,
      temperature: 0.9,
    });
    if (!result.ok) {
      console.error('[welcome-ai] icebreaker — adapter not ok:', result.error);
      return res.status(502).json({ ok: false, error: 'AI temporarily unavailable. Try again in a moment.' });
    }
    const text = String(result.output || '').trim().replace(/^["']|["']$/g, '');
    return res.json({ ok: true, text });
  } catch (err) {
    console.error('[welcome-ai] icebreaker error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.post('/ask', publicLimiter, async (req, res) => {
  try {
    const { question } = req.body || {};
    if (typeof question !== 'string' || !question.trim() || question.length > 500) {
      return res.status(400).json({ ok: false, error: 'Provide a question between 1 and 500 characters.' });
    }
    const result = await callGemini({
      model: 'gemini-flash-latest',
      system: 'You are a friendly, professional rideshare driver answering a passenger\'s question. Be polite, brief (2–3 sentences max), and keep passenger safety and rideshare rules in mind. If the question is unsafe, inappropriate, or asks the driver to break platform rules, politely decline. Always speak in first person as the driver.',
      user: `A passenger in your car just asked: "${question.trim()}"`,
      maxTokens: 300,
      temperature: 0.7,
    });
    if (!result.ok) {
      console.error('[welcome-ai] ask — adapter not ok:', result.error);
      return res.status(502).json({ ok: false, error: 'AI temporarily unavailable. Try again in a moment.' });
    }
    return res.json({ ok: true, text: String(result.output || '').trim() });
  } catch (err) {
    console.error('[welcome-ai] ask error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

export default router;
