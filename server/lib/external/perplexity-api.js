/**
 * PERPLEXITY SONAR API - Real-Time Web Search for Briefing Data
 *
 * Uses Perplexity Sonar Pro for grounded, citation-backed searches.
 * Replaces Gemini's google_search tool for specific use cases:
 * - Events discovery (concerts, sports, festivals, etc.)
 * - Rideshare news
 * - Traffic conditions
 *
 * Benefits over Gemini google_search:
 * - Built-in citations (return_citations: true)
 * - Recency filtering (search_recency_filter: 'day'/'week'/'month')
 * - Faster for simple factual queries
 *
 * Cost: ~$5 per 1M tokens (Sonar Pro)
 */

import { briefingLog, OP } from '../../logger/workflow.js';

const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';

/**
 * Call Perplexity Sonar Pro API for web search
 * @param {Object} options
 * @param {string} options.query - The search query
 * @param {string} options.systemPrompt - System context for the model
 * @param {string} options.recency - 'day', 'week', 'month', or undefined for no filter
 * @param {number} options.maxTokens - Maximum output tokens (default 1024)
 * @returns {Promise<{ok: boolean, output: string, citations: string[], error?: string}>}
 */
export async function callPerplexitySonar({
  query,
  systemPrompt = 'You are a helpful assistant that provides accurate, real-time information. Return responses as valid JSON only.',
  recency = 'day',
  maxTokens = 1024
}) {
  const apiKey = process.env.PERPLEXITY_API_KEY;

  if (!apiKey) {
    briefingLog.warn(2, `PERPLEXITY_API_KEY not configured`, OP.AI);
    return { ok: false, output: '', citations: [], error: 'PERPLEXITY_API_KEY not configured' };
  }

  const body = {
    model: 'sonar-pro',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: query }
    ],
    temperature: 0.7,           // Increased for more creative/thorough search
    top_p: 0.95,                // Slightly higher for more diverse results
    max_tokens: maxTokens,
    return_citations: false,    // No citations needed
    search_context_size: 'high' // More search context for better results
  };

  // Add recency filter if specified
  if (recency && ['day', 'week', 'month'].includes(recency)) {
    body.search_recency_filter = recency;
  }

  // Retry configuration for transient errors (502, 503, 429)
  const MAX_RETRIES = 2;
  const BASE_DELAY_MS = 1500;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const startTime = Date.now();
      const response = await fetch(PERPLEXITY_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const elapsedMs = Date.now() - startTime;

      // Handle retryable errors (502 Bad Gateway, 503 Service Unavailable, 429 Rate Limited)
      if ([502, 503, 429].includes(response.status)) {
        if (attempt <= MAX_RETRIES) {
          const delay = BASE_DELAY_MS * attempt;
          console.log(`[Perplexity] ${response.status} error - retry ${attempt}/${MAX_RETRIES} in ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        // Final attempt failed
        const errorText = await response.text();
        briefingLog.error(2, `Perplexity API ${response.status} after ${MAX_RETRIES} retries`, null, OP.AI);
        return { ok: false, output: '', citations: [], error: `Perplexity API ${response.status} after retries` };
      }

      if (!response.ok) {
        const errorText = await response.text();
        briefingLog.error(2, `Perplexity API ${response.status} in ${elapsedMs}ms: ${errorText.substring(0, 100)}`, null, OP.AI);
        return { ok: false, output: '', citations: [], error: `Perplexity API ${response.status}: ${errorText.substring(0, 200)}` };
      }

      const data = await response.json();
      const output = data.choices?.[0]?.message?.content?.trim() || '';
      const citations = data.citations || [];

      // Debug logging to see what Perplexity returns
      console.log(`[Perplexity] Response in ${elapsedMs}ms: ${output.length} chars, ${citations.length} citations`);
      if (output.length < 500) {
        console.log(`[Perplexity] Full output: ${output}`);
      } else {
        console.log(`[Perplexity] Output preview: ${output.substring(0, 300)}...`);
      }

      if (!output) {
        briefingLog.warn(2, `Perplexity returned empty output`, OP.AI);
        return { ok: false, output: '', citations, error: 'Empty response from Perplexity' };
      }

      return { ok: true, output, citations };
    } catch (error) {
      // Network errors - retry if we have attempts left
      if (attempt <= MAX_RETRIES) {
        const delay = BASE_DELAY_MS * attempt;
        console.log(`[Perplexity] Network error - retry ${attempt}/${MAX_RETRIES} in ${delay}ms: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      briefingLog.error(2, `Perplexity fetch error: ${error.message}`, error, OP.AI);
      return { ok: false, output: '', citations: [], error: error.message };
    }
  }

  // Should never reach here, but just in case
  return { ok: false, output: '', citations: [], error: 'Max retries exceeded' };
}

/**
 * Search for events in a specific category using Perplexity
 * @param {Object} options
 * @param {string} options.category - Event category name
 * @param {string} options.searchQuery - Pre-built search query
 * @param {string} options.city - City name
 * @param {string} options.state - State code
 * @param {string} options.date - Date string (YYYY-MM-DD)
 * @returns {Promise<{category: string, items: Array, citations: string[], error?: string}>}
 */
export async function searchEventCategory({ category, searchQuery, city, state, date }) {
  // Balance between getting JSON and allowing thorough search
  const systemPrompt = `You are an event discovery assistant for ${city}, ${state}. Search thoroughly for events happening TODAY (${date}).

Your task: Find real events and return them as a JSON array.

Format each event as:
{"title":"Event Name","venue":"Venue Name","address":"Full Address","event_time":"7:00 PM","subtype":"concert","impact":"high"}

Rules:
- Search multiple sources to find events
- Include events at restaurants, bars, venues, arenas, theaters, hotels
- "impact" should be "high" for large events (500+ people), "medium" for moderate, "low" for small
- Return a JSON array of events found
- If truly no events exist, return []

Return the JSON array:`;

  const result = await callPerplexitySonar({
    query: searchQuery,
    systemPrompt,
    recency: 'week',  // Expanded to week to catch recurring/upcoming events
    maxTokens: 4096   // Increased for more detailed responses
  });

  if (!result.ok) {
    console.log(`[Perplexity] ${category} search failed: ${result.error}`);
    return { category, items: [], citations: [], error: result.error };
  }

  try {
    // Clean markdown if present
    let cleanOutput = result.output
      .replace(/^```json\s*/i, '')
      .replace(/\s*```$/i, '')
      .replace(/^```\s*/i, '')
      .trim();

    // Try to extract JSON array from prose response
    const jsonMatch = cleanOutput.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      cleanOutput = jsonMatch[0];
    } else if (!cleanOutput.startsWith('[')) {
      // Perplexity returned prose, not JSON - extract any event-like data
      console.log(`[Perplexity] ${category} returned prose instead of JSON: ${cleanOutput.substring(0, 100)}...`);
      return { category, items: [], citations: result.citations, error: 'Response was prose, not JSON array' };
    }

    const parsed = JSON.parse(cleanOutput);
    const items = Array.isArray(parsed) ? parsed.filter(e => e.title && e.venue) : [];

    console.log(`[Perplexity] ${category}: parsed ${items.length} events`);
    return { category, items, citations: result.citations };
  } catch (parseErr) {
    console.log(`[Perplexity] ${category} parse error: ${parseErr.message}`);
    console.log(`[Perplexity] ${category} raw output: ${result.output.substring(0, 200)}`);
    return { category, items: [], citations: result.citations, error: `Parse error: ${parseErr.message}` };
  }
}

/**
 * Parallel event search across multiple categories using Perplexity
 * This is the main function to replace Gemini parallel event searches
 *
 * @param {Object} options
 * @param {string} options.city - City name
 * @param {string} options.state - State code
 * @param {string} options.date - Date string (YYYY-MM-DD)
 * @param {number} options.lat - Latitude
 * @param {number} options.lng - Longitude
 * @param {string} options.formattedAddress - Full formatted address for better search context
 * @returns {Promise<{items: Array, citations: string[], errors: string[]}>}
 */
export async function searchEventsParallel({ city, state, date, lat, lng, formattedAddress }) {
  const startTime = Date.now();

  // Use formatted address if available, otherwise fall back to city/state
  const locationContext = formattedAddress || `${city}, ${state}`;
  const radiusMiles = 25;

  // Define event categories with detailed search queries including 25-mile radius
  const eventCategories = [
    {
      name: 'concerts_music',
      query: `What concerts, live music shows, and musical performances are happening within ${radiusMiles} miles of ${locationContext} on ${date}? Include venue names, addresses, and times.`
    },
    {
      name: 'sports',
      query: `What sports games and athletic events are happening within ${radiusMiles} miles of ${locationContext} on ${date}? Include NBA, NFL, NHL, MLB, MLS, college sports, high school playoffs. Include venue names and times.`
    },
    {
      name: 'comedy_theater',
      query: `What comedy shows, standup performances, theater productions, and stage performances are happening within ${radiusMiles} miles of ${locationContext} on ${date}? Include venue names and times.`
    },
    {
      name: 'festivals_community',
      query: `What festivals, holiday events, Christmas events, community gatherings, parades, or special events are happening within ${radiusMiles} miles of ${locationContext} on ${date}? Include venue names and times.`
    },
    {
      name: 'nightlife',
      query: `What nightclub events, DJ performances, bar events, and nightlife happenings are within ${radiusMiles} miles of ${locationContext} tonight ${date}? Include venue names and times.`
    }
  ];

  briefingLog.ai(2, 'Perplexity', `5 parallel event searches for ${city}, ${state}`);

  // Execute all searches in parallel
  const searchPromises = eventCategories.map(cat =>
    searchEventCategory({
      category: cat.name,
      searchQuery: cat.query,
      city,
      state,
      date
    })
  );

  const results = await Promise.all(searchPromises);

  // Merge results, deduplicate, and collect citations
  const allEvents = [];
  const allCitations = [];
  const errors = [];
  const seenTitles = new Set();
  const categoryResults = [];

  for (const result of results) {
    // Track per-category results for logging
    categoryResults.push(`${result.category}=${result.items.length}`);

    // Collect citations
    if (result.citations?.length > 0) {
      allCitations.push(...result.citations);
    }

    // Collect errors
    if (result.error) {
      errors.push(`${result.category}: ${result.error}`);
    }

    // Deduplicate events by title
    for (const event of result.items) {
      const titleKey = event.title?.toLowerCase().trim();
      if (titleKey && !seenTitles.has(titleKey)) {
        seenTitles.add(titleKey);
        allEvents.push({
          ...event,
          source: 'Perplexity Sonar Pro',
          category: result.category
        });
      }
    }
  }

  const elapsedMs = Date.now() - startTime;

  // Detailed logging for debugging
  console.log(`[Perplexity] Event search results: ${categoryResults.join(', ')}`);
  if (errors.length > 0) {
    console.log(`[Perplexity] Errors: ${errors.join('; ')}`);
  }

  briefingLog.done(2, `${allEvents.length} events (${categoryResults.join(', ')}), ${allCitations.length} citations in ${elapsedMs}ms`, OP.AI);

  return {
    items: allEvents,
    citations: [...new Set(allCitations)], // Dedupe citations
    errors: errors.length > 0 ? errors : undefined
  };
}

/**
 * Search for rideshare news using Perplexity
 * @param {Object} options
 * @param {string} options.city - City name
 * @param {string} options.state - State code
 * @param {string} options.date - Date string (YYYY-MM-DD)
 * @returns {Promise<{items: Array, citations: string[], error?: string}>}
 */
export async function searchRideshareNews({ city, state, date }) {
  const startTime = Date.now();
  briefingLog.ai(2, 'Perplexity', `rideshare news for ${city}, ${state}`);

  // More explicit JSON-only instruction
  const systemPrompt = `You are a rideshare news analyst. Search for news relevant to Uber/Lyft drivers in ${city}, ${state}.

CRITICAL: Return ONLY a JSON array, no other text. Format:
[{"title":"News Title","summary":"One sentence summary","impact":"high","source":"Source Name","link":"https://..."}]

Focus on: driver earnings, regulations, local events affecting demand, app updates.
Return 2-5 items. If no news found, return exactly: []

DO NOT include any explanation, just the JSON array.`;

  const result = await callPerplexitySonar({
    query: `rideshare driver news ${city} ${state} ${date} Uber Lyft earnings regulations demand`,
    systemPrompt,
    recency: 'week',
    maxTokens: 2048
  });

  if (!result.ok) {
    briefingLog.warn(2, `News search failed: ${result.error}`, OP.AI);
    return { items: [], citations: [], error: result.error };
  }

  try {
    let cleanOutput = result.output
      .replace(/^```json\s*/i, '')
      .replace(/\s*```$/i, '')
      .replace(/^```\s*/i, '')
      .trim();

    const jsonMatch = cleanOutput.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      cleanOutput = jsonMatch[0];
    } else if (!cleanOutput.startsWith('[')) {
      console.log(`[Perplexity] news returned prose instead of JSON: ${cleanOutput.substring(0, 100)}...`);
      return { items: [], citations: result.citations, error: 'Response was prose, not JSON array' };
    }

    const parsed = JSON.parse(cleanOutput);
    const items = Array.isArray(parsed) ? parsed.filter(n => n.title) : [];

    const elapsedMs = Date.now() - startTime;
    briefingLog.done(2, `${items.length} news items in ${elapsedMs}ms`, OP.AI);

    return { items, citations: result.citations };
  } catch (parseErr) {
    console.log(`[Perplexity] news parse error: ${parseErr.message}`);
    console.log(`[Perplexity] news raw output: ${result.output.substring(0, 200)}`);
    briefingLog.warn(2, `News parse failed: ${parseErr.message}`, OP.AI);
    return { items: [], citations: result.citations, error: parseErr.message };
  }
}

/**
 * Search for traffic conditions using Perplexity
 * @param {Object} options
 * @param {string} options.city - City name
 * @param {string} options.state - State code
 * @param {string} options.date - Date string (YYYY-MM-DD)
 * @returns {Promise<{traffic: Object, citations: string[], error?: string}>}
 */
export async function searchTrafficConditions({ city, state, date, formattedAddress }) {
  const startTime = Date.now();
  briefingLog.ai(1, 'Perplexity', `traffic for ${city}, ${state}`);

  // Use formatted address if available for better search context
  const locationContext = formattedAddress || `${city}, ${state}`;
  const radiusMiles = 25;

  // Comprehensive traffic search for rideshare drivers
  const systemPrompt = `You are a traffic analyst helping rideshare drivers in the ${city}, ${state} area.

Search for current traffic conditions within ${radiusMiles} miles of ${locationContext}.

Return a JSON object with:
{"summary":"One sentence overview","congestionLevel":"low|medium|high","incidents":[{"description":"I-35 accident near exit 42","severity":"high|medium|low","location":"specific location"}],"construction":[{"description":"Lane closure on US-75","location":"Between exits 10-12","impact":"medium"}],"roadClosures":[{"road":"Main St","reason":"Event","detour":"Use Oak Ave"}],"highDemandZones":[{"zone":"Downtown","reason":"Rush hour"}],"repositioning":"Specific advice on where drivers should position for best rides","surgePricing":false}

Include accidents, construction, road closures, and any traffic-affecting events.
Return ONLY the JSON object.`;

  const result = await callPerplexitySonar({
    query: `What are current traffic conditions, accidents, road closures, and construction within ${radiusMiles} miles of ${locationContext} today ${date}? Include highway incidents, lane closures, and detours.`,
    systemPrompt,
    recency: 'day',
    maxTokens: 2048
  });

  if (!result.ok) {
    briefingLog.warn(1, `Traffic search failed: ${result.error}`, OP.AI);
    return {
      traffic: {
        summary: `Traffic data unavailable for ${city}, ${state}`,
        congestionLevel: 'medium',
        incidents: [],
        highDemandZones: [],
        isFallback: true
      },
      citations: [],
      error: result.error
    };
  }

  try {
    let cleanOutput = result.output
      .replace(/^```json\s*/i, '')
      .replace(/\s*```$/i, '')
      .replace(/^```\s*/i, '')
      .trim();

    // For nested JSON objects, we need greedy matching (not *?)
    // Find the outermost { } pair by counting braces
    let jsonStr = null;
    if (cleanOutput.includes('{')) {
      const startIdx = cleanOutput.indexOf('{');
      let braceCount = 0;
      let endIdx = -1;

      for (let i = startIdx; i < cleanOutput.length; i++) {
        if (cleanOutput[i] === '{') braceCount++;
        if (cleanOutput[i] === '}') braceCount--;
        if (braceCount === 0) {
          endIdx = i;
          break;
        }
      }

      if (endIdx > startIdx) {
        jsonStr = cleanOutput.substring(startIdx, endIdx + 1);
      }
    }

    if (!jsonStr) {
      console.log(`[Perplexity] traffic returned prose instead of JSON: ${cleanOutput.substring(0, 100)}...`);
      return {
        traffic: {
          summary: `Traffic data format error for ${city}, ${state}`,
          congestionLevel: 'medium',
          incidents: [],
          highDemandZones: [],
          isFallback: true
        },
        citations: result.citations,
        error: 'Response was prose, not JSON object'
      };
    }

    cleanOutput = jsonStr;
    const parsed = JSON.parse(cleanOutput);

    const elapsedMs = Date.now() - startTime;
    briefingLog.done(1, `Traffic: ${parsed.congestionLevel || 'unknown'} in ${elapsedMs}ms`, OP.AI);

    return {
      traffic: {
        summary: parsed.summary || `Traffic conditions for ${city}, ${state}`,
        congestionLevel: parsed.congestionLevel || 'medium',
        incidents: Array.isArray(parsed.incidents) ? parsed.incidents : [],
        construction: Array.isArray(parsed.construction) ? parsed.construction : [],
        roadClosures: Array.isArray(parsed.roadClosures) ? parsed.roadClosures : [],
        highDemandZones: Array.isArray(parsed.highDemandZones) ? parsed.highDemandZones : [],
        repositioning: parsed.repositioning || null,
        surgePricing: parsed.surgePricing || false,
        fetchedAt: new Date().toISOString()
      },
      citations: []
    };
  } catch (parseErr) {
    console.log(`[Perplexity] traffic parse error: ${parseErr.message}`);
    console.log(`[Perplexity] traffic raw output: ${result.output.substring(0, 200)}`);
    briefingLog.warn(1, `Traffic parse failed: ${parseErr.message}`, OP.AI);
    return {
      traffic: {
        summary: `Traffic data parse error for ${city}, ${state}`,
        congestionLevel: 'medium',
        incidents: [],
        highDemandZones: [],
        isFallback: true
      },
      citations: result.citations,
      error: parseErr.message
    };
  }
}

/**
 * Search for airport/flight information relevant to rideshare drivers
 * Includes delays, arrivals, departures, and airport conditions
 *
 * @param {Object} options
 * @param {string} options.city - City name
 * @param {string} options.state - State code
 * @param {string} options.date - Date string (YYYY-MM-DD)
 * @param {string} options.formattedAddress - Full formatted address
 * @param {Object} options.airportContext - Airport context from snapshot (if available)
 * @returns {Promise<{airport: Object, error?: string}>}
 */
export async function searchAirportConditions({ city, state, date, formattedAddress, airportContext }) {
  const startTime = Date.now();

  // Use formatted address if available for better search context
  const locationContext = formattedAddress || `${city}, ${state}`;
  const radiusMiles = 40; // 40-mile radius for airports (covers DFW + Dallas Love Field)

  briefingLog.ai(2, 'Perplexity', `airport/flights for ${city}, ${state}`);

  // Comprehensive airport search for rideshare drivers
  const systemPrompt = `You are an airport analyst helping rideshare drivers near ${city}, ${state}.

Search for current airport conditions, flight delays, and arrival/departure information at ALL airports within ${radiusMiles} miles of ${locationContext}.

Return a JSON object with:
{
  "airports": [
    {
      "code": "ABC",
      "name": "Airport Full Name",
      "overallStatus": "normal|delays|severe_delays",
      "avgDelayMinutes": 15,
      "arrivalDelays": {"status": "minor|none|major", "avgMinutes": 10},
      "departureDelays": {"status": "none|minor|major", "avgMinutes": 0},
      "weather": "Clear/Cloudy/Rain/etc",
      "groundStops": false,
      "tipsForDrivers": "Best terminal or pickup area for drivers"
    }
  ],
  "busyPeriods": [
    {"time": "6:00 PM - 8:00 PM", "airport": "ABC", "reason": "International arrivals wave"}
  ],
  "recommendations": "Overall recommendation for rideshare drivers in the area"
}

Find ALL commercial airports within ${radiusMiles} miles (major international, regional, and municipal airports with scheduled passenger service).
Focus on information useful for rideshare pickup timing.
Return ONLY the JSON object.`;

  const result = await callPerplexitySonar({
    query: `What are all commercial airports within ${radiusMiles} miles of ${locationContext}? For each airport, what are current flight delays, arrival times, departure delays, and airport conditions today ${date}? Include major international airports, regional airports, and any airports with scheduled passenger service. What are the busiest arrival periods for rideshare pickups?`,
    systemPrompt,
    recency: 'day',
    maxTokens: 3072
  });

  if (!result.ok) {
    briefingLog.warn(2, `Airport search failed: ${result.error}`, OP.AI);
    return {
      airport: {
        airports: [],
        busyPeriods: [],
        recommendations: null,
        isFallback: true
      },
      error: result.error
    };
  }

  try {
    let cleanOutput = result.output
      .replace(/^```json\s*/i, '')
      .replace(/\s*```$/i, '')
      .replace(/^```\s*/i, '')
      .trim();

    // Find the outermost { } pair by counting braces
    let jsonStr = null;
    if (cleanOutput.includes('{')) {
      const startIdx = cleanOutput.indexOf('{');
      let braceCount = 0;
      let endIdx = -1;

      for (let i = startIdx; i < cleanOutput.length; i++) {
        if (cleanOutput[i] === '{') braceCount++;
        if (cleanOutput[i] === '}') braceCount--;
        if (braceCount === 0) {
          endIdx = i;
          break;
        }
      }

      if (endIdx > startIdx) {
        jsonStr = cleanOutput.substring(startIdx, endIdx + 1);
      }
    }

    if (!jsonStr) {
      console.log(`[Perplexity] airport returned prose instead of JSON: ${cleanOutput.substring(0, 100)}...`);
      return {
        airport: {
          airports: [],
          busyPeriods: [],
          recommendations: null,
          isFallback: true
        },
        error: 'Response was prose, not JSON object'
      };
    }

    const parsed = JSON.parse(jsonStr);

    const elapsedMs = Date.now() - startTime;
    const airportCount = parsed.airports?.length || 0;
    briefingLog.done(2, `Airport: ${airportCount} airports in ${elapsedMs}ms`, OP.AI);

    return {
      airport: {
        airports: Array.isArray(parsed.airports) ? parsed.airports : [],
        busyPeriods: Array.isArray(parsed.busyPeriods) ? parsed.busyPeriods : [],
        recommendations: parsed.recommendations || null,
        fetchedAt: new Date().toISOString()
      }
    };
  } catch (parseErr) {
    console.log(`[Perplexity] airport parse error: ${parseErr.message}`);
    console.log(`[Perplexity] airport raw output: ${result.output.substring(0, 200)}`);
    briefingLog.warn(2, `Airport parse failed: ${parseErr.message}`, OP.AI);
    return {
      airport: {
        airports: [],
        busyPeriods: [],
        recommendations: null,
        isFallback: true
      },
      error: parseErr.message
    };
  }
}

/**
 * Full parallel briefing search using Perplexity
 * Runs events (5 categories), news, traffic, and airport in parallel
 *
 * @param {Object} options
 * @param {string} options.city - City name
 * @param {string} options.state - State code
 * @param {string} options.date - Date string (YYYY-MM-DD)
 * @param {number} options.lat - Latitude
 * @param {number} options.lng - Longitude
 * @param {string} options.formattedAddress - Full formatted address
 * @returns {Promise<{events: Object, news: Object, traffic: Object, airport: Object}>}
 */
export async function searchBriefingDataParallel({ city, state, date, lat, lng, formattedAddress }) {
  const startTime = Date.now();
  briefingLog.phase(1, `Perplexity parallel search: events + news + traffic`, OP.AI);

  // Execute ALL searches in parallel (events, news, traffic)
  const [eventsResult, newsResult, trafficResult] = await Promise.all([
    searchEventsParallel({ city, state, date, lat, lng }),
    searchRideshareNews({ city, state, date }),
    searchTrafficConditions({ city, state, date })
  ]);

  // Combine all citations
  const allCitations = [
    ...(eventsResult.citations || []),
    ...(newsResult.citations || []),
    ...(trafficResult.citations || [])
  ];

  const elapsedMs = Date.now() - startTime;
  briefingLog.done(1, `Parallel complete: ${eventsResult.items?.length || 0} events, ${newsResult.items?.length || 0} news in ${elapsedMs}ms`, OP.AI);

  return {
    events: {
      items: eventsResult.items || [],
      errors: eventsResult.errors
    },
    news: {
      items: newsResult.items || [],
      reason: newsResult.error || null
    },
    traffic: trafficResult.traffic,
    allCitations: [...new Set(allCitations)]
  };
}
