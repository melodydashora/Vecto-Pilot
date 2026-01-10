// server/lib/briefing/event-schedule-validator.js
// ============================================================================
// EVENT SCHEDULE VALIDATOR - BRIEFING_EVENTS_VALIDATOR Role with Web Search
// ============================================================================
//
// PURPOSE: Validates event schedules before they're used in strategy generation
//
// PROBLEM SOLVED: Web search can return outdated or incorrect event
// schedules (e.g., saying an event is "tonight" when it's actually dark that day)
//
// SOLUTION: Use BRIEFING_EVENTS_VALIDATOR role with web search tool to verify each event's
// actual schedule against authoritative sources (official websites, ticketing)
//
// INPUT: Array of events from briefing-service.js
// OUTPUT: Same array with verified: true/false and verification_note fields
//
// ROLE: BRIEFING_EVENTS_VALIDATOR via BRIEFING_VALIDATOR_MODEL env var
// TOOLS: web_search (Anthropic built-in)
//
// ============================================================================

import { callModel } from '../ai/adapters/index.js';

/**
 * Validate event schedules using BRIEFING_EVENTS_VALIDATOR role with web search
 * Checks each "tonight" event against real schedules to catch errors
 *
 * @param {Array} events - Events from briefing service
 * @param {Object} context - { date, city, state, timezone }
 * @returns {Promise<Array>} Events with verified flag and notes
 */
export async function validateEventSchedules(events, context) {
  if (!events || events.length === 0) {
    return [];
  }

  const { date, city, state, timezone } = context;

  // Only validate events that claim to be happening "today" or "tonight"
  // 2026-01-10: Support both old (event_date) and new (event_start_date) field names
  const eventsToValidate = events.filter(e => {
    const eventDate = e.event_start_date || e.event_date || '';
    const title = (e.title || '').toLowerCase();
    const summary = (e.summary || '').toLowerCase();

    // Check if event claims to be today
    const isToday = eventDate === date ||
                    eventDate.includes('today') ||
                    title.includes('tonight') ||
                    summary.includes('tonight') ||
                    summary.includes('today');

    return isToday;
  });

  if (eventsToValidate.length === 0) {
    console.log(`[EventValidator] No "today/tonight" events to validate`);
    return events.map(e => ({ ...e, verified: true, verification_note: 'Not today - skipped validation' }));
  }

  console.log(`[EventValidator] 🔍 Validating ${eventsToValidate.length} events for ${date} in ${city}, ${state}`);

  const system = `You are an event schedule fact-checker with web search capability.

Your job: Use web search to verify whether each event is ACTUALLY scheduled for the given date.

CRITICAL INSTRUCTIONS:
1. USE WEB SEARCH for each event - check official venue websites, ticketing sites (Ticketmaster, AXS, etc.)
2. Many recurring events (Christmas shows, concerts, festivals) have SPECIFIC dates - they don't run every day
3. Look for the official schedule/calendar, not just general event descriptions
4. If you can't find definitive info, mark confidence as "low"

After searching, return ONLY a JSON array - no markdown, no explanation text.`;

  // 2026-01-10: Support both old and new field names
  const eventList = eventsToValidate.map((e, i) => {
    const eventDate = e.event_start_date || e.event_date || date;
    const eventTime = e.event_start_time || e.event_time || 'unknown time';
    return `${i + 1}. "${e.title}" at ${e.venue || e.location || 'unknown venue'} - claimed: ${eventDate} at ${eventTime}`;
  }).join('\n');

  const user = `VERIFICATION REQUEST
==================
Today's Date: ${date} (${getDayName(date)})
Location: ${city}, ${state}
Timezone: ${timezone}

EVENTS TO VERIFY (search the web for each):
${eventList}

TASK:
1. Search the web for each event's OFFICIAL schedule
2. Verify if each event is actually happening on ${date}
3. Return results as JSON

Return JSON array ONLY:
[
  {
    "event_index": 1,
    "title": "Event Name",
    "is_valid_for_date": true or false,
    "actual_dates": "Dec 5-7, Dec 10-14" or null if valid,
    "confidence": "high" | "medium" | "low",
    "source": "URL or source name",
    "note": "Brief explanation of what you found"
  }
]`;

  try {
    const result = await callModel('BRIEFING_EVENTS_VALIDATOR', { system, user });

    if (!result.ok) {
      console.warn(`[EventValidator] ⚠️ Validation API failed: ${result.error}`);
      // CRITICAL: When validation API fails, KEEP events as unvalidated (not filtered out)
      // Mark as verified=true so filterVerifiedEvents doesn't remove them
      console.log(`[EventValidator] ⚠️ Keeping ${events.length} events as unvalidated (API unavailable)`);
      return events.map(e => ({ ...e, verified: true, verification_note: 'Validation API unavailable - keeping event' }));
    }

    // Parse response - try multiple extraction strategies
    let validationResults;
    try {
      let cleaned = result.output.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

      // Strategy 1: Direct parse
      try {
        validationResults = JSON.parse(cleaned);
      } catch (_e1) {
        // Strategy 2: Extract JSON array from prose (find [...])
        const arrayMatch = result.output.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          validationResults = JSON.parse(arrayMatch[0]);
        } else {
          // Strategy 3: Extract JSON object from prose (find {...})
          const objMatch = result.output.match(/\{[\s\S]*\}/);
          if (objMatch) {
            const obj = JSON.parse(objMatch[0]);
            validationResults = Array.isArray(obj) ? obj : [obj];
          } else {
            throw new Error('No JSON found in response');
          }
        }
      }

      console.log(`[EventValidator] ✅ Parsed ${validationResults.length} validation results`);
    } catch (parseErr) {
      console.warn(`[EventValidator] ⚠️ Failed to parse validation response: ${parseErr.message}`);
      console.warn(`[EventValidator] Raw output (first 200 chars): ${result.output?.slice(0, 200)}`);
      // CRITICAL: When validation fails, KEEP events as unvalidated (not filtered out)
      // Mark as verified=true so filterVerifiedEvents doesn't remove them
      console.log(`[EventValidator] ⚠️ Keeping ${events.length} events as unvalidated (validation unavailable)`);
      return events.map(e => ({ ...e, verified: true, verification_note: 'Validation unavailable - keeping event' }));
    }

    // Merge validation results back into events
    const validatedEvents = events.map(event => {
      // Find if this event was validated
      const validation = validationResults.find(v =>
        v.title?.toLowerCase() === event.title?.toLowerCase() ||
        event.title?.toLowerCase().includes(v.title?.toLowerCase())
      );

      if (!validation) {
        // Event wasn't in validation list (not a "today" event)
        return { ...event, verified: true, verification_note: 'Not today - skipped' };
      }

      if (validation.is_valid_for_date) {
        console.log(`[EventValidator] ✅ VERIFIED: "${event.title}" is confirmed for ${date}`);
        return {
          ...event,
          verified: true,
          verification_confidence: validation.confidence,
          verification_note: validation.note || 'Confirmed'
        };
      } else {
        console.log(`[EventValidator] ❌ INVALID: "${event.title}" is NOT on ${date}. Actual: ${validation.actual_dates}`);
        return {
          ...event,
          verified: false,
          verification_confidence: validation.confidence,
          verification_note: `NOT scheduled for ${date}. Actual dates: ${validation.actual_dates || 'unknown'}`,
          actual_dates: validation.actual_dates
        };
      }
    });

    const verifiedCount = validatedEvents.filter(e => e.verified).length;
    const invalidCount = validatedEvents.filter(e => e.verified === false).length;

    console.log(`[EventValidator] ✅ Validation complete: ${verifiedCount} verified, ${invalidCount} invalid`);

    return validatedEvents;

  } catch (err) {
    console.error(`[EventValidator] ❌ Error: ${err.message}`);
    // CRITICAL: On any error, KEEP events as unvalidated (not filtered out)
    console.log(`[EventValidator] ⚠️ Keeping ${events.length} events as unvalidated (error occurred)`);
    return events.map(e => ({ ...e, verified: true, verification_note: `Validation error - keeping event` }));
  }
}

/**
 * Filter out invalid events from the list
 * @param {Array} events - Events with verification flags
 * @returns {Array} Only verified events
 */
export function filterVerifiedEvents(events) {
  if (!events || events.length === 0) return [];

  const verified = events.filter(e => e.verified !== false);
  const removed = events.filter(e => e.verified === false);

  if (removed.length > 0) {
    console.log(`[EventValidator] 🚫 Filtered out ${removed.length} invalid events:`);
    removed.forEach(e => console.log(`  - "${e.title}": ${e.verification_note}`));
  }

  return verified;
}

/**
 * Get day name from date string
 */
function getDayName(dateStr) {
  try {
    const date = new Date(dateStr + 'T12:00:00');
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  } catch {
    return 'unknown';
  }
}
