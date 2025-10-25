// server/lib/venue-event-research.js
// Research today's events at recommended venues using Perplexity

import { PerplexityResearch } from './perplexity-research.js';

/**
 * Research events happening today at a specific venue
 * @param {string} venueName - Full venue name
 * @param {string} city - City where venue is located
 * @param {string} date - Today's date in YYYY-MM-DD format
 * @returns {Promise<Object>} Event data with summary, citations, impact
 */
export async function researchVenueEvents(venueName, city, date = null) {
  const perplexity = new PerplexityResearch();
  
  // Use provided date or today's date
  const targetDate = date || new Date().toISOString().split('T')[0];
  const dayName = new Date(targetDate).toLocaleDateString('en-US', { weekday: 'long' });
  
  const query = `Events happening today (${dayName}, ${targetDate}) at ${venueName} in ${city}. Include concerts, games, festivals, shows, or any special events. If no events, say "no scheduled events".`;

  try {
    const result = await perplexity.search(query, {
      systemPrompt: 'You are a local events researcher helping rideshare drivers. Provide concise summaries of events happening TODAY at specific venues. Include event name, time, and expected crowd size if available. If no events are scheduled, clearly state "No scheduled events today".',
      maxTokens: 300,
      temperature: 0.2,
      searchRecencyFilter: 'day' // Only search today's news
    });

    return {
      venue_name: venueName,
      has_events: !result.answer.toLowerCase().includes('no scheduled events') && 
                  !result.answer.toLowerCase().includes('no events'),
      summary: result.answer,
      citations: result.citations || [],
      impact_level: assessEventImpact(result.answer),
      researched_at: new Date().toISOString(),
      date: targetDate
    };
  } catch (error) {
    console.error(`[venue-events] Error researching ${venueName}:`, error.message);
    return {
      venue_name: venueName,
      has_events: false,
      summary: 'Event research unavailable',
      citations: [],
      impact_level: 'unknown',
      error: error.message,
      researched_at: new Date().toISOString(),
      date: targetDate
    };
  }
}

/**
 * Assess the expected rideshare demand impact based on event description
 * @param {string} summary - Event summary from Perplexity
 * @returns {string} Impact level: 'high', 'medium', 'low', or 'none'
 */
function assessEventImpact(summary) {
  const lowerSummary = summary.toLowerCase();
  
  // No events
  if (lowerSummary.includes('no scheduled events') || 
      lowerSummary.includes('no events') ||
      lowerSummary.includes('event research unavailable')) {
    return 'none';
  }
  
  // High demand events: concerts, sports, festivals
  if (lowerSummary.includes('concert') || 
      lowerSummary.includes('game') ||
      lowerSummary.includes('festival') ||
      lowerSummary.includes('championship') ||
      lowerSummary.includes('thousands') ||
      lowerSummary.includes('sold out')) {
    return 'high';
  }
  
  // Medium demand: shows, conferences, exhibitions
  if (lowerSummary.includes('show') || 
      lowerSummary.includes('conference') ||
      lowerSummary.includes('exhibition') ||
      lowerSummary.includes('event')) {
    return 'medium';
  }
  
  // Default to low if events mentioned but not high/medium
  return 'low';
}

/**
 * Research events for multiple venues in parallel
 * @param {Array<{name: string, city: string}>} venues - List of venues to research
 * @param {string} date - Date to check (optional)
 * @returns {Promise<Array>} Array of event research results
 */
export async function researchMultipleVenueEvents(venues, date = null) {
  console.log(`[venue-events] Researching events for ${venues.length} venues...`);
  
  const results = await Promise.allSettled(
    venues.map(v => researchVenueEvents(v.name, v.city, date))
  );

  const processed = results.map((result, idx) => {
    const venue = venues[idx];
    
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error(`[venue-events] Failed for ${venue.name}:`, result.reason);
      return {
        venue_name: venue.name,
        has_events: false,
        summary: 'Research failed',
        citations: [],
        impact_level: 'unknown',
        error: result.reason?.message || 'Unknown error',
        researched_at: new Date().toISOString(),
        date: date || new Date().toISOString().split('T')[0]
      };
    }
  });

  // Log summary
  const withEvents = processed.filter(p => p.has_events).length;
  const highImpact = processed.filter(p => p.impact_level === 'high').length;
  console.log(`[venue-events] ✅ Research complete: ${withEvents}/${venues.length} venues have events, ${highImpact} high-impact`);

  return processed;
}

export default {
  researchVenueEvents,
  researchMultipleVenueEvents,
  assessEventImpact
};
