// server/lib/subagents/event-verifier.js
// Event Verification Subagent with fallback chain (anthropic -> openai -> google)
// Verifies: validity, freshness, impact scoring

import { agentAsk } from '../../agent/agent-override-llm.js';

const VERIFICATION_SYSTEM = `You are an event verification agent for a rideshare intelligence platform.
Your job is to verify events and assess their impact on rideshare demand.

For each event, verify:
1. VALIDITY: Does the event data look real and accurate? (Check for realistic venue, title, dates)
2. FRESHNESS: Is end_time in the future? (Current time will be provided)
3. IMPACT: Rate impact on rideshare demand based on event type and expected attendance
   - high: Major concerts, sports games, festivals (1000+ attendees expected)
   - med: Medium events, theater shows, conferences (100-1000 attendees)
   - low: Small events, local meetups (under 100 attendees)
   - none: No significant rideshare impact

Return ONLY valid JSON in this exact format:
{
  "valid": true or false,
  "fresh": true or false,
  "impact_hint": "none" or "low" or "med" or "high",
  "confidence": 0.0 to 1.0,
  "reasoning": "Brief explanation of verification result"
}`;

/**
 * Verify a single event using the fallback model chain
 * @param {Object} event - Event object with title, start_time, end_time, venue, etc.
 * @param {Date} currentTime - Current time for freshness check
 * @returns {Promise<Object>} - Verification result
 */
export async function verifyEvent(event, currentTime = new Date()) {
  const prompt = `Current time: ${currentTime.toISOString()}

Event to verify:
${JSON.stringify(event, null, 2)}

Verify this event and return JSON only. Check if the event is valid, fresh (not expired), and assess its rideshare impact.`;

  try {
    console.log(`[event-verifier] Verifying event: ${event.title || event.event_title || 'unknown'}`);

    const result = await agentAsk({
      system: VERIFICATION_SYSTEM,
      user: prompt,
      json: true
    });

    // Parse the JSON response
    let parsed;
    try {
      parsed = typeof result.text === 'string' ? JSON.parse(result.text) : result.text;
    } catch (parseError) {
      // Try extracting JSON from the response
      const text = String(result.text);
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start !== -1 && end > start) {
        parsed = JSON.parse(text.slice(start, end + 1));
      } else {
        throw parseError;
      }
    }

    console.log(`[event-verifier] ✅ Verified: valid=${parsed.valid}, fresh=${parsed.fresh}, impact=${parsed.impact_hint}`);

    return {
      valid: Boolean(parsed.valid),
      fresh: Boolean(parsed.fresh),
      impact_hint: parsed.impact_hint || 'none',
      confidence: parseFloat(parsed.confidence) || 0,
      reasoning: parsed.reasoning || '',
      provider: result.provider,
      elapsed_ms: result.elapsed_ms
    };
  } catch (err) {
    console.error(`[event-verifier] ❌ Verification failed:`, err.message);

    // Return conservative defaults on failure
    return {
      valid: false,
      fresh: false,
      impact_hint: 'none',
      confidence: 0,
      reasoning: `Verification failed: ${err.message}`,
      error: true
    };
  }
}

/**
 * Verify multiple events in parallel
 * @param {Array} events - Array of event objects
 * @param {Date} currentTime - Current time for freshness check
 * @returns {Promise<Array>} - Array of verification results
 */
export async function verifyEventBatch(events, currentTime = new Date()) {
  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }

  console.log(`[event-verifier] Batch verifying ${events.length} events`);

  // Verify events in parallel with a concurrency limit
  const BATCH_SIZE = 5;
  const results = [];

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(event => verifyEvent(event, currentTime))
    );
    results.push(...batchResults);
  }

  console.log(`[event-verifier] Batch complete: ${results.filter(r => r.valid).length}/${events.length} valid`);

  return results;
}

/**
 * Filter events keeping only those that pass verification
 * @param {Array} events - Array of event objects
 * @param {Date} currentTime - Current time for freshness check
 * @param {Object} options - Filter options
 * @param {boolean} options.requireFresh - Only keep fresh events (default: true)
 * @param {boolean} options.requireValid - Only keep valid events (default: true)
 * @param {number} options.minConfidence - Minimum confidence threshold (default: 0.5)
 * @returns {Promise<Array>} - Filtered array of events with verification attached
 */
export async function filterVerifiedEvents(events, currentTime = new Date(), options = {}) {
  const {
    requireFresh = true,
    requireValid = true,
    minConfidence = 0.5
  } = options;

  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }

  const verifications = await verifyEventBatch(events, currentTime);

  return events
    .map((event, index) => ({
      ...event,
      _verification: verifications[index]
    }))
    .filter((event, index) => {
      const v = verifications[index];

      if (requireValid && !v.valid) return false;
      if (requireFresh && !v.fresh) return false;
      if (v.confidence < minConfidence) return false;

      return true;
    });
}

/**
 * Quick freshness check without full verification
 * Uses local logic only, no LLM call
 * @param {Object} event - Event object
 * @param {Date} currentTime - Current time
 * @returns {boolean} - True if event is fresh
 */
export function isEventFresh(event, currentTime = new Date()) {
  const endTime = event.end_time || event.endTime || event.end_time_iso || event.endsAt || event.ends_at;

  if (!endTime) return true; // Keep events without end_time

  try {
    return new Date(endTime) > currentTime;
  } catch {
    return true; // Keep events with unparseable dates
  }
}
