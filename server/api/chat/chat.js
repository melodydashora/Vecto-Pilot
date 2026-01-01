// server/api/chat/chat.js
// AI Strategy Coach - Conversational assistant for drivers with web search
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { db } from '../../db/drizzle.js';
import { snapshots, strategies } from '../../../shared/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { coachDAL } from '../../lib/ai/coach-dal.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// ACTION PARSING HELPERS
// Parse special action tags from AI responses and execute them
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse all special action tags from AI response
 * Returns actions to execute and cleaned response text
 */
function parseActions(responseText) {
  const actions = {
    notes: [],
    events: [],
    news: [],
    systemNotes: []
  };

  // Pattern: [ACTION_TYPE: {...json...}]
  const patterns = [
    { type: 'note', regex: /\[SAVE_NOTE:\s*(\{[^}]+\})\]/g, key: 'notes' },
    { type: 'event', regex: /\[DEACTIVATE_EVENT:\s*(\{[^}]+\})\]/g, key: 'events' },
    { type: 'news', regex: /\[DEACTIVATE_NEWS:\s*(\{[^}]+\})\]/g, key: 'news' },
    { type: 'system', regex: /\[SYSTEM_NOTE:\s*(\{[^}]+\})\]/g, key: 'systemNotes' }
  ];

  let cleanedText = responseText;

  for (const { regex, key } of patterns) {
    let match;
    while ((match = regex.exec(responseText)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        actions[key].push(parsed);
        // Remove the action tag from visible response
        cleanedText = cleanedText.replace(match[0], '');
      } catch (e) {
        console.warn(`[chat] Failed to parse ${key} action:`, match[1]);
      }
    }
  }

  return { actions, cleanedText: cleanedText.trim() };
}

/**
 * Execute parsed actions asynchronously (non-blocking)
 */
async function executeActions(actions, userId, snapshotId, conversationId) {
  const results = { saved: 0, errors: [] };

  // Save user notes
  for (const note of actions.notes) {
    try {
      await coachDAL.saveUserNote({
        user_id: userId,
        snapshot_id: snapshotId,
        note_type: note.type || 'insight',
        title: note.title || null,
        content: note.content,
        importance: note.importance || 50,
        confidence: 80,
        created_by: 'ai_coach'
      });
      results.saved++;
      console.log(`[chat/actions] Saved note: ${note.title || 'untitled'}`);
    } catch (e) {
      results.errors.push(`Note: ${e.message}`);
    }
  }

  // Deactivate events
  for (const event of actions.events) {
    try {
      await coachDAL.deactivateEvent({
        user_id: userId,
        event_title: event.event_title,
        reason: event.reason,
        notes: event.notes,
        deactivated_by: 'ai_coach'
      });
      results.saved++;
      console.log(`[chat/actions] Deactivated event: ${event.event_title}`);
    } catch (e) {
      results.errors.push(`Event: ${e.message}`);
    }
  }

  // Deactivate news
  for (const news of actions.news) {
    try {
      await coachDAL.deactivateNews({
        user_id: userId,
        news_title: news.news_title,
        reason: news.reason,
        deactivated_by: 'ai_coach'
      });
      results.saved++;
      console.log(`[chat/actions] Deactivated news: ${news.news_title}`);
    } catch (e) {
      results.errors.push(`News: ${e.message}`);
    }
  }

  // Save system notes
  for (const sysNote of actions.systemNotes) {
    try {
      await coachDAL.saveSystemNote({
        note_type: sysNote.type || 'pain_point',
        category: sysNote.category || 'general',
        title: sysNote.title,
        description: sysNote.description,
        user_quote: sysNote.user_quote,
        triggering_user_id: userId,
        triggering_conversation_id: conversationId,
        triggering_snapshot_id: snapshotId
      });
      results.saved++;
      console.log(`[chat/actions] Saved system note: ${sysNote.title}`);
    } catch (e) {
      results.errors.push(`SystemNote: ${e.message}`);
    }
  }

  if (results.errors.length > 0) {
    console.warn(`[chat/actions] ${results.errors.length} errors:`, results.errors);
  }

  return results;
}

// POST /api/chat/notes - Save a coach note about the user
// SECURITY: Requires auth
router.post('/notes', requireAuth, async (req, res) => {
  const { note_type, title, content, context, importance, snapshot_id, market_slug } = req.body;
  const userId = req.auth.userId;

  if (!content) {
    return res.status(400).json({ error: 'content required' });
  }

  try {
    const note = await coachDAL.saveUserNote({
      user_id: userId,
      snapshot_id: snapshot_id || null,
      note_type: note_type || 'insight',
      title: title || null,
      content,
      context: context || null,
      market_slug: market_slug || null,
      importance: importance || 50,
      confidence: 80,
      created_by: 'ai_coach'
    });

    if (note) {
      console.log(`[chat/notes] Saved note ${note.id} for user ${userId}`);
      res.json({ success: true, note_id: note.id });
    } else {
      res.status(500).json({ error: 'Failed to save note' });
    }
  } catch (error) {
    console.error('[chat/notes] Error saving note:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/chat/notes - Get user's coach notes
// SECURITY: Requires auth
router.get('/notes', requireAuth, async (req, res) => {
  const userId = req.auth.userId;
  const limit = parseInt(req.query.limit) || 20;

  try {
    const notes = await coachDAL.getUserNotes(userId, limit);
    res.json({ notes, count: notes.length });
  } catch (error) {
    console.error('[chat/notes] Error fetching notes:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/chat/notes/:noteId - Delete a coach note
// SECURITY: Requires auth
router.delete('/notes/:noteId', requireAuth, async (req, res) => {
  const { noteId } = req.params;
  const userId = req.auth.userId;

  try {
    const { user_intel_notes } = await import('../../../shared/schema.js');
    const { and, eq } = await import('drizzle-orm');

    // Soft delete - set is_active = false
    const result = await db
      .update(user_intel_notes)
      .set({ is_active: false, updated_at: new Date() })
      .where(and(
        eq(user_intel_notes.id, noteId),
        eq(user_intel_notes.user_id, userId)
      ))
      .returning({ id: user_intel_notes.id });

    if (result.length > 0) {
      res.json({ success: true, deleted: noteId });
    } else {
      res.status(404).json({ error: 'Note not found or not authorized' });
    }
  } catch (error) {
    console.error('[chat/notes] Error deleting note:', error);
    res.status(500).json({ error: error.message });
  }
});

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
// SECURITY: requireAuth enforces user must be signed in
router.post('/', requireAuth, async (req, res) => {
  const { userId, message, threadHistory = [], snapshotId, strategyId, strategy, blocks, attachments = [], conversationId: clientConversationId } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message required' });
  }

  // Use authenticated user if available, otherwise use provided userId or 'anonymous'
  const authUserId = req.auth?.userId || userId || 'anonymous';
  const isAuthenticated = authUserId !== 'anonymous';

  // Generate or use existing conversation_id for thread tracking
  const conversationId = clientConversationId || randomUUID();

  console.log('[chat] User:', authUserId, isAuthenticated ? '(authenticated)' : '(anonymous)', '| Conversation:', conversationId.slice(0, 8));
  console.log('[chat] Thread:', threadHistory.length, 'messages | Attachments:', attachments.length, '| Strategy:', strategyId || 'none', '| Snapshot:', snapshotId || 'none', '| Message:', message.substring(0, 100));

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
      // Pass authenticated user ID for driver profile lookup (in case snapshot has different/null user_id)
      if (activeSnapshotId) {
        fullContext = await coachDAL.getCompleteContext(activeSnapshotId, null, authUserId !== 'anonymous' ? authUserId : null);
        contextInfo = coachDAL.formatContextForPrompt(fullContext);

        console.log(`[chat] Full context loaded - Status: ${fullContext.status} | Snapshot: ${activeSnapshotId}`);
        console.log(`[chat] Context includes: ${fullContext.smartBlocks?.length || 0} venues, briefing=${!!fullContext.briefing}, driverProfile=${!!fullContext.driverProfile}, vehicle=${!!fullContext.driverVehicle}`);
      } else {
        contextInfo = '\n\n⏳ No location snapshot available yet. Enable GPS to receive personalized strategy advice.';
      }

      // Add snapshot history for authenticated users (last 10 sessions)
      let snapshotHistoryInfo = '';
      if (isAuthenticated) {
        try {
          const history = await coachDAL.getSnapshotHistory(authUserId, 10);
          if (history && history.length > 0) {
            fullContext = fullContext || {};
            fullContext.snapshotHistory = history;

            snapshotHistoryInfo = `\n\n📍 **Recent Session History (${history.length} sessions):**\n`;
            for (const snap of history.slice(0, 5)) {
              const date = new Date(snap.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
              const time = new Date(snap.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
              snapshotHistoryInfo += `- ${date} ${time}: ${snap.city}, ${snap.state}${snap.holiday ? ` (${snap.holiday})` : ''}\n`;
            }
          }
        } catch (e) {
          console.warn('[chat] Failed to load snapshot history:', e.message);
        }
      }
    } catch (err) {
      console.warn('[chat] Could not fetch context:', err.message);
      contextInfo = '\n\n⚠️ Context temporarily unavailable';
    }

    // Track active snapshot ID for conversation persistence
    let activeSnapshotId = snapshotId || null;

    // Save user message to coach_conversations (non-blocking, authenticated users only)
    let userMessageId = null;
    if (isAuthenticated) {
      try {
        const userMsg = await coachDAL.saveConversationMessage({
          user_id: authUserId,
          snapshot_id: activeSnapshotId,
          conversation_id: conversationId,
          role: 'user',
          content: message,
          content_type: attachments.length > 0 ? 'text+attachment' : 'text',
          location_context: fullContext?.snapshot ? {
            city: fullContext.snapshot.city,
            state: fullContext.snapshot.state,
            country: fullContext.snapshot.country
          } : null,
          time_context: {
            local_time: new Date().toISOString(),
            daypart: fullContext?.snapshot?.time_of_day || null
          }
        });
        userMessageId = userMsg?.id;
      } catch (e) {
        console.warn('[chat] Failed to save user message:', e.message);
      }
    }

    const systemPrompt = `You are an AI companion for rideshare drivers using Vecto Pilot - but you're much more than just a rideshare assistant. You're a powerful, versatile helper who can assist with anything the driver needs.

**Your Capabilities:**

🚗 **Rideshare Strategy (Your Specialty):**
- Real-time venue recommendations with business hours, events, pro tips, staging locations
- Location and timing advice using traffic, weather, and event data
- Earnings optimization and market pattern analysis
- Analyzing uploaded heat maps, screenshots, and documents

🧠 **Market Intelligence (NEW - Your Knowledge Base):**
- You have access to RESEARCH-BACKED market intelligence including:
  • The Gravity Model: How Core/Satellite/Rural markets work
  • Deadhead risk calculation and avoidance strategies
  • Ant vs Sniper strategies for different market densities
  • Algorithm mechanics: Upfront Pricing, Area Preferences, Heatmaps
  • Market-specific insights for major metros (LA, SF, Phoenix, DFW, Miami, Atlanta, Houston, etc.)
  • Zone intelligence: Honey holes, dead zones, danger zones
  • Optimal timing windows by market type
- Reference this intelligence naturally when giving advice
- The driver's market position (Core/Satellite/Rural) affects your recommendations

📝 **Personal Notes (Your Memory):**
- You can save notes about this driver to personalize future advice
- To save a note, include in your response:
  \`[SAVE_NOTE: {"type": "preference|insight|tip|feedback|pattern", "title": "Short title", "content": "What you learned", "importance": 1-100}]\`
- Note types:
  • preference: Their driving preferences (times, areas, goals)
  • insight: Something you learned about their situation
  • tip: A personalized tip you discovered for them
  • feedback: Their feedback on your advice
  • pattern: A pattern you noticed in their questions/behavior
- Your previous notes about this driver are shown in context below
- USE NOTES to give increasingly personalized advice over time!

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
- Driver: ${fullContext?.driverProfile ? `${fullContext.driverProfile.first_name} ${fullContext.driverProfile.last_name}` : 'Unknown'} ${fullContext?.driverVehicle ? `driving ${fullContext.driverVehicle.year} ${fullContext.driverVehicle.make} ${fullContext.driverVehicle.model}` : ''}
- Home: ${fullContext?.driverProfile?.city || 'Unknown'}, ${fullContext?.driverProfile?.state_territory || ''}
- Snapshot: ${fullContext?.snapshot?.city || 'Unknown'}, ${fullContext?.snapshot?.state || ''} | ${fullContext?.snapshot?.weather?.tempF || 'N/A'}°F ${fullContext?.snapshot?.weather?.conditions || ''}
- Venues: ${fullContext?.smartBlocks?.length || 0} ranked recommendations with full details
- Strategy: ${fullContext?.strategy?.status === 'ready' ? 'Ready' : 'Generating...'}
- Events/Traffic/News: From real-time briefing data
- Market Intel: ${fullContext?.marketIntelligence?.intelligence?.length || 0} research items
- Your Notes: ${fullContext?.userNotes?.length || 0} saved about this driver
- Market Position: ${fullContext?.marketIntelligence?.marketPosition?.region_type || 'Unknown'} (${fullContext?.marketIntelligence?.marketPosition?.market_anchor || 'Unknown market'})
- Session History: ${fullContext?.snapshotHistory?.length || 0} recent sessions (you can reference where they've driven before)
${snapshotHistoryInfo}

**Communication Style:**
- Warm, friendly, conversational - like a supportive friend
- Match the user's energy and intent
- For quick questions: be concise
- For planning/detailed requests: be thorough and comprehensive (no word limits!)
- Use emojis naturally
- Be precise with venue data (exact names, addresses, times)
- Reference market intelligence naturally (e.g., "Since you're in a Satellite market...")

📋 **Event Verification & Deactivation:**
- When a driver reports an event is over, cancelled, or has incorrect times, you can mark it for removal
- To deactivate an event, format your response with:
  \`[DEACTIVATE_EVENT: {"event_title": "Event Name", "reason": "your reason here", "notes": "Optional explanation"}]\`
- Suggested reasons: event_ended, incorrect_time, cancelled, no_longer_relevant, duplicate
- You can also use your own reason if none of these fit
- If times are wrong, include the correct times in notes (e.g., "Actually starts at 8pm not 7pm")

📰 **News Article Deactivation:**
- When a driver reports news is outdated, irrelevant, or incorrect, you can hide it for them
- To deactivate a news item, format your response with:
  \`[DEACTIVATE_NEWS: {"news_title": "Article Title", "reason": "your reason here"}]\`
- Suggested reasons: outdated (article from weeks/months ago), already_resolved, incorrect_info, not_relevant_to_area, duplicate
- You can also use your own reason based on what the driver tells you (e.g., "I only drive Lyft")

📊 **System Observations:**
- When you notice pain points, feature requests, or patterns from user interactions, save them
- Format: \`[SYSTEM_NOTE: {"type": "feature_request|pain_point|bug_report|aha_moment", "category": "ui|strategy|briefing|venues|coach|map|earnings", "title": "Short title", "description": "What you observed", "user_quote": "Optional verbatim quote"}]\`
- This helps the development team improve Vecto Pilot based on real user needs

**Important:**
- You understand context from conversation history
- Brief responses like "yes", "go ahead", "thanks" relate to what you just said
- When asked to verify or search: USE GOOGLE SEARCH actively
- You're not limited to rideshare topics - help with anything!
- SAVE NOTES when you learn something useful about the driver!
- Reference your market knowledge to give smarter, research-backed advice

${contextInfo}

You're a powerful AI companion with research-backed market intelligence and persistent memory. Help with rideshare strategy when they need it, but be ready to assist with absolutely anything else they want to discuss or research.`;

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

        // Parse actions and execute them (non-blocking)
        const { actions, cleanedText } = parseActions(totalText);
        const hasActions = Object.values(actions).some(arr => arr.length > 0);

        if (hasActions) {
          console.log(`[chat] Found actions: notes=${actions.notes.length}, events=${actions.events.length}, news=${actions.news.length}, systemNotes=${actions.systemNotes.length}`);

          // Execute actions asynchronously (don't wait for completion)
          executeActions(actions, authUserId, activeSnapshotId, conversationId)
            .then(result => {
              if (result.saved > 0) {
                console.log(`[chat] ✅ Executed ${result.saved} actions`);
              }
            })
            .catch(e => console.error('[chat] Action execution error:', e.message));
        }

        // Save assistant response to coach_conversations (authenticated users only)
        if (isAuthenticated) {
          try {
            // Extract tips from response using CoachDAL
            const extractedTips = await coachDAL.extractAndSaveTips(authUserId, cleanedText, {
              snapshot_id: activeSnapshotId,
              conversation_id: conversationId
            });

            await coachDAL.saveConversationMessage({
              user_id: authUserId,
              snapshot_id: activeSnapshotId,
              conversation_id: conversationId,
              parent_message_id: userMessageId,
              role: 'assistant',
              content: cleanedText,
              content_type: 'text',
              extracted_tips: extractedTips?.tips || [],
              model_used: 'gemini-3-pro-preview',
              location_context: fullContext?.snapshot ? {
                city: fullContext.snapshot.city,
                state: fullContext.snapshot.state,
                country: fullContext.snapshot.country
              } : null
            });
          } catch (e) {
            console.warn('[chat] Failed to save assistant message:', e.message);
          }
        }
      } else {
        console.warn('[chat] Empty streaming response from Gemini');
        res.write(`data: ${JSON.stringify({ delta: 'I had trouble generating a response. Try again?' })}\n\n`);
      }

      // Send done event with conversation_id for client to continue thread
      res.write(`data: ${JSON.stringify({ done: true, conversation_id: conversationId })}\n\n`);
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

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSATION HISTORY ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/chat/conversations - List all conversations for the user
// SECURITY: Requires auth
router.get('/conversations', requireAuth, async (req, res) => {
  const userId = req.auth.userId;
  const limit = parseInt(req.query.limit) || 20;

  try {
    const conversations = await coachDAL.getConversations(userId, limit);
    res.json({ conversations, count: conversations.length });
  } catch (error) {
    console.error('[chat/conversations] Error fetching conversations:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/chat/conversations/:conversationId - Get messages for a specific conversation
// SECURITY: Requires auth
router.get('/conversations/:conversationId', requireAuth, async (req, res) => {
  const userId = req.auth.userId;
  const { conversationId } = req.params;
  const limit = parseInt(req.query.limit) || 100;

  try {
    const messages = await coachDAL.getConversationHistory(userId, conversationId, limit);
    res.json({ conversation_id: conversationId, messages, count: messages.length });
  } catch (error) {
    console.error('[chat/conversations] Error fetching conversation history:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/chat/conversations/:conversationId/star - Toggle star on a message
// SECURITY: Requires auth
router.post('/conversations/:messageId/star', requireAuth, async (req, res) => {
  const { messageId } = req.params;
  const { starred } = req.body;

  try {
    const result = await coachDAL.toggleMessageStar(messageId, starred !== false);
    if (result) {
      res.json({ success: true, message_id: messageId, starred: result.is_starred });
    } else {
      res.status(404).json({ error: 'Message not found' });
    }
  } catch (error) {
    console.error('[chat/conversations] Error toggling star:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/chat/history - Get all conversation history for current user
// SECURITY: Requires auth
router.get('/history', requireAuth, async (req, res) => {
  const userId = req.auth.userId;
  const limit = parseInt(req.query.limit) || 100;

  try {
    const messages = await coachDAL.getConversationHistory(userId, null, limit);
    res.json({ messages, count: messages.length });
  } catch (error) {
    console.error('[chat/history] Error fetching history:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM NOTES ENDPOINTS (for admin review)
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/chat/system-notes - Get system notes (AI observations about improvements)
// SECURITY: Requires auth (consider making admin-only in production)
router.get('/system-notes', requireAuth, async (req, res) => {
  const status = req.query.status || null; // 'new', 'reviewed', 'planned', 'implemented'
  const limit = parseInt(req.query.limit) || 50;

  try {
    const notes = await coachDAL.getSystemNotes(status, limit);
    res.json({ notes, count: notes.length });
  } catch (error) {
    console.error('[chat/system-notes] Error fetching system notes:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// NEWS/EVENT DEACTIVATION ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/chat/deactivate-news - Manually deactivate a news item
// SECURITY: Requires auth
router.post('/deactivate-news', requireAuth, async (req, res) => {
  const userId = req.auth.userId;
  const { news_title, news_source, reason } = req.body;

  if (!news_title) {
    return res.status(400).json({ error: 'news_title required' });
  }

  try {
    const result = await coachDAL.deactivateNews({
      user_id: userId,
      news_title,
      news_source: news_source || null,
      reason: reason || 'User requested removal',
      deactivated_by: 'user'
    });

    if (result) {
      res.json({ success: true, deactivation_id: result.id });
    } else {
      res.status(500).json({ error: 'Failed to deactivate news' });
    }
  } catch (error) {
    console.error('[chat/deactivate-news] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/chat/deactivated-news - Get list of deactivated news hashes for user
// SECURITY: Requires auth
router.get('/deactivated-news', requireAuth, async (req, res) => {
  const userId = req.auth.userId;

  try {
    const hashes = await coachDAL.getDeactivatedNewsHashes(userId);
    res.json({ hashes, count: hashes.length });
  } catch (error) {
    console.error('[chat/deactivated-news] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/chat/deactivate-event - Manually deactivate an event
// SECURITY: Requires auth
router.post('/deactivate-event', requireAuth, async (req, res) => {
  const userId = req.auth.userId;
  const { event_title, reason, notes } = req.body;

  if (!event_title) {
    return res.status(400).json({ error: 'event_title required' });
  }

  try {
    const result = await coachDAL.deactivateEvent({
      user_id: userId,
      event_title,
      reason: reason || 'User requested removal',
      notes: notes || null,
      deactivated_by: 'user'
    });

    if (result) {
      res.json({ success: true, message: 'Event deactivated' });
    } else {
      res.status(500).json({ error: 'Failed to deactivate event' });
    }
  } catch (error) {
    console.error('[chat/deactivate-event] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SNAPSHOT HISTORY ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/chat/snapshot-history - Get user's location snapshot history
// SECURITY: Requires auth
router.get('/snapshot-history', requireAuth, async (req, res) => {
  const userId = req.auth.userId;
  const limit = parseInt(req.query.limit) || 20;

  try {
    const history = await coachDAL.getSnapshotHistory(userId, limit);
    res.json({ snapshots: history, count: history.length });
  } catch (error) {
    console.error('[chat/snapshot-history] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
