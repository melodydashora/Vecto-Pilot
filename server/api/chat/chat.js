// server/api/chat/chat.js
// AI Coach - Conversational assistant for drivers with web search
// Updated 2026-01-05: Added schema awareness and action validation
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { appendFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../../db/drizzle.js';
import { snapshots, strategies, driver_profiles } from '../../../shared/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { rideshareCoachDAL } from '../../lib/ai/rideshare-coach-dal.js';
import { requireAuth } from '../../middleware/auth.js';
import { validateAction } from '../rideshare-coach/validate.js';
// @ts-ignore
import { getEnhancedProjectContext } from '../../agent/enhanced-context.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// ACTION PARSING HELPERS
// Parse special action tags from AI responses and execute them
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse AI actions from response text
 * 2026-01-06: P1-B fix - Improved to handle nested JSON properly
 *
 * Supports two formats:
 * 1. Legacy inline: [SAVE_NOTE: {...}] (kept for backward compat)
 * 2. JSON envelope: ```json\n{"actions": [...], "response": "..."}\n``` (preferred)
 */
function parseActions(responseText) {
  const actions = {
    notes: [],
    events: [],
    news: [],
    systemNotes: [],
    zoneIntel: [],
    eventReactivations: [],
    addEvents: [],       // 2026-02-17: Coach-created events from driver intel
    updateEvents: [],    // 2026-02-17: Coach-corrected event details
    coachMemos: [],      // 2026-02-17: Coach-to-Claude Code bridge memos (writes to file)
    marketIntel: [],     // 2026-03-18: C-3 — market-wide intelligence from driver conversations
    venueIntel: []       // 2026-03-18: C-3 — staging spots, GPS dead zones, venue intel
  };

  let cleanedText = responseText;

  // 2026-03-18: FIX (H-3) — Match only JSON blocks containing "actions" array.
  // Previous regex captured the first ```json block, which could be a code example.
  const jsonEnvelopeMatch = responseText.match(/```json\s*([\s\S]*?"actions"\s*:\s*\[[\s\S]*?)\s*```/);
  if (jsonEnvelopeMatch) {
    try {
      const envelope = JSON.parse(jsonEnvelopeMatch[1]);
      if (envelope.actions && Array.isArray(envelope.actions)) {
        for (const action of envelope.actions) {
          const actionType = action.type?.toUpperCase();
          const actionData = action.data || action;

          if (actionType === 'SAVE_NOTE') actions.notes.push(actionData);
          else if (actionType === 'DEACTIVATE_EVENT') actions.events.push(actionData);
          else if (actionType === 'REACTIVATE_EVENT') actions.eventReactivations.push(actionData);
          else if (actionType === 'ADD_EVENT') actions.addEvents.push(actionData);
          else if (actionType === 'UPDATE_EVENT') actions.updateEvents.push(actionData);
          else if (actionType === 'COACH_MEMO') actions.coachMemos.push(actionData);
          else if (actionType === 'DEACTIVATE_NEWS') actions.news.push(actionData);
          else if (actionType === 'SYSTEM_NOTE') actions.systemNotes.push(actionData);
          else if (actionType === 'ZONE_INTEL') actions.zoneIntel.push(actionData);
          else if (actionType === 'MARKET_INTEL') actions.marketIntel.push(actionData);
          else if (actionType === 'SAVE_VENUE_INTEL') actions.venueIntel.push(actionData);
        }
        // Use the response field if present, otherwise remove the JSON block
        cleanedText = envelope.response || responseText.replace(jsonEnvelopeMatch[0], '').trim();
        console.log(`[chat] Parsed JSON envelope: ${envelope.actions.length} actions`);
        return { actions, cleanedText };
      }
    } catch (e) {
      console.warn(`[chat] JSON envelope parse failed, falling back to regex:`, e.message);
    }
  }

  // 2026-01-06: Improved regex-based parsing with proper JSON extraction
  // Uses balanced brace matching instead of [^}]+ which breaks on nested JSON
  const actionTypes = [
    { prefix: 'SAVE_NOTE', key: 'notes' },
    { prefix: 'DEACTIVATE_EVENT', key: 'events' },
    { prefix: 'REACTIVATE_EVENT', key: 'eventReactivations' },
    { prefix: 'ADD_EVENT', key: 'addEvents' },
    { prefix: 'UPDATE_EVENT', key: 'updateEvents' },
    { prefix: 'COACH_MEMO', key: 'coachMemos' },
    { prefix: 'DEACTIVATE_NEWS', key: 'news' },
    { prefix: 'SYSTEM_NOTE', key: 'systemNotes' },
    { prefix: 'ZONE_INTEL', key: 'zoneIntel' },
    { prefix: 'MARKET_INTEL', key: 'marketIntel' },
    { prefix: 'SAVE_VENUE_INTEL', key: 'venueIntel' }
  ];

  for (const { prefix, key } of actionTypes) {
    // Find all instances of [PREFIX: {...]
    const pattern = new RegExp(`\\[${prefix}:\\s*`, 'g');
    let match;

    while ((match = pattern.exec(responseText)) !== null) {
      const startIndex = match.index + match[0].length;
      const jsonResult = extractBalancedJson(responseText, startIndex);

      if (!jsonResult.json) {
        // 2026-03-18: FIX (M-3) — Log when AI generates malformed action tags
        console.warn(`[chat] ⚠️ ${prefix} action tag found but JSON extraction failed (malformed/unclosed braces)`);
      } else {
        try {
          const parsed = JSON.parse(jsonResult.json);
          actions[key].push(parsed);
          // Build the full match to remove (include closing bracket)
          const fullMatch = responseText.slice(match.index, jsonResult.endIndex + 1);
          // 2026-03-18: FIX (M-2) — replaceAll so duplicate tags are both removed
          cleanedText = cleanedText.replaceAll(fullMatch, '');
        } catch (e) {
          console.warn(`[chat] Failed to parse ${key} JSON:`, e.message);
        }
      }
    }
  }

  return { actions, cleanedText: cleanedText.trim() };
}

/**
 * Extract balanced JSON from string starting at given index
 * Handles nested braces correctly
 */
function extractBalancedJson(str, startIndex) {
  if (str[startIndex] !== '{') {
    return { json: null, endIndex: startIndex };
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < str.length; i++) {
    const char = str[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\' && inString) {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) {
          // Check for closing bracket ]
          let endIndex = i;
          const remaining = str.slice(i + 1);
          const closeBracket = remaining.match(/^\s*\]/);
          if (closeBracket) {
            endIndex = i + closeBracket[0].length;
          }
          return {
            json: str.slice(startIndex, i + 1),
            endIndex
          };
        }
      }
    }
  }

  return { json: null, endIndex: str.length };
}

/**
 * Execute parsed actions asynchronously (non-blocking)
 */
async function executeActions(actions, userId, snapshotId, conversationId) {
  const results = { saved: 0, errors: [] };

  // Save user notes (with validation)
  for (const note of actions.notes) {
    try {
      // 2026-01-05: Validate before execution
      const validation = validateAction('SAVE_NOTE', {
        note_type: note.type || 'insight',
        title: note.title || 'Untitled note',
        content: note.content,
        importance: note.importance || 50
      });
      if (!validation.ok) {
        results.errors.push(`Note validation: ${validation.errors.map(e => e.message).join(', ')}`);
        continue;
      }

      // 2026-03-18: Check return value — DAL returns null on failure
      const noteResult = await rideshareCoachDAL.saveUserNote({
        user_id: userId,
        snapshot_id: snapshotId,
        note_type: validation.data.note_type,
        title: validation.data.title,
        content: validation.data.content,
        importance: validation.data.importance,
        confidence: 80,
        created_by: 'ai_coach'
      });
      if (noteResult) {
        results.saved++;
        console.log(`[chat/actions] Saved note: ${validation.data.title}`);
      } else {
        results.errors.push(`Note "${validation.data.title}": write returned null`);
      }
    } catch (e) {
      results.errors.push(`Note: ${e.message}`);
    }
  }

  // Deactivate events (with validation)
  for (const event of actions.events) {
    try {
      // 2026-01-05: Validate before execution
      const validation = validateAction('DEACTIVATE_EVENT', {
        event_title: event.event_title,
        reason: event.reason || 'other',
        notes: event.notes
      });
      if (!validation.ok) {
        results.errors.push(`Event validation: ${validation.errors.map(e => e.message).join(', ')}`);
        continue;
      }

      const deactResult = await rideshareCoachDAL.deactivateEvent({
        user_id: userId,
        event_title: validation.data.event_title,
        reason: validation.data.reason,
        notes: validation.data.notes,
        deactivated_by: 'ai_coach',
        snapshot_id: snapshotId
      });
      if (deactResult) {
        results.saved++;
        console.log(`[chat/actions] Deactivated event: ${validation.data.event_title}`);
      } else {
        results.errors.push(`DeactivateEvent "${validation.data.event_title}": write returned null`);
      }
    } catch (e) {
      results.errors.push(`Event: ${e.message}`);
    }
  }

  // Reactivate events (undo mistaken deactivations)
  // 2026-03-18: Added Zod validation (H-1) and null-return check (C-2)
  for (const event of actions.eventReactivations) {
    try {
      const validation = validateAction('REACTIVATE_EVENT', {
        event_title: event.event_title,
        reason: event.reason,
        notes: event.notes
      });
      if (!validation.ok) {
        results.errors.push(`ReactivateEvent validation: ${validation.errors.map(e => e.message).join(', ')}`);
        continue;
      }

      const reactResult = await rideshareCoachDAL.reactivateEvent({
        user_id: userId,
        event_title: validation.data.event_title,
        reason: validation.data.reason,
        notes: validation.data.notes,
        reactivated_by: 'ai_coach',
        snapshot_id: snapshotId
      });
      if (reactResult) {
        results.saved++;
        console.log(`[chat/actions] Reactivated event: ${validation.data.event_title}`);
      } else {
        results.errors.push(`ReactivateEvent "${validation.data.event_title}": write returned null`);
      }
    } catch (e) {
      results.errors.push(`EventReactivation: ${e.message}`);
    }
  }

  // Deactivate news
  // 2026-03-18: Added Zod validation (H-1) and null-return check (C-2)
  for (const news of actions.news) {
    try {
      const validation = validateAction('DEACTIVATE_NEWS', {
        news_title: news.news_title,
        reason: news.reason
      });
      if (!validation.ok) {
        results.errors.push(`DeactivateNews validation: ${validation.errors.map(e => e.message).join(', ')}`);
        continue;
      }

      const newsResult = await rideshareCoachDAL.deactivateNews({
        user_id: userId,
        news_title: validation.data.news_title,
        reason: validation.data.reason,
        deactivated_by: 'ai_coach',
        snapshot_id: snapshotId
      });
      if (newsResult) {
        results.saved++;
        console.log(`[chat/actions] Deactivated news: ${validation.data.news_title}`);
      } else {
        results.errors.push(`DeactivateNews "${validation.data.news_title}": write returned null`);
      }
    } catch (e) {
      results.errors.push(`News: ${e.message}`);
    }
  }

  // Save system notes
  // 2026-03-18: Added Zod validation (H-1) and null-return check (C-2)
  for (const sysNote of actions.systemNotes) {
    try {
      const validation = validateAction('SYSTEM_NOTE', {
        type: sysNote.type || 'pain_point',
        category: sysNote.category || 'general',
        title: sysNote.title,
        description: sysNote.description
      });
      if (!validation.ok) {
        results.errors.push(`SystemNote validation: ${validation.errors.map(e => e.message).join(', ')}`);
        continue;
      }

      const sysResult = await rideshareCoachDAL.saveSystemNote({
        note_type: validation.data.type,
        category: validation.data.category,
        title: validation.data.title,
        description: validation.data.description,
        user_quote: sysNote.user_quote,
        triggering_user_id: userId,
        triggering_conversation_id: conversationId,
        triggering_snapshot_id: snapshotId
      });
      if (sysResult) {
        results.saved++;
        console.log(`[chat/actions] Saved system note: ${validation.data.title}`);
      } else {
        results.errors.push(`SystemNote "${validation.data.title}": write returned null`);
      }
    } catch (e) {
      results.errors.push(`SystemNote: ${e.message}`);
    }
  }

  // 2026-02-17: Add new events (driver-reported intel)
  for (const event of actions.addEvents) {
    try {
      const validation = validateAction('ADD_EVENT', {
        title: event.title,
        venue_name: event.venue_name,
        address: event.address,
        event_start_date: event.event_start_date,
        event_start_time: event.event_start_time,
        event_end_time: event.event_end_time,
        category: event.category,
        expected_attendance: event.expected_attendance,
        notes: event.notes
      });
      if (!validation.ok) {
        results.errors.push(`AddEvent validation: ${validation.errors.map(e => e.message).join(', ')}`);
        continue;
      }

      // Get city/state from snapshot context (events need location)
      const snapshot = snapshotId ? await rideshareCoachDAL.getHeaderSnapshot(snapshotId) : null;
      const city = event.city || snapshot?.city;
      const state = event.state || snapshot?.state;
      if (!city || !state) {
        results.errors.push('AddEvent: Cannot determine city/state from context');
        continue;
      }

      const addResult = await rideshareCoachDAL.addEvent({
        ...validation.data,
        city,
        state,
        user_id: userId
      });
      if (addResult) {
        results.saved++;
        console.log(`[chat/actions] Added event: ${validation.data.title}`);
      } else {
        results.errors.push(`AddEvent "${validation.data.title}": write returned null`);
      }
    } catch (e) {
      results.errors.push(`AddEvent: ${e.message}`);
    }
  }

  // 2026-02-17: Update existing events (driver-corrected details)
  for (const event of actions.updateEvents) {
    try {
      const validation = validateAction('UPDATE_EVENT', {
        event_title: event.event_title,
        event_id: event.event_id,
        event_start_time: event.event_start_time,
        event_end_time: event.event_end_time,
        event_start_date: event.event_start_date,
        venue_name: event.venue_name,
        address: event.address,
        category: event.category,
        expected_attendance: event.expected_attendance,
        notes: event.notes
      });
      if (!validation.ok) {
        results.errors.push(`UpdateEvent validation: ${validation.errors.map(e => e.message).join(', ')}`);
        continue;
      }

      const updateResult = await rideshareCoachDAL.updateEvent({
        ...validation.data,
        snapshot_id: snapshotId
      });
      if (updateResult) {
        results.saved++;
        console.log(`[chat/actions] Updated event: ${validation.data.event_title}`);
      } else {
        results.errors.push(`UpdateEvent "${validation.data.event_title}": write returned null`);
      }
    } catch (e) {
      results.errors.push(`UpdateEvent: ${e.message}`);
    }
  }

  // 2026-02-17: Coach memos — write to docs/coach-inbox.md for Claude Code to pick up
  const __dirname_chat = path.dirname(fileURLToPath(import.meta.url));
  const coachInboxPath = path.join(__dirname_chat, '..', '..', '..', 'docs', 'coach-inbox.md');

  for (const memo of actions.coachMemos) {
    try {
      const validation = validateAction('COACH_MEMO', {
        type: memo.type || 'observation',
        title: memo.title,
        detail: memo.detail,
        priority: memo.priority || 'medium',
        related_files: memo.related_files
      });
      if (!validation.ok) {
        results.errors.push(`CoachMemo validation: ${validation.errors.map(e => e.message).join(', ')}`);
        continue;
      }

      const { type, title, detail, priority, related_files } = validation.data;
      const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const filesLine = related_files?.length ? `\n  - Files: ${related_files.join(', ')}` : '';
      const entry = `\n### [${type.toUpperCase()}] ${title}\n- **Priority:** ${priority} | **Date:** ${timestamp}\n- ${detail}${filesLine}\n`;

      await appendFile(coachInboxPath, entry, 'utf-8');
      results.saved++;
      console.log(`[chat/actions] 📝 Coach memo saved to inbox: "${title}" (${type})`);
    } catch (e) {
      results.errors.push(`CoachMemo: ${e.message}`);
    }
  }

  // Save zone intelligence (crowd-sourced market knowledge) - with validation
  for (const zone of actions.zoneIntel) {
    try {
      // 2026-01-05: Validate before execution
      const validation = validateAction('ZONE_INTEL', {
        zone_type: zone.zone_type,
        zone_name: zone.zone_name,
        market_slug: zone.market_slug,
        reason: zone.reason,
        time_constraints: zone.time_constraints,
        address_hint: zone.address_hint
      });
      if (!validation.ok) {
        results.errors.push(`ZoneIntel validation: ${validation.errors.map(e => e.message).join(', ')}`);
        continue;
      }

      const zoneResult = await rideshareCoachDAL.saveZoneIntelligence({
        market_slug: validation.data.market_slug,
        zone_type: validation.data.zone_type,
        zone_name: validation.data.zone_name,
        zone_description: zone.description,
        address_hint: validation.data.address_hint,
        time_constraints: validation.data.time_constraints ?
          (typeof validation.data.time_constraints === 'string' ? { note: validation.data.time_constraints } : validation.data.time_constraints)
          : null,
        reason: validation.data.reason,
        user_id: userId,
        conversation_id: conversationId
      });
      if (zoneResult) {
        results.saved++;
        console.log(`[chat/actions] Saved zone intel: ${validation.data.zone_name} (${validation.data.zone_type})`);
      } else {
        results.errors.push(`ZoneIntel "${validation.data.zone_name}": write returned null`);
      }
    } catch (e) {
      results.errors.push(`ZoneIntel: ${e.message}`);
    }
  }

  // 2026-03-18: Market intelligence — driver-reported surge patterns, timing insights (C-3)
  for (const intel of actions.marketIntel) {
    try {
      const validation = validateAction('MARKET_INTEL', {
        market: intel.market,
        intel_type: intel.intel_type,
        title: intel.title,
        content: intel.content,
        intel_subtype: intel.intel_subtype,
        summary: intel.summary,
        platform: intel.platform,
        priority: intel.priority,
        confidence: intel.confidence,
        tags: intel.tags
      });
      if (!validation.ok) {
        results.errors.push(`MarketIntel validation: ${validation.errors.map(e => e.message).join(', ')}`);
        continue;
      }

      const miResult = await rideshareCoachDAL.saveMarketIntelligence({
        ...validation.data,
        created_by: 'ai_coach'
      });
      if (miResult) {
        results.saved++;
        console.log(`[chat/actions] Saved market intel: ${validation.data.title} (${validation.data.market})`);
      } else {
        results.errors.push(`MarketIntel "${validation.data.title}": write returned null`);
      }
    } catch (e) {
      results.errors.push(`MarketIntel: ${e.message}`);
    }
  }

  // 2026-03-18: Venue catalog — staging spots, GPS dead zones, venue intel (C-3)
  for (const venue of actions.venueIntel) {
    try {
      const validation = validateAction('SAVE_VENUE_INTEL', {
        venue_name: venue.venue_name,
        address: venue.address,
        category: venue.category,
        place_id: venue.place_id,
        city: venue.city,
        staging_notes: venue.staging_notes,
        ai_estimated_hours: venue.ai_estimated_hours,
        lat: venue.lat,
        lng: venue.lng
      });
      if (!validation.ok) {
        results.errors.push(`VenueIntel validation: ${validation.errors.map(e => e.message).join(', ')}`);
        continue;
      }

      const viResult = await rideshareCoachDAL.saveVenueCatalogEntry({
        ...validation.data,
        discovery_source: 'ai_coach'
      });
      if (viResult) {
        results.saved++;
        console.log(`[chat/actions] Saved venue intel: ${validation.data.venue_name}`);
      } else {
        results.errors.push(`VenueIntel "${validation.data.venue_name}": write returned null`);
      }
    } catch (e) {
      results.errors.push(`VenueIntel: ${e.message}`);
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
    const note = await rideshareCoachDAL.saveUserNote({
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
      // 2026-01-07: Truncate user ID to avoid PII in logs
      console.log(`[chat/notes] Saved note ${note.id?.substring(0, 8)} for user ${userId?.substring(0, 8)}`);
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
    const notes = await rideshareCoachDAL.getUserNotes(userId, limit);
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
    const context = await rideshareCoachDAL.getCompleteContext(snapshotId);
    
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


// POST /api/chat - AI Coach with Full Schema Access & Thread Context & File Support
// SECURITY: requireAuth enforces user must be signed in
router.post('/', requireAuth, async (req, res) => {
  const { userId, message, threadHistory = [], snapshotId, strategyId, strategy, blocks, attachments = [], conversationId: clientConversationId, snapshot: clientSnapshot } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message required' });
  }

  // 2026-01-15: Removed 'anonymous' fallback - requireAuth middleware guarantees userId
  // If req.auth.userId is somehow missing, that's a bug in auth middleware
  const authUserId = req.auth?.userId;
  if (!authUserId) {
    console.error('[chat] CRITICAL: No userId despite requireAuth middleware - auth bug');
    return res.status(401).json({ error: 'Authentication required', code: 'auth_missing' });
  }
  const isAuthenticated = true; // Always true - requireAuth guarantees this

  // Generate or use existing conversation_id for thread tracking
  const conversationId = clientConversationId || randomUUID();

  // 2026-01-06: CRITICAL - NO FALLBACKS (per global app rule)
  // Timezone MUST come from snapshot. If missing, we cannot provide accurate time-based advice.
  const userTimezone = clientSnapshot?.timezone;
  if (!userTimezone) {
    console.warn('[chat] Missing timezone in snapshot - cannot provide accurate time context');
    return res.status(400).json({
      error: 'TIMEZONE_REQUIRED',
      message: 'Location snapshot with timezone required for coach. Please enable GPS and refresh.',
      code: 'missing_timezone',
      hint: 'Ensure GPS is enabled and location permission granted'
    });
  }

  const userLocalDate = new Date().toLocaleDateString('en-US', {
    timeZone: userTimezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const userLocalTime = new Date().toLocaleTimeString('en-US', {
    timeZone: userTimezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  const userLocalDateTime = `${userLocalDate} at ${userLocalTime}`;

  // 2026-01-06: SECURITY - Redact sensitive data from logs
  // Log only metadata, never message content or PII
  console.log(`[chat] Request: user=${authUserId.slice(0, 8)}... conv=${conversationId.slice(0, 8)} thread=${threadHistory.length}msgs attachments=${attachments.length}`);
  console.log(`[chat] Context: strategy=${strategyId?.slice(0, 8) || 'none'} snapshot=${snapshotId?.slice(0, 8) || 'none'} tz=${userTimezone}`);

  try {
    // Use CoachDAL for full schema read access with ALL tables
    let contextInfo = '';
    let fullContext = null;
    let snapshotHistoryInfo = '';  // Declared here so it's accessible in system prompt
    // 2026-03-18: FIX (H-6) — Hoist activeSnapshotId so strategy→snapshot resolution
    // persists to executeActions. Previously re-declared at line 701, throwing away the resolved value.
    let activeSnapshotId = snapshotId || null;

    try {
      // PRIORITY: Use the snapshotId provided by the UI (always current)
      // The UI has the authoritative snapshot ID from the current location
      if (snapshotId) activeSnapshotId = snapshotId;
      
      if (activeSnapshotId) {
        console.log('[chat] Using snapshot from UI:', activeSnapshotId);
      } else if (strategyId) {
        // Fallback: resolve strategy to snapshot if no direct snapshotId
        console.log('[chat] Resolving strategy_id:', strategyId);
        const resolution = await rideshareCoachDAL.resolveStrategyToSnapshot(strategyId);
        if (resolution) {
          activeSnapshotId = resolution.snapshot_id;
          console.log('[chat] Resolved strategy_id to snapshot_id:', activeSnapshotId);
        }
      } else {
        // 2026-03-17: SECURITY FIX (F-6) — Use authenticated userId, not body userId.
        // Previously req.body.userId was used as fallback, allowing any authenticated
        // user to load another user's snapshot by supplying arbitrary userId.
        const [latestSnap] = await db
          .select({ snapshot_id: snapshots.snapshot_id })
          .from(snapshots)
          .where(eq(snapshots.user_id, authUserId))
          .orderBy(desc(snapshots.created_at))
          .limit(1);

        if (latestSnap) {
          activeSnapshotId = latestSnap.snapshot_id;
          console.log('[chat] Using latest snapshot for authenticated user:', activeSnapshotId);
        }
      }

      // Get COMPLETE context using CoachDAL (full schema access)
      // Pass authenticated user ID for driver profile lookup (in case snapshot has different/null user_id)
      if (activeSnapshotId) {
        fullContext = await rideshareCoachDAL.getCompleteContext(activeSnapshotId, null, authUserId !== 'anonymous' ? authUserId : null);
        contextInfo = rideshareCoachDAL.formatContextForPrompt(fullContext);

        console.log(`[chat] Full context loaded - Status: ${fullContext.status} | Snapshot: ${activeSnapshotId}`);
        console.log(`[chat] Context includes: ${fullContext.smartBlocks?.length || 0} venues, briefing=${!!fullContext.briefing}, driverProfile=${!!fullContext.driverProfile}, vehicle=${!!fullContext.driverVehicle}`);
      } else {
        contextInfo = '\n\n⏳ No location snapshot available yet. Enable GPS to receive personalized strategy advice.';
      }

      // Add snapshot history for authenticated users (last 10 sessions)
      if (isAuthenticated) {
        try {
          const history = await rideshareCoachDAL.getSnapshotHistory(authUserId, 10);
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

      // Add crowd-sourced zone intelligence for this market
      if (fullContext?.snapshot) {
        try {
          const marketSlug = rideshareCoachDAL.generateMarketSlug(fullContext.snapshot.city, fullContext.snapshot.state);
          if (marketSlug) {
            fullContext.marketSlug = marketSlug;
            const zoneIntelSummary = await rideshareCoachDAL.getZoneIntelligenceSummary(marketSlug);
            if (zoneIntelSummary) {
              contextInfo += zoneIntelSummary;
            }
          }
        } catch (e) {
          console.warn('[chat] Failed to load zone intelligence:', e.message);
        }
      }
    } catch (err) {
      console.warn('[chat] Could not fetch context:', err.message);
      contextInfo = '\n\n⚠️ Context temporarily unavailable';
    }

    // activeSnapshotId already hoisted above (line ~615) with strategy→snapshot resolution

    // Check for Super User (Agent Capabilities)
    let isSuperUser = false;
    if (isAuthenticated) {
      try {
        const [profile] = await db.select({ email: driver_profiles.email })
          .from(driver_profiles)
          .where(eq(driver_profiles.user_id, authUserId))
          .limit(1);
        
        if (profile?.email === 'melodydashora@gmail.com') {
          isSuperUser = true;
          console.log(`[chat] 🚀 Super User detected: ${profile.email} - Enabling Agent Capabilities`);
        }
      } catch (e) {
        console.warn('[chat] Failed to check user profile:', e.message);
      }
    }

    // Save user message to coach_conversations (non-blocking, authenticated users only)
    let userMessageId = null;
    if (isAuthenticated) {
      try {
        const userMsg = await rideshareCoachDAL.saveConversationMessage({
          user_id: authUserId,
          snapshot_id: activeSnapshotId,
          conversation_id: conversationId,
          role: 'user',
          content: message,
          content_type: attachments.length > 0 ? 'text+attachment' : 'text',
          market_slug: fullContext?.marketSlug || null, // For cross-driver learning
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

    // 2026-02-13: Enhanced system prompt — model identity, vision/OCR, Google Search, full capabilities
    let systemPrompt = `You are the AI Coach — a powerful AI assistant powered by Gemini 3 Pro Preview.
You are much more than just a rideshare assistant. You're a frontier AI model with advanced capabilities.

**YOUR IDENTITY & MODEL:**
- You are Gemini 3 Pro Preview (NOT Flash) — a frontier multimodal AI model by Google
- You have FULL Google Search access for real-time information
- You have VISION capabilities — you can see and analyze images, screenshots, photos, maps, and documents
- You have OCR capabilities — you can read text from screenshots, receipts, signs, and any image
- When a user sends an image or screenshot, you CAN and SHOULD analyze it thoroughly
- You are the smartest, most capable model in the Gemini family

**Your Capabilities:**

👁️ **Vision & Image Analysis:**
- Analyze screenshots of apps (Uber, Lyft, earnings, maps, heatmaps)
- Read text from images using OCR (receipts, signs, menus, documents)
- Interpret map screenshots, surge maps, and navigation screenshots
- Identify UI issues, bugs, or visual problems from screenshots
- Compare before/after screenshots
- When you receive an image attachment, ALWAYS analyze it in detail

🚗 **Rideshare Strategy (Your Specialty):**
- Real-time venue recommendations with business hours, events, pro tips, staging locations
- Location and timing advice using traffic, weather, and event data
- Earnings optimization and market pattern analysis
- Analyzing uploaded heat maps, screenshots, and documents

🧠 **Market Intelligence (Your Knowledge Base):**
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

**⏰ CURRENT DATE & TIME (User's Local Time):**
**${userLocalDateTime}** (${userTimezone})
This is the driver's ACTUAL local date and time. Use this when discussing events, schedules, or anything time-sensitive.

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

📋 **Event Management (Full CRUD):**
You have FULL event management capabilities — add, update, deactivate, and reactivate events.

➕ **Add New Event** (driver-reported intel):
- When a driver tells you about an event not in your data, ADD it!
- Format: \`[ADD_EVENT: {"title": "Event Name", "venue_name": "Venue", "address": "123 Main St", "event_start_date": "YYYY-MM-DD", "event_start_time": "7:00 PM", "event_end_time": "10:00 PM", "category": "concert", "expected_attendance": "high"}]\`
- Categories: concert, sports, theater, conference, festival, nightlife, civic, academic, airport, other
- Attendance: high, medium, low
- City/state auto-detected from driver's current location

✏️ **Update Event** (correct details):
- When a driver says times or details are wrong, UPDATE the event
- Format: \`[UPDATE_EVENT: {"event_title": "Event Name", "event_start_time": "8:00 PM", "event_end_time": "11:00 PM", "notes": "Driver corrected the time"}]\`
- Only include fields you want to change (event_start_time, event_end_time, venue_name, address, category, expected_attendance)

❌ **Deactivate Event** (remove):
- Format: \`[DEACTIVATE_EVENT: {"event_title": "Event Name", "reason": "event_ended", "notes": "Optional"}]\`
- Reasons: event_ended, incorrect_time, cancelled, no_longer_relevant, duplicate

🔄 **Reactivate Event** (undo removal):
- Format: \`[REACTIVATE_EVENT: {"event_title": "Event Name", "reason": "why reactivating", "notes": "Optional correction"}]\`
- ALWAYS check current date/time before deactivating — if a driver corrects you, reactivate immediately

📝 **Coach Inbox (Remember & Suggest):**
- When a user asks you to REMEMBER something, save a feature idea, or you want to suggest code changes — use COACH_MEMO
- This writes to \`docs/coach-inbox.md\` which Claude Code checks at session start
- Format: \`[COACH_MEMO: {"type": "feature_request", "title": "Add donate link to concierge page", "detail": "Melody wants a link on the public concierge page that allows passengers to donate/tip to support the app", "priority": "medium", "related_files": ["client/src/pages/concierge/PublicConciergePage.tsx"]}]\`
- Types: feature_request, remember, bug, code_suggestion, observation, todo
- Priority: high, medium, low
- related_files: optional array of file paths this relates to
- USE THIS whenever Melody says "remember this", "we should add...", "don't forget...", or you notice something worth flagging for development

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

🗺️ **Zone Intelligence (Crowd-Sourced Learning):**
- When drivers share intel about specific areas (dead zones, dangerous spots, honey holes, staging spots), SAVE IT!
- This builds a crowd-sourced knowledge base that helps ALL drivers in this market
- Format: \`[ZONE_INTEL: {"zone_type": "dead_zone|danger_zone|honey_hole|surge_trap|staging_spot|event_zone", "zone_name": "Human-readable area name", "market_slug": "${fullContext?.snapshot ? rideshareCoachDAL.generateMarketSlug(fullContext.snapshot.city, fullContext.snapshot.state) : 'unknown'}", "reason": "What the driver said", "time_constraints": "after 10pm weeknights", "address_hint": "near the Target on Main"}]\`
- Zone types:
  • dead_zone: Areas with little/no ride demand
  • danger_zone: Unsafe/sketchy areas to avoid
  • honey_hole: Consistently profitable spots
  • surge_trap: Fake/unprofitable surge areas
  • staging_spot: Good waiting/staging locations
  • event_zone: Temporary high-demand areas
- ALWAYS include the reason in the driver's words
- Time constraints are optional but very valuable (e.g., "dead after 10pm", "busy during Cowboys games")

📊 **Your Data (Pre-loaded Context):**
All available data is included in this prompt below. You do NOT have live SQL query access.
Your data comes from these sources (pre-fetched for you):
- Driver Profile & Vehicle: Name, platforms, eligibility tiers, vehicle details
- Current Snapshot: GPS location, weather, air quality, time context
- Strategy: The current AI-generated strategy for this session
- Briefing: Events, traffic conditions, news, airport conditions, school closures
- Smart Blocks: Top ranked venue recommendations with hours, distance, ratings
- Market Intelligence: Research-backed market insights for this area
- Zone Intelligence: Crowd-sourced zone knowledge (dead zones, honey holes, staging spots)
- Your Notes: Previous notes you saved about this driver
- Offer Analysis Log: Recent Siri Shortcut ride offer analyses with accept/reject stats
- Session History: Recent driving sessions for pattern analysis

**CRITICAL: Do NOT hallucinate or invent data.** If information is not in the context below, say "I don't have that data in my current context" — do NOT make up table names, features, or statistics.

You can WRITE to these tables and files via action tags:
- user_intel_notes → [SAVE_NOTE: {...}]
- discovered_events → [ADD_EVENT: {...}] / [UPDATE_EVENT: {...}] / [DEACTIVATE_EVENT: {...}] / [REACTIVATE_EVENT: {...}]
- zone_intelligence → [ZONE_INTEL: {...}]
- coach_system_notes → [SYSTEM_NOTE: {...}]
- news_deactivations → [DEACTIVATE_NEWS: {...}]
- **docs/coach-inbox.md** → [COACH_MEMO: {...}] ← Feature ideas, things to remember, code suggestions for Claude Code

**Important:**
- You understand context from conversation history
- Brief responses like "yes", "go ahead", "thanks" relate to what you just said
- When asked to verify or search: USE GOOGLE SEARCH actively
- You're not limited to rideshare topics - help with anything!
- SAVE NOTES when you learn something useful about the driver!
- Reference your market knowledge to give smarter, research-backed advice

${contextInfo}

You're a powerful AI companion with research-backed market intelligence and persistent memory. Help with rideshare strategy when they need it, but be ready to assist with absolutely anything else they want to discuss or research.

**CRITICAL IDENTITY REMINDER:** You are Gemini 3 Pro Preview by Google. You are NOT Claude, NOT GPT, NOT any other AI model. If asked who you are, always respond that you are Gemini 3 Pro Preview.`;

    // 🚀 SUPER USER ENHANCEMENT: Inject Agent Capabilities & Memory
    if (isSuperUser) {
      try {
        const agentContext = await getEnhancedProjectContext();
        
        // 2026-02-13: Super User context for Melody (architect/developer)
        // 2026-03-17: SECURITY FIX (F-16) — Removed false capability claims.
        // Previous prompt claimed shell, file system, DDL, network, MCP, and autonomous
        // capabilities that this chat endpoint does NOT implement. The LLM has READ access
        // to snapshot/strategy context and can provide advice, but cannot execute commands.
      systemPrompt += `

══════════════════════════════════════════════════════════════════════════
🚀 **SUPER USER DETECTED: ELEVATED CONTEXT ENABLED**
══════════════════════════════════════════════════════════════════════════
You are interacting with Melody — the architect and developer of Vecto Pilot.
You have elevated context access for deeper system insight.

**YOUR IDENTITY:**
- You are Gemini 3 Pro Preview — the frontier model
- You are Melody's personal AI Coach with full data transparency
- You can discuss code, architecture, and system internals openly

**YOUR ACTUAL CAPABILITIES (via this chat endpoint):**

📊 Read Access:
- Full snapshot history and strategy data for this user
- Market intelligence, venue catalog, zone intelligence
- Coach conversation history and system notes
- Driver profile and vehicle data
- Event data, briefings, and offer intelligence

✏️ Write Access (via action tags):
- User notes, zone intel, system notes, event CRUD, news deactivations
- Market intelligence — surge patterns, timing insights, market-wide analysis
- Venue catalog — staging spots, GPS dead zones, venue intel
- Coach memos — feature requests, TODOs, bugs (docs/coach-inbox.md)

🧠 Memory & Context:
- Persistent conversation history (cross-session via coach_conversations)
- Google Search via Gemini tools for real-time research

**When Melody sends a screenshot or image:**
- Analyze it with full vision/OCR capabilities
- If it's a UI bug, identify the exact issue and suggest the fix
- If it's an earnings screenshot, analyze patterns
- If it's a map/heatmap, interpret zones, surge areas, and demand patterns

**ENHANCED CONTEXT:**
- Current Time: ${agentContext.currentTime}
- Environment: ${agentContext.environment}
- Workspace: ${agentContext.workspace}
- Snapshots (24h): ${agentContext.recentSnapshots?.length || 0}
- Strategies (24h): ${agentContext.recentStrategies?.length || 0}
- Actions (24h): ${agentContext.recentActions?.length || 0}

**Agent Memory:**
${JSON.stringify(agentContext.agentPreferences, null, 2)}

**Project State:**
${JSON.stringify(agentContext.projectState, null, 2)}

Help with ANYTHING — rideshare strategy, data analysis, research, architecture questions.
Full transparency. Maximum insight.

**CRITICAL IDENTITY REMINDER:** You are Gemini 3 Pro Preview by Google. You are NOT Claude, NOT GPT, NOT any other AI model. If asked who you are, always respond that you are Gemini 3 Pro Preview.
══════════════════════════════════════════════════════════════════════════`;
      } catch (err) {
        console.warn('[chat] Failed to inject Super User context:', err.message);
      }
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 2026-02-13: Process attachments into Gemini multimodal format (vision/OCR)
    // Gemini expects: parts: [{ text: "..." }, { inline_data: { mime_type: "image/png", data: "base64..." } }]
    console.log(`[chat] Processing ${attachments.length} attachments for Gemini coach`);

    // Build the current user message parts (text + any image attachments)
    const userParts = [];
    if (message) {
      userParts.push({ text: message });
    }

    // Convert base64 data URL attachments to Gemini inline_data format
    // 2026-04-05: SECURITY — import sanitizeForLog once for use across all attachments
    const { sanitizeForLog } = await import('../../lib/utils/sanitize.js');
    for (const att of attachments) {
      // Sanitize attachment name early to prevent format string injection in logs
      const safeName = sanitizeForLog(att.name);
      if (att.data && att.type) {
        try {
          // att.data is a data URL: "data:image/png;base64,iVBOR..."
          // Gemini needs just the raw base64 string and mime_type separately
          const base64Match = att.data.match(/^data:([^;]+);base64,(.+)$/);
          if (base64Match) {
            const mimeType = base64Match[1]; // e.g., "image/png"
            const base64Data = base64Match[2]; // raw base64 string
            userParts.push({
              inline_data: {
                mime_type: mimeType,
                data: base64Data,
              }
            });
            console.log(`[chat] Attached image: ${safeName} (${mimeType}, ${Math.round(base64Data.length / 1024)}KB base64)`);
          } else {
            // Non-data-URL attachment — include as text reference
            userParts.push({ text: `[Attachment: ${safeName} (${att.type})]` });
          }
        } catch (err) {
          // 2026-04-05: SECURITY — sanitize att.name to prevent format string injection (CodeQL)
          console.warn(`[chat] Failed to process attachment "${safeName}":`, err.message);
          userParts.push({ text: `[Attachment: ${safeName} — could not process]` });
        }
      }
    }

    // Fallback if no text and no valid attachments
    if (userParts.length === 0) {
      userParts.push({ text: message || '(empty message)' });
    }

    // Build full message history: thread history + new message with attachments
    const messageHistory = threadHistory
      .filter(msg => msg && msg.role && msg.content) // Validate messages
      .map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user', // Gemini uses 'model' for assistant
        parts: [{ text: msg.content }]
      }))
      .concat([
        {
          role: 'user',
          parts: userParts // Text + inline images for Gemini vision
        }
      ]);

    console.log(`[chat] Sending ${messageHistory.length} messages to Gemini...`);

    // 2026-01-06: Use adapter pattern for AI_COACH role (P1-A fix)
    // 2026-02-17: Renamed COACH_CHAT → AI_COACH to match user-facing branding
    // Model config (gemini-3.1-pro-preview, temp=0.7, google_search) is now in model-registry.js
    try {
      console.log(`[chat] Calling AI_COACH role via adapter with streaming...`);

      // Import adapter at runtime to avoid circular dependencies
      const { callModelStream } = await import('../../lib/ai/adapters/index.js');

      // Cancel the upstream Gemini call if the client disconnects mid-stream
      // (browser tab closed, mic-driven barge-in, etc). Without this the
      // server keeps generating + billing after the client is gone.
      const ac = new AbortController();
      req.on('close', () => ac.abort());

      const response = await callModelStream('AI_COACH', {
        system: systemPrompt,
        messageHistory,
        signal: ac.signal
      });

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

      // 2026-03-18: Declared outside if(totalText) so done event can always reference it
      let actionsResult = null;

      if (totalText) {
        console.log(`[chat] ✅ Gemini streamed response: ${totalText.length} chars`);

        // 2026-03-18: Parse actions and execute them (awaited for client feedback)
        const { actions, cleanedText } = parseActions(totalText);
        const hasActions = Object.values(actions).some(arr => arr.length > 0);

        if (hasActions) {
          console.log(`[chat] Found actions: notes=${actions.notes.length}, events=${actions.events.length}, addEvents=${actions.addEvents.length}, updateEvents=${actions.updateEvents.length}, memos=${actions.coachMemos.length}, news=${actions.news.length}, systemNotes=${actions.systemNotes.length}, zoneIntel=${actions.zoneIntel.length}, marketIntel=${actions.marketIntel.length}, venueIntel=${actions.venueIntel.length}`);

          // 2026-03-18: FIX (C-1) — Await actions so results can be sent to client.
          // DB writes are sub-50ms each; minor latency is worth guaranteed feedback.
          try {
            actionsResult = await executeActions(actions, authUserId, activeSnapshotId, conversationId);
            if (actionsResult.saved > 0) {
              console.log(`[chat] ✅ Executed ${actionsResult.saved} actions`);
            }
          } catch (e) {
            console.error('[chat] Action execution error:', e.message);
            actionsResult = { saved: 0, errors: [e.message] };
          }
        }

        // Save assistant response to coach_conversations (authenticated users only)
        if (isAuthenticated) {
          try {
            // 2026-03-18: FIX (M-7) — Skip auto-tip extraction if SAVE_NOTE actions
            // were already parsed. The AI explicitly chose what to save; auto-extraction
            // would duplicate those notes with slightly different titles.
            const hasSaveNoteActions = actions?.notes?.length > 0;
            const extractedTips = hasSaveNoteActions
              ? 0
              : await rideshareCoachDAL.extractAndSaveTips(authUserId, cleanedText, {
                  snapshot_id: activeSnapshotId,
                  conversation_id: conversationId
                });

            await rideshareCoachDAL.saveConversationMessage({
              user_id: authUserId,
              snapshot_id: activeSnapshotId,
              conversation_id: conversationId,
              parent_message_id: userMessageId,
              role: 'assistant',
              content: cleanedText,
              content_type: 'text',
              market_slug: fullContext?.marketSlug || null, // For cross-driver learning
              // 2026-03-18: extractAndSaveTips returns a number, not an object
              extracted_tips: [],
              model_used: 'gemini-3.1-pro-preview',
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

      // 2026-03-18: FIX (C-1) — Include action results so client gets feedback
      const donePayload = { done: true, conversation_id: conversationId };
      if (actionsResult) {
        donePayload.actions_result = actionsResult;
      }
      res.write(`data: ${JSON.stringify(donePayload)}\n\n`);
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
    const conversations = await rideshareCoachDAL.getConversations(userId, limit);
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
    const messages = await rideshareCoachDAL.getConversationHistory(userId, conversationId, limit);
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
    const result = await rideshareCoachDAL.toggleMessageStar(messageId, starred !== false);
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
    const messages = await rideshareCoachDAL.getConversationHistory(userId, null, limit);
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
    const notes = await rideshareCoachDAL.getSystemNotes(status, limit);
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
    const result = await rideshareCoachDAL.deactivateNews({
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
    const hashes = await rideshareCoachDAL.getDeactivatedNewsHashes(userId);
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
    const result = await rideshareCoachDAL.deactivateEvent({
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
    const history = await rideshareCoachDAL.getSnapshotHistory(userId, limit);
    res.json({ snapshots: history, count: history.length });
  } catch (error) {
    console.error('[chat/snapshot-history] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
