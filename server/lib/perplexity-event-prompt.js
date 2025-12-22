// server/lib/perplexity-event-prompt.js
// Perplexity prompt templates for event research (runtime-fresh, no hardcoded locations)

/**
 * Generate Perplexity prompt for event research
 * @param {Object} params - Research parameters
 * @param {string} params.venueOrDistrictName - Venue/district name from runtime
 * @param {string} params.date - Date in YYYY-MM-DD format
 * @param {string} params.windowStartIso - Start of time window (ISO 8601)
 * @param {string} params.windowEndIso - End of time window (ISO 8601)
 * @param {string} params.city - City name from runtime snapshot
 * @param {string} params.state - State from runtime snapshot
 * @returns {string} Perplexity prompt
 */
function generateEventResearchPrompt({
  venueOrDistrictName,
  date,
  windowStartIso,
  windowEndIso,
  city,
  state
}) {
  return `Return strict JSON about events for ${date} between ${windowStartIso} and ${windowEndIso} 
near "${venueOrDistrictName}" in ${city}, ${state}.

For each event include:
- title: string (event name)
- start_time_iso: string (ISO 8601 with timezone)
- end_time_iso: string (ISO 8601 with timezone)
- venue_name: string (venue or district name)
- coordinates: {lat: number|null, lng: number|null} (omit if unknown)
- radius_hint_m: number|null (approximate crowd/footprint radius if known, else null)
- confidence: number (0.0-1.0, how sure you are this event exists)
- source_urls: string[] (verification links)
- impact_hint: string ("none"|"low"|"med"|"high" - expected rideshare demand impact)
- notes: string (additional context)

No prose. Return ONLY a JSON array. If no events found, return [].`;
}

/**
 * Generate multi-venue event research prompt
 * @param {Object} params
 * @param {Array<string>} params.venueNames - List of venue names from runtime
 * @param {string} params.date
 * @param {string} params.windowStartIso
 * @param {string} params.windowEndIso
 * @param {string} params.city
 * @param {string} params.state
 * @returns {string} Perplexity prompt
 */
function generateBulkEventResearchPrompt({
  venueNames,
  date,
  windowStartIso,
  windowEndIso,
  city,
  state
}) {
  const venueList = venueNames.map(v => `- ${v}`).join('\n');
  
  return `Return strict JSON about events for ${date} between ${windowStartIso} and ${windowEndIso} 
at or near these venues in ${city}, ${state}:

${venueList}

For each event include:
- title: string
- start_time_iso: string (ISO 8601)
- end_time_iso: string (ISO 8601)
- venue_name: string (which venue from the list, or "nearby")
- coordinates: {lat: number|null, lng: number|null}
- radius_hint_m: number|null
- confidence: number (0.0-1.0)
- source_urls: string[]
- impact_hint: string ("none"|"low"|"med"|"high")
- notes: string

No prose. Return ONLY a JSON array. If no events found, return [].`;
}

/**
 * Parse Perplexity event response and normalize
 * @param {string} responseText - Raw Perplexity response
 * @returns {Array<Object>} Normalized event objects
 */
function parseEventResponse(responseText) {
  try {
    // Try to extract JSON array from response (handles prose wrapping)
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn('[perplexity] No JSON array found in response');
      return [];
    }
    
    const events = JSON.parse(jsonMatch[0]);
    
    const now = new Date();

    // Normalize and validate
    return events.map(e => ({
      title: e.title || e.event_title || 'Untitled Event',
      start_time_iso: e.start_time_iso || e.start_time,
      end_time_iso: e.end_time_iso || e.end_time,
      venue_name: e.venue_name,
      coordinates: e.coordinates || null,
      radius_hint_m: e.radius_hint_m || null,
      confidence: Math.max(0, Math.min(1, parseFloat(e.confidence || 0.7))),
      source_urls: Array.isArray(e.source_urls) ? e.source_urls : [],
      impact_hint: ['none', 'low', 'med', 'high'].includes(e.impact_hint)
        ? e.impact_hint
        : 'none',
      notes: e.notes || '',
      coordinates_source: 'perplexity',
      location_quality: e.coordinates ? 'approx' : null
    })).filter(e => {
      // Must have time window
      if (!e.start_time_iso || !e.end_time_iso) return false;

      // Filter out events that have already ended (stale data)
      try {
        const endTime = new Date(e.end_time_iso);
        if (endTime < now) {
          console.log(`[perplexity] Filtering stale event: "${e.title}" (ended ${e.end_time_iso})`);
          return false;
        }
      } catch {
        // Keep events with unparseable dates
      }

      return true;
    });
  } catch (err) {
    console.error('[perplexity] Failed to parse event response:', err.message);
    return [];
  }
}

/**
 * Generate event research request for specific district/zone
 * @param {Object} snapshot - Snapshot object with location data
 * @param {string} districtName - District name (e.g., "Legacy West")
 * @param {string} timeWindow - Time window duration (e.g., "4 hours")
 * @returns {Object} Request object with prompt and metadata
 */
function generateDistrictEventRequest(snapshot, districtName, timeWindow = '4 hours') {
  const now = new Date(snapshot.created_at);
  const windowStart = new Date(now);
  const windowEnd = new Date(now.getTime() + 4 * 60 * 60 * 1000); // 4 hours default
  
  return {
    prompt: generateEventResearchPrompt({
      venueOrDistrictName: districtName,
      date: now.toISOString().split('T')[0],
      windowStartIso: windowStart.toISOString(),
      windowEndIso: windowEnd.toISOString(),
      city: snapshot.city,
      state: snapshot.state
    }),
    metadata: {
      snapshot_id: snapshot.snapshot_id,
      district: districtName,
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString()
    }
  };
}

export {
  generateEventResearchPrompt,
  generateBulkEventResearchPrompt,
  parseEventResponse,
  generateDistrictEventRequest
};
