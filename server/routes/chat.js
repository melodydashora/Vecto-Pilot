// server/routes/chat.js
// AI Strategy Coach - Conversational assistant for drivers
import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db/drizzle.js';
import { snapshots, strategies } from '../../shared/schema.js';
import { eq, desc, sql } from 'drizzle-orm';

const router = Router();

// GET /coach/context/:snapshotId - Snapshot-wide context for strategy coach
router.get('/context/:snapshotId', async (req, res) => {
  const { snapshotId } = req.params;
  
  console.log('[coach] Fetching context for snapshot:', snapshotId);
  
  try {
    // Use v_coach_strategy_context view for complete snapshot context
    const result = await db.execute(sql`
      SELECT * FROM v_coach_strategy_context 
      WHERE active_snapshot_id = ${snapshotId}::uuid
      ORDER BY rank;
    `);
    
    res.json({
      snapshot_id: snapshotId,
      items: result.rows || [],
      count: result.rows?.length || 0
    });
  } catch (error) {
    console.error('[coach] Context fetch failed:', error.message);
    res.status(500).json({
      error: 'CONTEXT_FETCH_FAILED',
      message: error.message,
      snapshot_id: snapshotId
    });
  }
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// POST /api/chat - AI Strategy Coach with streaming
router.post('/', async (req, res) => {
  const { userId, message, snapshotId, strategy, blocks } = req.body;

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

        // Build rich context from snapshot
        const weather = snap.weather ? ` ${snap.weather.tempF}°F, ${snap.weather.conditions}` : 'unknown';
        const airQuality = snap.air ? `AQI ${snap.air.aqi} (${snap.air.category})` : 'unknown';
        const airport = snap.airport_context ? 
          `${snap.airport_context.name} (${snap.airport_context.code}) - ${snap.airport_context.driving_status}` : 
          'None nearby';

        contextInfo = `\n\nCurrent Driver Context:\n- Location: ${snap.city || 'Unknown'}, ${snap.state || ''} (${snap.timezone || 'unknown timezone'})\n- Time: ${snap.day_part_key || 'unknown'}, ${snap.hour}:00\n- Weather:${weather}\n- Air Quality: ${airQuality}\n- Airport: ${airport}`;

        // Add news briefing if available (Gemini 60-min briefing)
        if (snap.news_briefing) {
          const nb = snap.news_briefing;
          if (nb.airports) contextInfo += `\n- Airport Intel (0:15): ${nb.airports.substring(0, 150)}...`;
          if (nb.traffic) contextInfo += `\n- Traffic (0:30): ${nb.traffic.substring(0, 150)}...`;
          if (nb.events) contextInfo += `\n- Events (0:45): ${nb.events.substring(0, 150)}...`;
          if (nb.policy) contextInfo += `\n- Policy (1:00): ${nb.policy.substring(0, 150)}...`;
        }

        // Add full strategy if available
        if (strategyData.length > 0) {
          if (strategyData[0].strategy_for_now) {
            contextInfo += `\n\n--- FULL TACTICAL STRATEGY (GPT-5) ---\n${strategyData[0].strategy_for_now}`;
          } else if (strategyData[0].strategy) {
            contextInfo += `\n\n--- CURRENT STRATEGY (Claude) ---\n${strategyData[0].strategy.substring(0, 500)}...`;
          }
        }

        // Add blocks with event details if provided
        if (blocks && blocks.length > 0) {
          contextInfo += `\n\n--- CURRENT RECOMMENDATIONS (${blocks.length} venues) ---`;
          blocks.slice(0, 5).forEach((b, i) => {
            contextInfo += `\n${i+1}. ${b.name}${b.category ? ` (${b.category})` : ''}`;
            if (b.address) contextInfo += ` - ${b.address}`;
            if (b.estimated_distance_miles) contextInfo += ` - ${b.estimated_distance_miles} mi`;
            if (b.driveTimeMinutes) contextInfo += `, ${b.driveTimeMinutes} min`;
            if (b.estimated_earnings) contextInfo += `, $${b.estimated_earnings}/ride`;
            if (b.hasEvent && b.eventSummary) {
              contextInfo += `\n   🎉 EVENT: ${b.eventSummary.substring(0, 200)}...`;
            }
            if (b.proTips && b.proTips.length > 0) {
              contextInfo += `\n   💡 TIP: ${b.proTips[0]}`;
            }
          });
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
