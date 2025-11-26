// server/routes/chat.js
// AI Strategy Coach - Conversational assistant for drivers
import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db/drizzle.js';
import { snapshots, strategies } from '../../shared/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { coachDAL } from '../lib/coach-dal.js';

const router = Router();

// GET /coach/context/:snapshotId - Snapshot-wide context for strategy coach
router.get('/context/:snapshotId', async (req, res) => {
  const { snapshotId } = req.params;
  
  console.log('[coach] Fetching context for snapshot:', snapshotId);
  
  try {
    // Use CoachDAL for read-only access
    const context = await coachDAL.getCompleteContext(snapshotId);
    
    res.json({
      snapshot_id: snapshotId,
      status: context.status,
      snapshot: context.snapshot,
      strategy: context.strategy,
      briefing: context.briefing,
      smart_blocks: context.smartBlocks,
      count: context.smartBlocks.length,
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

// POST /api/chat - AI Strategy Coach with Full Schema Access & Thread Context
router.post('/', async (req, res) => {
  const { userId, message, threadHistory = [], snapshotId, strategyId, strategy, blocks } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message required' });
  }

  console.log('[chat] User:', userId || 'anonymous', '| Thread:', threadHistory.length, 'messages | Strategy:', strategyId || 'none', '| Snapshot:', snapshotId || 'none', '| Message:', message.substring(0, 100));

  try {
    // Use CoachDAL for full schema read access
    let contextInfo = '';
    
    try {
      // Entry point: strategyId (from UI) → snapshotId → full schema access
      // Fallback: direct snapshotId or latest snapshot for user
      let activeSnapshotId = snapshotId;
      
      if (!activeSnapshotId && strategyId) {
        console.log('[chat] Resolving strategy_id:', strategyId);
        const resolution = await coachDAL.resolveStrategyToSnapshot(strategyId);
        if (resolution) {
          activeSnapshotId = resolution.snapshot_id;
          console.log('[chat] Resolved strategy_id to snapshot_id:', activeSnapshotId);
        }
      }
      
      if (!activeSnapshotId && userId) {
        const [latestSnap] = await db
          .select({ snapshot_id: snapshots.snapshot_id })
          .from(snapshots)
          .where(eq(snapshots.user_id, userId))
          .orderBy(desc(snapshots.created_at))
          .limit(1);
        
        if (latestSnap) {
          activeSnapshotId = latestSnap.snapshot_id;
          console.log('[chat] Using latest snapshot for user:', activeSnapshotId);
        }
      }

      // Get COMPLETE context using CoachDAL (full schema access)
      if (activeSnapshotId) {
        const context = await coachDAL.getCompleteContext(activeSnapshotId, strategyId);
        contextInfo = coachDAL.formatContextForPrompt(context);
        
        console.log(`[chat] Full context loaded - Status: ${context.status}`);
      } else {
        contextInfo = '\n\n⏳ No location snapshot available yet. Enable GPS to receive personalized strategy advice.';
      }
    } catch (err) {
      console.warn('[chat] Could not fetch context:', err.message);
      contextInfo = '\n\n⚠️ Context temporarily unavailable';
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

**Conversation Context:**
- You have full access to the conversation history with this driver
- When the driver says "yes", "no", "go ahead", "thank you" or similar brief responses, understand them in context of what you just asked or suggested
- Example: If you asked "Would you like tips for the airport?", the driver saying "yes" means they want airport tips
- Be natural and conversational - don't repeat back what they said or ask for clarification

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

    // Build full message history: include thread history + new message
    const messageHistory = threadHistory
      .filter(msg => msg && msg.role && msg.content) // Validate messages
      .map(msg => ({
        role: msg.role,
        content: msg.content
      }))
      .concat([
        {
          role: 'user',
          content: message
        }
      ]);

    console.log(`[chat] Sending ${messageHistory.length} messages to Claude (thread + current)`);

    // Stream response from Claude
    const stream = await anthropic.messages.stream({
      model: process.env.CLAUDE_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      temperature: 0.7,
      system: systemPrompt,
      messages: messageHistory
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
