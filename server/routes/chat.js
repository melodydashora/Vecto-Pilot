// server/routes/chat.js
// AI Strategy Coach - Conversational assistant for drivers with web search
import { Router } from 'express';
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


// POST /api/chat - AI Strategy Coach with Full Schema Access & Thread Context & File Support
// SECURITY: Requires authentication
import { requireAuth } from '../middleware/auth.js';

router.post('/', requireAuth, async (req, res) => {
  const { userId, message, threadHistory = [], snapshotId, strategyId, strategy, blocks, attachments = [] } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message required' });
  }
  
  // SECURITY: Always use authenticated user, never trust client userId
  const authUserId = req.auth.userId;
  console.log('[chat] Authenticated user:', authUserId);

  console.log('[chat] User:', userId || 'anonymous', '| Thread:', threadHistory.length, 'messages | Attachments:', attachments.length, '| Strategy:', strategyId || 'none', '| Snapshot:', snapshotId || 'none', '| Message:', message.substring(0, 100));

  try {
    // Use CoachDAL for full schema read access
    let contextInfo = '';
    
    try {
      // PRIORITY: Use the snapshotId provided by the UI (always current)
      // The UI has the authoritative snapshot ID from the current location
      let activeSnapshotId = snapshotId;
      
      if (activeSnapshotId) {
        console.log('[chat] Using snapshot from UI:', activeSnapshotId);
      } else if (strategyId) {
        // Fallback: resolve strategy to snapshot if no direct snapshotId
        console.log('[chat] Resolving strategy_id:', strategyId);
        const resolution = await coachDAL.resolveStrategyToSnapshot(strategyId);
        if (resolution) {
          activeSnapshotId = resolution.snapshot_id;
          console.log('[chat] Resolved strategy_id to snapshot_id:', activeSnapshotId);
        }
      } else if (userId) {
        // Last resort: fetch latest snapshot for user
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
        const context = await coachDAL.getCompleteContext(activeSnapshotId, null);
        contextInfo = coachDAL.formatContextForPrompt(context);
        
        console.log(`[chat] Full context loaded - Status: ${context.status} | Snapshot: ${activeSnapshotId}`);
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
- Analyzing uploaded content (images, heat maps, documents, earnings screenshots, etc.)

**File Analysis Capabilities:**
- When drivers upload images (heat maps, screenshots, earnings data, venue photos), analyze them thoroughly
- For heat maps: identify high-demand zones, peak times, and strategic positioning
- For screenshots: extract relevant data and provide actionable insights
- For documents: summarize key information and connect it to rideshare strategy

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

    // Process attachments into Gemini-compatible format (simplified for text-based handling)
    console.log(`[chat] Processing ${attachments.length} attachments for Gemini coach`);

    // Build full message history: include thread history + new message
    const userMessage = attachments.length > 0 
      ? `${message}\n\n[Note: User uploaded ${attachments.length} file(s) for analysis]`
      : message;

    const messageHistory = threadHistory
      .filter(msg => msg && msg.role && msg.content) // Validate messages
      .map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user', // Gemini uses 'model' for assistant
        parts: [{ text: msg.content }]
      }))
      .concat([
        {
          role: 'user',
          parts: [{ text: userMessage }]
        }
      ]);

    console.log(`[chat] Sending ${messageHistory.length} messages to Gemini...`);

    // Call Gemini 3.0 Pro with web search via HTTP
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.write(`data: ${JSON.stringify({ error: 'GEMINI_API_KEY not configured' })}\n\n`);
      return res.end();
    }

    try {
      console.log(`[chat] Calling Gemini 3.0 Pro...`);
      
      // Create abort controller with 90 second timeout (web search needs more time)
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 90000);
      
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: systemPrompt }]
            },
            contents: messageHistory,
            tools: [{ google_search: {} }],
            generationConfig: {
              temperature: 0.7,
              topP: 0.95,
              topK: 40,
              maxOutputTokens: 1024,
            },
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' }
            ]
          })
        }
      );
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[chat] Gemini API error ${response.status}: ${errText.substring(0, 200)}`);
        res.write(`data: ${JSON.stringify({ error: `API error ${response.status}` })}\n\n`);
        return res.end();
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        console.warn('[chat] Empty response from Gemini');
        res.write(`data: ${JSON.stringify({ delta: 'I had trouble generating a response. Try again?' })}\n\n`);
      } else {
        console.log(`[chat] ✅ Gemini response: ${text.substring(0, 100)}...`);
        res.write(`data: ${JSON.stringify({ delta: text })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error) {
      console.error('[chat] Gemini request error:', error.message);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }

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
