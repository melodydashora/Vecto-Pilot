// server/lib/external/serper-api.js
// SerpAPI integration for Google Search
// Used for: Traffic conditions, local news, real-time information
//
// Docs: https://serpapi.com/
// Note: Supports both SerpAPI (SERP_API_KEY) and Serper.dev (SERPER_API_KEY)

import { briefingLog, OP } from '../../logger/workflow.js';

// Support both naming conventions
const SERP_API_KEY = process.env.SERP_API_KEY || process.env.SERPER_API_KEY;

// Detect which service to use based on key format or explicit env var
const USE_SERPAPI = !!process.env.SERP_API_KEY;

/**
 * Search Google via SerpAPI or Serper.dev
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @param {string} options.type - 'search' | 'news' (default: 'search')
 * @param {string} options.location - Location for localized results (e.g., "Frisco, Texas")
 * @param {number} options.num - Number of results (default: 10)
 * @param {string} options.timeFilter - Time filter: 'day', 'week', 'month' (default: 'day' for news)
 * @returns {Promise<Object>} - Search results
 */
export async function serperSearch(query, options = {}) {
  if (!SERP_API_KEY) {
    console.warn('[SerpAPI] No SERP_API_KEY configured');
    return { error: 'SerpAPI key not configured', results: [] };
  }

  const {
    type = 'search',
    location = null,
    num = 10,
    gl = 'us',
    hl = 'en',
    timeFilter = type === 'news' ? 'day' : null, // Default to past 24h for news
  } = options;

  try {
    const startTime = Date.now();
    let response;
    let data;

    if (USE_SERPAPI) {
      // SerpAPI format (GET request with query params)
      const engine = type === 'news' ? 'google_news' : 'google';
      const params = new URLSearchParams({
        api_key: SERP_API_KEY,
        engine,
        q: query,
        num: String(num),
        gl,
        hl,
      });

      if (location) {
        params.set('location', location);
      }

      // Add time filter - different params for news vs search
      if (timeFilter) {
        if (engine === 'google_news') {
          // Google News uses 'when' parameter: 1h, 1d, 7d, 1m, 1y
          const whenMap = { hour: '1h', day: '1d', week: '7d', month: '1m' };
          if (whenMap[timeFilter]) {
            params.set('when', whenMap[timeFilter]);
          }
        } else {
          // Regular Google search uses 'tbs' parameter: qdr:d, qdr:w, qdr:m
          const tbsMap = { day: 'qdr:d', week: 'qdr:w', month: 'qdr:m', hour: 'qdr:h' };
          if (tbsMap[timeFilter]) {
            params.set('tbs', tbsMap[timeFilter]);
          }
        }
      }

      response = await fetch(`https://serpapi.com/search?${params.toString()}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[SerpAPI] API error: ${response.status} - ${errorText}`);
        return { error: `SerpAPI error: ${response.status}`, results: [] };
      }

      data = await response.json();

      if (data.error) {
        console.error(`[SerpAPI] Error:`, data.error);
        return { error: data.error, results: [] };
      }

      const elapsedMs = Date.now() - startTime;
      const resultCount = data.organic_results?.length || data.news_results?.length || 0;
      console.log(`[SerpAPI] ${type} query "${query.slice(0, 50)}..." returned ${resultCount} results in ${elapsedMs}ms`);

      // Normalize SerpAPI response to match expected format
      return {
        organic: data.organic_results || [],
        news: data.news_results || [],
        answerBox: data.answer_box || null,
        knowledgeGraph: data.knowledge_graph || null,
        relatedSearches: data.related_searches || [],
        elapsedMs,
      };
    } else {
      // Serper.dev format (POST request)
      const url = type === 'news'
        ? 'https://google.serper.dev/news'
        : 'https://google.serper.dev/search';

      const payload = { q: query, num, gl, hl };
      if (location) payload.location = location;

      response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-API-KEY': SERP_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Serper] API error: ${response.status} - ${errorText}`);
        return { error: `Serper API error: ${response.status}`, results: [] };
      }

      data = await response.json();
      const elapsedMs = Date.now() - startTime;
      console.log(`[Serper] ${type} query "${query.slice(0, 50)}..." returned ${data.organic?.length || data.news?.length || 0} results in ${elapsedMs}ms`);

      return {
        organic: data.organic || [],
        news: data.news || [],
        answerBox: data.answerBox || null,
        knowledgeGraph: data.knowledgeGraph || null,
        relatedSearches: data.relatedSearches || [],
        elapsedMs,
      };
    }
  } catch (error) {
    console.error('[SerpAPI] Request failed:', error.message);
    return { error: error.message, results: [] };
  }
}

/**
 * Search for traffic conditions using SerpAPI News
 * @param {Object} params - Search parameters
 * @param {string} params.city - City name
 * @param {string} params.state - State name
 * @param {string} params.formattedAddress - Full address for context
 * @returns {Promise<Object>} - Traffic data
 */
export async function searchTrafficWithSerper({ city, state, formattedAddress }) {
  if (!SERP_API_KEY) {
    return {
      traffic: {
        summary: 'Traffic data unavailable (SerpAPI not configured)',
        incidents: [],
        congestionLevel: 'unknown',
        source: 'serpapi',
      },
      error: 'SerpAPI key not configured',
    };
  }

  briefingLog.ai(1, 'SerpAPI', `traffic for ${city}, ${state}`);
  const startTime = Date.now();

  try {
    // Search for traffic news - simpler query gets more recent results
    const query = `${city} ${state} traffic`;

    const results = await serperSearch(query, {
      type: 'news',
      location: `${city}, ${state}`,
      num: 15,
      timeFilter: 'week',
    });

    if (results.error) {
      briefingLog.warn(1, `SerpAPI traffic search failed: ${results.error}`, OP.AI);
      return {
        traffic: {
          summary: `Traffic data unavailable for ${city}, ${state}`,
          incidents: [],
          congestionLevel: 'unknown',
          source: 'serpapi',
        },
        error: results.error,
      };
    }

    // Parse news results into traffic incidents, filtering out old articles
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const incidents = (results.news || [])
      .map(item => ({
        title: item.title,
        snippet: item.snippet || item.source?.description || '',
        source: item.source?.name || item.source || 'news',
        link: item.link,
        date: item.date,
      }))
      .filter(item => {
        // Filter out articles older than 7 days
        if (!item.date) return true; // Keep if no date (might be recent)
        try {
          const articleDate = new Date(item.date);
          return articleDate >= sevenDaysAgo;
        } catch {
          return true; // Keep if date parsing fails
        }
      });

    // Also search for general traffic conditions
    const conditionsQuery = `${city} ${state} traffic conditions congestion`;
    const conditionsResults = await serperSearch(conditionsQuery, {
      type: 'search',
      location: `${city}, ${state}`,
      num: 5,
    });

    // Try to extract congestion level from answer box or snippets
    let congestionLevel = 'moderate';
    let summary = `Traffic conditions for ${city}, ${state}`;

    if (conditionsResults.answerBox?.snippet) {
      summary = conditionsResults.answerBox.snippet;
    } else if (conditionsResults.organic?.[0]?.snippet) {
      summary = conditionsResults.organic[0].snippet;
    }

    // Analyze snippets for congestion keywords
    const allText = [
      summary,
      ...incidents.map(i => i.title + ' ' + (i.snippet || '')),
    ].join(' ').toLowerCase();

    if (allText.includes('heavy') || allText.includes('severe') || allText.includes('major accident') || allText.includes('gridlock')) {
      congestionLevel = 'heavy';
    } else if (allText.includes('light') || allText.includes('clear') || allText.includes('flowing')) {
      congestionLevel = 'light';
    } else if (allText.includes('moderate') || allText.includes('normal') || allText.includes('typical')) {
      congestionLevel = 'moderate';
    }

    const elapsedMs = Date.now() - startTime;
    briefingLog.done(1, `Traffic: ${congestionLevel}, ${incidents.length} incidents (${elapsedMs}ms)`, OP.AI);

    return {
      traffic: {
        summary,
        incidents,
        congestionLevel,
        source: 'serpapi',
        searchQueries: [query, conditionsQuery],
      },
      citations: incidents.map(i => i.link).filter(Boolean),
    };
  } catch (error) {
    console.error('[SerpAPI] Traffic search error:', error);
    briefingLog.warn(1, `SerpAPI traffic error: ${error.message}`, OP.AI);

    return {
      traffic: {
        summary: `Traffic data error for ${city}, ${state}`,
        incidents: [],
        congestionLevel: 'unknown',
        source: 'serpapi',
      },
      error: error.message,
    };
  }
}

/**
 * Search for local events using SerpAPI
 * @param {Object} params - Search parameters
 * @param {string} params.city - City name
 * @param {string} params.state - State name
 * @param {string} params.date - Date string
 * @returns {Promise<Object>} - Events data
 */
export async function searchEventsWithSerper({ city, state, date }) {
  if (!SERP_API_KEY) {
    return { events: [], error: 'SerpAPI key not configured' };
  }

  const query = `${city} ${state} events concerts sports games ${date}`;

  const results = await serperSearch(query, {
    type: 'search',
    location: `${city}, ${state}`,
    num: 15,
  });

  if (results.error) {
    return { events: [], error: results.error };
  }

  // Parse organic results into events
  const events = (results.organic || []).map(item => ({
    title: item.title,
    snippet: item.snippet,
    link: item.link,
    source: item.source || 'web',
  }));

  return {
    events,
    citations: events.map(e => e.link).filter(Boolean),
  };
}
