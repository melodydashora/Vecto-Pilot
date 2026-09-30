// server/api/chat/parse-actions.js
// 2026-09-11: extracted verbatim from chat.js (parseActions + extractBalancedJson) so the
// action parser is unit-testable without loading the Express router, and extended to
// REPORT parse failures (desktop-coach-review.md item 2, verified in the current tree):
// a malformed [COACH_MEMO: {...}] used to produce zero actions and only a console.warn,
// so the model's "Saved your report." reached the driver, TTS and coach_conversations
// while nothing was written. Callers must surface `parseErrors`.

/**
 * Parse AI actions from response text
 * 2026-01-06: P1-B fix - Improved to handle nested JSON properly
 *
 * Supports two formats:
 * 1. Legacy inline: [SAVE_NOTE: {...}] (kept for backward compat)
 * 2. JSON envelope: ```json\n{"actions": [...], "response": "..."}\n``` (preferred)
 */
export function parseActions(responseText) {
  const actions = {
    notes: [],
    events: [],
    news: [],
    systemNotes: [],
    zoneIntel: [],
    eventReactivations: [],
    addEvents: [],          // 2026-02-17: Coach-created events from driver intel
    updateEvents: [],       // 2026-02-17: Coach-corrected event details
    coachMemos: [],         // 2026-02-17: Coach-to-Claude Code bridge memos (writes to file)
    marketIntel: [],        // 2026-03-18: C-3 — market-wide intelligence from driver conversations
    venueIntel: [],         // 2026-03-18: C-3 — staging spots, GPS dead zones, venue intel
    offerDecisions: [],      // Retired tags: detected only to report an explicit not-saved result.
    offerDecisionUpdates: [],
    offerIntelBackfills: []
  };

  let cleanedText = responseText;
  // 2026-09-11 (desktop-coach-review item 2): every swallowed parse failure is reported
  // so the completion path can refuse an unqualified "saved" claim.
  const parseErrors = [];

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
          // Retired offer writes are rejected by executeActions.
          else if (actionType === 'LOG_OFFER_DECISION') actions.offerDecisions.push(actionData);
          else if (actionType === 'UPDATE_OFFER_DECISION') actions.offerDecisionUpdates.push(actionData);
          else if (actionType === 'BACKFILL_OFFER_INTEL') actions.offerIntelBackfills.push(actionData);
        }
        // Use the response field if present, otherwise remove the JSON block
        cleanedText = envelope.response || responseText.replace(jsonEnvelopeMatch[0], '').trim();
        console.log(`[COACH] Parsed JSON envelope: ${envelope.actions.length} actions`);
        return { actions, cleanedText, parseErrors };
      }
    } catch (e) {
      console.warn(`[COACH] JSON envelope parse failed, falling back to regex:`, e.message);
      parseErrors.push(`JSON action envelope could not be parsed (${e.message}) — its actions were not executed`);
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
    { prefix: 'SAVE_VENUE_INTEL', key: 'venueIntel' },
    // Retired offer writes (legacy inline form): detect, never execute.
    { prefix: 'LOG_OFFER_DECISION', key: 'offerDecisions' },
    { prefix: 'UPDATE_OFFER_DECISION', key: 'offerDecisionUpdates' },
    { prefix: 'BACKFILL_OFFER_INTEL', key: 'offerIntelBackfills' }
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
        console.warn(`[COACH] ${prefix} action tag found but JSON extraction failed (malformed/unclosed braces)`);
        parseErrors.push(`${prefix}: malformed action data (unbalanced or missing braces) — not saved`);
      } else {
        try {
          const parsed = JSON.parse(jsonResult.json);
          actions[key].push(parsed);
          // Build the full match to remove (include closing bracket)
          const fullMatch = responseText.slice(match.index, jsonResult.endIndex + 1);
          // 2026-03-18: FIX (M-2) — replaceAll so duplicate tags are both removed
          cleanedText = cleanedText.replaceAll(fullMatch, '');
        } catch (e) {
          console.warn(`[COACH] Failed to parse ${key} JSON:`, e.message);
          parseErrors.push(`${prefix}: malformed action JSON (${e.message}) — not saved`);
          // Drop the broken tag from the persisted/displayed text; the completion path
          // appends an explicit not-saved line instead of leaving raw JSON or a false claim.
          cleanedText = cleanedText.replaceAll(responseText.slice(match.index, jsonResult.endIndex + 1), '');
        }
      }
    }
  }

  return { actions, cleanedText: cleanedText.trim(), parseErrors };
}

/**
 * Extract balanced JSON from string starting at given index
 * Handles nested braces correctly
 */
export function extractBalancedJson(str, startIndex) {
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
