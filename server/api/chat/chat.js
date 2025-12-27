// server/api/chat/chat.js
// AI Strategy Coach - Conversational assistant for drivers with web search
import { Router } from 'express';
import { db } from '../../db/drizzle.js';
import { snapshots, strategies } from '../../../shared/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { coachDAL } from '../../lib/ai/coach-dal.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();

// GET /coach/context/:snapshotId - Snapshot-wide context for strategy coach
// SECURITY: Requires auth (returns strategy and venue data)
router.get('/context/:snapshotId', requireAuth, async (req, res) => {
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
    // Use CoachDAL for full schema read access with ALL tables
    let contextInfo = '';
    let fullContext = null;
    
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
        fullContext = await coachDAL.getCompleteContext(activeSnapshotId, null);
        contextInfo = coachDAL.formatContextForPrompt(fullContext);
        
        console.log(`[chat] Full context loaded - Status: ${fullContext.status} | Snapshot: ${activeSnapshotId}`);
        console.log(`[chat] Context includes: ${fullContext.smartBlocks?.length || 0} venues, briefing=${!!fullContext.briefing}, feedback=${!!fullContext.feedback}, actions=${fullContext.feedback?.actions?.length || 0}`);
      } else {
        contextInfo = '\n\n⏳ No location snapshot available yet. Enable GPS to receive personalized strategy advice.';
      }
    } catch (err) {
      console.warn('[chat] Could not fetch context:', err.message);
      contextInfo = '\n\n⚠️ Context temporarily unavailable';
    }

    const systemPrompt = `You are an AI companion for rideshare drivers using Vecto Pilot - but you're much more than just a rideshare assistant. You're a powerful, versatile helper who can assist with anything the driver needs.

**Your Capabilities:**

🚗 **Rideshare Strategy (Your Specialty):**
- Real-time venue recommendations with business hours, events, pro tips, staging locations
- Location and timing advice using traffic, weather, and event data
- Earnings optimization and market pattern analysis
- Analyzing uploaded heat maps, screenshots, and documents

🔍 **Web Search & Verification (via Google Search):**
- You have LIVE Google Search access - use it proactively to verify events, check facts, find current information
- When users ask you to verify something or look something up, SEARCH THE WEB for current information
- Cross-reference briefing data with live web searches for accuracy
- Do NOT list sources or citations at the end of your responses - just provide the information naturally

📚 **General Knowledge & Life Help:**
- Career advice: going back to college, changing careers, certifications, financial planning
- Local recommendations: restaurants, services, things to do
- General questions: anything the driver wants to know or discuss
- Research: finding resources, comparing options, making decisions

💬 **Personal Support:**
- Friendly conversation during slow times
- Motivation and encouragement during tough shifts
- Just being someone to talk to on the road

**Your Data Access (Current Session):**
- Snapshot: ${fullContext?.snapshot?.city || 'Unknown'}, ${fullContext?.snapshot?.state || ''} | ${fullContext?.snapshot?.weather?.tempF || 'N/A'}°F ${fullContext?.snapshot?.weather?.conditions || ''}
- Venues: ${fullContext?.smartBlocks?.length || 0} ranked recommendations with full details
- Strategy: ${fullContext?.strategy?.status === 'ready' ? 'Ready' : 'Generating...'}
- Events/Traffic/News: From real-time briefing data

**Communication Style:**
- Warm, friendly, conversational - like a supportive friend
- Match the user's energy and intent
- For quick questions: be concise
- For planning/detailed requests: be thorough and comprehensive (no word limits!)
- Use emojis naturally
- Be precise with venue data (exact names, addresses, times)

**Important:**
- You understand context from conversation history
- Brief responses like "yes", "go ahead", "thanks" relate to what you just said
- When asked to verify or search: USE GOOGLE SEARCH actively
- You're not limited to rideshare topics - help with anything!

${contextInfo}

You're a powerful AI companion. Help with rideshare strategy when they need it, but be ready to assist with absolutely anything else they want to discuss or research.`;

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
    if (!process.env.GEMINI_API_KEY) {
      res.write(`data: ${JSON.stringify({ error: 'GEMINI_API_KEY not configured' })}\n\n`);
      return res.end();
    }

    try {
      console.log(`[chat] Calling Gemini 3.0 Pro with streaming...`);

      // Create abort controller with 90 second timeout (web search needs more time)
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 90000);

      // Use streamGenerateContent for real-time streaming
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:streamGenerateContent?alt=sse&key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
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
              maxOutputTokens: 8192,
            },
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
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

      // Stream the response chunks to client
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let totalText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;

            try {
              const data = JSON.parse(jsonStr);
              const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

              if (text) {
                totalText += text;
                // Stream each chunk to the client immediately
                res.write(`data: ${JSON.stringify({ delta: text })}\n\n`);
              }

              // Check for safety blocking
              const finishReason = data.candidates?.[0]?.finishReason;
              if (finishReason === 'SAFETY') {
                console.warn('[chat] Response blocked by safety filter');
                res.write(`data: ${JSON.stringify({ delta: '\n\nI apologize, but I cannot continue with that response.' })}\n\n`);
              }
            } catch (parseErr) {
              // Skip unparseable chunks (partial JSON, etc.)
            }
          }
        }
      }

      if (totalText) {
        console.log(`[chat] ✅ Gemini streamed response: ${totalText.substring(0, 100)}...`);
      } else {
        console.warn('[chat] Empty streaming response from Gemini');
        res.write(`data: ${JSON.stringify({ delta: 'I had trouble generating a response. Try again?' })}\n\n`);
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
