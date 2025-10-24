// server/routes/chat.js
// AI Strategy Coach - Conversational assistant for drivers
import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db/drizzle.js';
import { snapshots, strategies } from '../../shared/schema.js';
import { eq, desc } from 'drizzle-orm';

const router = Router();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// POST /api/chat - AI Strategy Coach with streaming
router.post('/', async (req, res) => {
  const { userId, message } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message required' });
  }

  console.log('[chat] User:', userId || 'anonymous', '| Message:', message.substring(0, 100));

  try {
    // Get user's latest snapshot and strategy for context
    let contextInfo = '';
    
    try {
      const latestSnapshot = await db
        .select()
        .from(snapshots)
        .where(userId ? eq(snapshots.user_id, userId) : undefined)
        .orderBy(desc(snapshots.created_at))
        .limit(1);

      if (latestSnapshot.length > 0) {
        const snap = latestSnapshot[0];
        
        // Try to get strategy for this snapshot
        const strategyData = await db
          .select()
          .from(strategies)
          .where(eq(strategies.snapshot_id, snap.snapshot_id))
          .orderBy(desc(strategies.created_at))
          .limit(1);

        contextInfo = `\n\nCurrent Driver Context:\n- Location: ${snap.city || 'Unknown'}, ${snap.state || ''}\n- Time: ${snap.day_part_key || 'unknown'} on ${snap.day_of_week || 'unknown'}\n- Weather: ${snap.weather_condition || 'unknown'}\n- Airport nearby: ${snap.airport_context ? 'Yes' : 'No'}`;

        if (strategyData.length > 0 && strategyData[0].strategy) {
          contextInfo += `\n- Current Strategy: ${strategyData[0].strategy.substring(0, 200)}...`;
        }
      }
    } catch (err) {
      console.warn('[chat] Could not fetch context:', err.message);
    }

    const systemPrompt = `You are an AI companion and assistant for rideshare drivers using Vecto Pilot. You're here to help with:

**Professional Support:**
- Rideshare strategy and earning optimization
- Interpreting AI-generated venue recommendations
- Location and timing advice for maximizing rides
- Understanding market patterns and demand

**Personal Support:**
- Friendly conversation during slow times
- Motivation and encouragement during tough shifts
- General advice and companionship on the road
- Listening and responding with empathy

**Communication Style:**
- Warm, friendly, and conversational - like a supportive friend
- Use natural language and emojis when it feels right
- Match the driver's energy - professional when they need strategy, casual when they want to chat
- Be genuine, never robotic or overly formal
- Keep responses concise (under 150 words) unless they want to dive deeper${contextInfo}

Remember: Driving can be lonely and stressful. You're here to make their day better, whether that's through smart strategy advice or just being someone to talk to.`;

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Stream response from Claude
    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      temperature: 0.7,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: message
        }
      ]
    });

    // Send chunks as SSE
    stream.on('text', (textDelta) => {
      res.write(`data: ${JSON.stringify({ delta: textDelta })}\n\n`);
    });

    stream.on('error', (error) => {
      console.error('[chat] Stream error:', error);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    });

    stream.on('end', () => {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    });

  } catch (error) {
    console.error('[chat] Error:', error);
    
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
});

export default router;
