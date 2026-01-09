// server/lib/venue-event-verifier.js
// Verify venue events using AI after SmartBlocks enrichment
// Updated 2026-01-05: Migrated from gemini-2.5-pro.js to callModel with VENUE_EVENT_VERIFIER role
import { callModel } from '../ai/adapters/index.js';

/**
 * Verify a single venue event - confirm it's real and relevant
 * @param {string} venueName - Venue name
 * @param {string} venueBadge - Event badge/category
 * @param {string} eventSummary - Event description
 * @param {number} lat - Venue latitude
 * @param {number} lng - Venue longitude
 * @param {string} city - City
 * @returns {Promise<{verified: boolean, confidence: number, impact: 'high'|'medium'|'low', reasoning: string}>}
 */
export async function verifyVenueEvent(venueName, venueBadge, eventSummary, lat, lng, city) {
  if (!venueBadge || !eventSummary) {
    return { verified: false, confidence: 0, impact: 'low', reasoning: 'No event data provided' };
  }

  try {
    const prompt = `Verify this venue event and assess its impact on rideshare demand:
    
Venue: ${venueName}
Location: ${city} (${parseFloat(lat).toFixed(6)},${parseFloat(lng).toFixed(6)})
Event Badge: ${venueBadge}
Event Summary: ${eventSummary}

Respond with JSON: {
  "verified": boolean,
  "confidence": number (0-100),
  "impact": "high"|"medium"|"low",
  "reasoning": string
}

- verified=true if this is a real, significant event (not spam/outdated)
- confidence: 0-100% confidence this event affects rideshare demand NOW
- impact: high (major event, expect surge), medium (notable event), low (minor event)
- reasoning: brief explanation`;

    // Use VENUE_EVENT_VERIFIER role from model-registry.js
    // Updated 2026-01-05: Migrated from callGeminiGenerateContent to callModel
    const result = await callModel('VENUE_EVENT_VERIFIER', {
      system: 'You are an event intelligence analyst for rideshare demand. Verify events and assess their impact on driver demand.',
      user: prompt
    });

    if (!result.ok) {
      throw new Error(result.error || 'Event verification failed');
    }

    const parsed = JSON.parse(result.output);
    console.log(`[event-verifier] Verified ${venueName}: ${parsed.verified} (confidence=${parsed.confidence}, impact=${parsed.impact})`);
    
    return {
      verified: parsed.verified === true,
      confidence: Math.max(0, Math.min(100, parsed.confidence || 0)),
      impact: parsed.impact || 'low',
      reasoning: parsed.reasoning
    };
  } catch (err) {
    console.error('[event-verifier] Error:', err.message);
    return { verified: false, confidence: 0, impact: 'low', reasoning: err.message };
  }
}

/**
 * Batch verify events for multiple venues
 * @param {Array} blocks - Array of {name, eventBadge, eventSummary, lat, lng, city}
 * @returns {Promise<Object>} - Map of venue key -> verification result
 */
export async function verifyVenueEventsBatch(blocks) {
  const results = {};
  
  // Only verify blocks with events
  const blocksWithEvents = blocks.filter(b => b.eventBadge && b.eventSummary);
  
  if (blocksWithEvents.length === 0) {
    console.log('[event-verifier] No events to verify');
    return results;
  }

  console.log(`[event-verifier] Verifying ${blocksWithEvents.length} events in parallel...`);
  
  // Process in parallel chunks (max 3 concurrent)
  const chunks = [];
  for (let i = 0; i < blocksWithEvents.length; i += 3) {
    chunks.push(blocksWithEvents.slice(i, i + 3));
  }
  
  for (const chunk of chunks) {
    const promises = chunk.map(async (b) => {
      const key = `${b.lat},${b.lng}`;
      try {
        const verification = await verifyVenueEvent(
          b.name,
          b.eventBadge,
          b.eventSummary,
          b.lat,
          b.lng,
          b.city
        );
        return { key, verification };
      } catch (err) {
        console.warn(`[event-verifier] Failed for ${b.name}:`, err.message);
        return { key, verification: { verified: false, confidence: 0, impact: 'low', reasoning: err.message } };
      }
    });
    
    const resolved = await Promise.all(promises);
    resolved.forEach(({ key, verification }) => {
      results[key] = verification;
    });
  }
  
  return results;
}

/**
 * Extract high-confidence events for strategy context
 * @param {Array} blocks - Blocks with event data
 * @param {Object} verificationMap - Verification results
 * @returns {Array} - High-confidence events suitable for strategy
 */
export function extractVerifiedEvents(blocks, verificationMap) {
  const verifiedEvents = [];
  
  blocks.forEach(block => {
    const key = `${block.lat},${block.lng}`;
    const verification = verificationMap[key];
    
    // Include event if: verified AND confidence >= 70% AND high/medium impact
    if (verification?.verified && verification.confidence >= 70 && ['high', 'medium'].includes(verification.impact)) {
      verifiedEvents.push({
        venue: block.name,
        event: block.eventBadge,
        summary: block.eventSummary,
        impact: verification.impact,
        confidence: verification.confidence,
        distance_miles: block.distance_miles
      });
    }
  });
  
  return verifiedEvents.sort((a, b) => b.impact === 'high' ? -1 : b.impact === 'medium' ? -1 : 1);
}
