#!/usr/bin/env node
/**
 * Event Discovery Model Comparison Test
 *
 * Compares event discovery across multiple AI models:
 * - Gemini 3 Pro Preview (with Google Search grounding)
 * - Perplexity Sonar Pro
 * - Perplexity Sonar Reasoning Pro (deep research)
 * - Claude with web search
 *
 * Tests comprehensive rideshare-relevant event categories within 15-mile radius
 *
 * Usage: node tools/research/event-model-comparison.mjs [city] [state]
 * Example: node tools/research/event-model-comparison.mjs "Dallas" "TX"
 */

import 'dotenv/config';

const MAX_DRIVE_MINUTES = 8; // Drivers don't want to move more than 8 min drive

// Comprehensive rideshare event categories
const EVENT_CATEGORIES = [
  // Entertainment & Culture
  'concerts', 'music festivals', 'theater performances', 'comedy shows',
  'film premieres', 'art fairs', 'cultural festivals',

  // Sports & Competitive
  'professional sports games', 'college sports games', 'championship games',
  'marathons', 'esports tournaments', 'boxing MMA wrestling events',

  // Social & Private (harder to find publicly)
  'large weddings', 'proms school dances', 'graduations',

  // Business & Professional
  'conferences conventions', 'trade shows expos', 'corporate events',
  'product launches', 'networking events',

  // Academic & Institutional
  'college move-in move-out', 'graduation ceremonies', 'orientation weeks',
  'campus open houses',

  // Travel & Transportation
  'major flight arrivals', 'cruise ship arrivals', 'holiday travel',

  // Retail & Consumer
  'Black Friday sales', 'major sales events', 'store openings', 'pop-up markets',

  // Civic, Public & Religious
  'parades', 'political rallies', 'religious gatherings', 'city celebrations',

  // Nightlife
  'club events DJ nights', 'bar crawls', 'late-night festivals', 'restaurant weeks'
];

// Simplified event search prompt for all models
function buildEventPrompt(city, state, date, lat, lng) {
  // Get next 3 days for better event coverage
  const today = new Date(date);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const dayAfter = new Date(today); dayAfter.setDate(today.getDate() + 2);
  const dateRange = `${date} to ${dayAfter.toISOString().split('T')[0]}`;

  return `Search for ALL events happening within ${MAX_DRIVE_MINUTES} minutes drive of coordinates ${lat}, ${lng} (near ${city}, ${state}) from ${dateRange} (today and next 2 days).

This is for rideshare drivers - we need events that generate pickups/dropoffs.

Look for these rideshare-relevant event types:
- Concerts, music festivals, live music shows at venues, arenas, amphitheaters
- Professional sports (NFL, NBA, MLB, NHL, MLS), college sports, high school playoffs
- Theater performances, comedy shows, Broadway shows
- Conferences, conventions, trade shows, expos at convention centers, hotels
- Parades, festivals, community events, holiday celebrations
- Large corporate events, networking events, holiday parties
- Nightclub events, DJ nights, bar crawls
- Marathons, races, athletic events
- Graduation ceremonies, college events
- Religious gatherings, political rallies
- Restaurant weeks, food festivals
- Airport arrival/departure peaks
- Any large gatherings (100+ people expected)

Return a JSON array with ALL events found:
[
  {
    "title": "Event Name",
    "venue": "Venue Name",
    "address": "Full Address",
    "event_date": "2025-12-14",
    "event_time": "7:00 PM",
    "category": "concert|sports|theater|conference|festival|nightlife|civic|academic|airport|other",
    "expected_attendance": "high|medium|low",
    "source": "where you found this info"
  }
]

Search multiple sources thoroughly. Return [] only if truly no events found.`;
}

// ============================================================================
// MODEL 1: Gemini 3 Pro Preview (with Google Search grounding)
// ============================================================================
async function searchWithGemini(city, state, date, lat, lng) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { model: 'Gemini 3 Pro Preview', events: [], error: 'GEMINI_API_KEY not set', timeMs: 0, params: {} };
  }

  const startTime = Date.now();
  const prompt = buildEventPrompt(city, state, date, lat, lng);

  const params = {
    model: 'gemini-3-pro-preview',
    tools: 'google_search',
    temperature: 0.1,
    maxOutputTokens: 16384,
    responseMimeType: 'application/json'
  };

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
          ],
          generationConfig: {
            // No thinkingConfig = no thinking (avoids MAX_TOKENS issues)
            temperature: 0.1,
            maxOutputTokens: 16384,
            responseMimeType: "application/json"
          }
        })
      }
    );

    if (!response.ok) {
      const err = await response.text();
      return { model: 'Gemini 3 Pro Preview', events: [], error: `API ${response.status}: ${err.slice(0, 200)}`, timeMs: Date.now() - startTime, params };
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];

    if (candidate?.finishReason === 'MAX_TOKENS') {
      return { model: 'Gemini 3 Pro Preview', events: [], error: 'MAX_TOKENS - response truncated', timeMs: Date.now() - startTime, params };
    }

    const parts = candidate?.content?.parts || [];
    let output = '';
    for (const part of parts) {
      if (part.text && !part.thought) {
        output = part.text;
        break;
      }
    }

    const events = parseEventsJson(output);
    return {
      model: 'Gemini 3 Pro Preview',
      events,
      rawLength: output.length,
      timeMs: Date.now() - startTime,
      params
    };
  } catch (err) {
    return { model: 'Gemini 3 Pro Preview', events: [], error: err.message, timeMs: Date.now() - startTime, params };
  }
}

// ============================================================================
// MODEL 2: Perplexity Sonar Pro
// ============================================================================
async function searchWithPerplexitySonar(city, state, date, lat, lng) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return { model: 'Perplexity Sonar Pro', events: [], error: 'PERPLEXITY_API_KEY not set', timeMs: 0, params: {} };
  }

  const startTime = Date.now();
  const prompt = buildEventPrompt(city, state, date, lat, lng);

  const params = {
    model: 'sonar-pro',
    temperature: 0.7,
    top_p: 0.95,
    max_tokens: 4096,
    search_context_size: 'high',
    search_recency_filter: 'week'
  };

  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: params.model,
        messages: [
          { role: 'system', content: `You are an event discovery assistant for ${city}, ${state}. Return ONLY a JSON array of events, no prose.` },
          { role: 'user', content: prompt }
        ],
        temperature: params.temperature,
        top_p: params.top_p,
        max_tokens: params.max_tokens,
        return_citations: false,
        search_context_size: params.search_context_size,
        search_recency_filter: params.search_recency_filter
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return { model: 'Perplexity Sonar Pro', events: [], error: `API ${response.status}: ${err.slice(0, 200)}`, timeMs: Date.now() - startTime, params };
    }

    const data = await response.json();
    const output = data.choices?.[0]?.message?.content?.trim() || '';

    const events = parseEventsJson(output);
    return {
      model: 'Perplexity Sonar Pro',
      events,
      rawLength: output.length,
      citations: data.citations?.length || 0,
      timeMs: Date.now() - startTime,
      params
    };
  } catch (err) {
    return { model: 'Perplexity Sonar Pro', events: [], error: err.message, timeMs: Date.now() - startTime, params };
  }
}

// ============================================================================
// MODEL 3: Perplexity Sonar Reasoning Pro (Deep Research)
// ============================================================================
async function searchWithPerplexityReasoning(city, state, date, lat, lng) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return { model: 'Perplexity Sonar Reasoning Pro', events: [], error: 'PERPLEXITY_API_KEY not set', timeMs: 0 };
  }

  const startTime = Date.now();
  const prompt = buildEventPrompt(city, state, date, lat, lng);

  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar-reasoning-pro',
        messages: [
          { role: 'system', content: `You are a deep research event discovery assistant for ${city}, ${state}. Search thoroughly across multiple sources. Return ONLY a JSON array of events, no prose.` },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        top_p: 0.95,
        max_tokens: 8192,
        return_citations: false,
        search_context_size: 'high',
        search_recency_filter: 'week'
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return { model: 'Perplexity Sonar Reasoning Pro', events: [], error: `API ${response.status}: ${err.slice(0, 200)}`, timeMs: Date.now() - startTime };
    }

    const data = await response.json();
    const output = data.choices?.[0]?.message?.content?.trim() || '';

    const events = parseEventsJson(output);
    return {
      model: 'Perplexity Sonar Reasoning Pro',
      events,
      rawLength: output.length,
      citations: data.citations?.length || 0,
      timeMs: Date.now() - startTime
    };
  } catch (err) {
    return { model: 'Perplexity Sonar Reasoning Pro', events: [], error: err.message, timeMs: Date.now() - startTime };
  }
}

// ============================================================================
// MODEL 4: Claude with Web Search
// ============================================================================
async function searchWithClaude(city, state, date, lat, lng) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { model: 'Claude Web Search', events: [], error: 'ANTHROPIC_API_KEY not set', timeMs: 0 };
  }

  const startTime = Date.now();
  const prompt = buildEventPrompt(city, state, date, lat, lng);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 32000,
        tools: [{
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 15
        }],
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return { model: 'Claude Web Search', events: [], error: `API ${response.status}: ${err.slice(0, 200)}`, timeMs: Date.now() - startTime };
    }

    const data = await response.json();

    // Extract text from response blocks
    let output = '';
    let searchCount = 0;
    for (const block of data.content || []) {
      if (block.type === 'text') {
        output += block.text;
      }
      if (block.type === 'tool_use' && block.name === 'web_search') {
        searchCount++;
      }
    }

    // Debug: show raw output if no events parsed
    const events = parseEventsJson(output);
    if (events.length === 0 && output.length > 0) {
      console.log(`  [Claude Debug] Searches performed: ${searchCount}`);
      console.log(`  [Claude Debug] Raw output preview: ${output.slice(0, 500)}...`);
    }

    return {
      model: 'Claude Web Search',
      events,
      rawLength: output.length,
      searches: searchCount,
      timeMs: Date.now() - startTime
    };
  } catch (err) {
    return { model: 'Claude Web Search', events: [], error: err.message, timeMs: Date.now() - startTime };
  }
}

// ============================================================================
// MODEL 5: Gemini 2.5 Pro with Google Search
// ============================================================================
async function searchWithGemini25Pro(city, state, date, lat, lng) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { model: 'Gemini 2.5 Pro + Google', events: [], error: 'GEMINI_API_KEY not set', timeMs: 0, params: {} };
  }

  const startTime = Date.now();

  // Use a simpler prompt that explicitly asks for JSON array output
  const today = new Date(date);
  const dayAfter = new Date(today); dayAfter.setDate(today.getDate() + 2);
  const dateRange = `${date} to ${dayAfter.toISOString().split('T')[0]}`;

  const prompt = `Find events happening within 8 minutes drive of ${lat}, ${lng} (${city}, ${state}) from ${dateRange}.

Return ONLY a valid JSON array (no markdown, no explanation, just the array):
[{"title":"Event Name","venue":"Venue","address":"Address","event_date":"YYYY-MM-DD","event_time":"HH:MM AM/PM","category":"concert|sports|festival|theater|nightlife|other","expected_attendance":"high|medium|low","source":"source"}]

Search for: concerts, sports games, festivals, theater, comedy shows, conventions, holiday events, nightlife.`;

  const params = {
    model: 'gemini-2.5-pro',
    tools: 'google_search',
    temperature: 0.1,
    maxOutputTokens: 16384
  };

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
          ],
          generationConfig: {
            temperature: params.temperature,
            maxOutputTokens: params.maxOutputTokens
          }
        })
      }
    );

    if (!response.ok) {
      const err = await response.text();
      return { model: 'Gemini 2.5 Pro + Google', events: [], error: `API ${response.status}: ${err.slice(0, 200)}`, timeMs: Date.now() - startTime, params };
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];

    if (candidate?.finishReason === 'MAX_TOKENS') {
      return { model: 'Gemini 2.5 Pro + Google', events: [], error: 'MAX_TOKENS - response truncated', timeMs: Date.now() - startTime, params };
    }

    // Collect ALL text parts (not just the first one)
    const parts = candidate?.content?.parts || [];
    let output = '';
    for (const part of parts) {
      if (part.text && !part.thought) {
        output += part.text + '\n';
      }
    }

    const events = parseEventsJson(output);
    return {
      model: 'Gemini 2.5 Pro + Google',
      events,
      rawLength: output.length,
      timeMs: Date.now() - startTime,
      params
    };
  } catch (err) {
    return { model: 'Gemini 2.5 Pro + Google', events: [], error: err.message, timeMs: Date.now() - startTime, params };
  }
}

// ============================================================================
// MODEL 7: SerpAPI Google Events Search
// ============================================================================
async function searchWithSerpAPI(city, state, date, lat, lng) {
  const apiKey = process.env.SERP_API_KEY || process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    return { model: 'SerpAPI Events', events: [], error: 'SERP_API_KEY not set', timeMs: 0, params: {} };
  }

  const startTime = Date.now();
  const params = {
    engine: 'google_events',
    q: `events near ${city} ${state}`,
    hl: 'en',
    gl: 'us'
  };

  try {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('engine', params.engine);
    url.searchParams.set('q', params.q);
    url.searchParams.set('hl', params.hl);
    url.searchParams.set('gl', params.gl);

    const response = await fetch(url.toString());

    if (!response.ok) {
      const err = await response.text();
      return { model: 'SerpAPI Events', events: [], error: `API ${response.status}: ${err.slice(0, 200)}`, timeMs: Date.now() - startTime, params };
    }

    const data = await response.json();

    // Parse SerpAPI events response
    const events = [];
    if (data.events_results) {
      for (const evt of data.events_results.slice(0, 15)) {
        events.push({
          title: evt.title,
          venue: evt.venue?.name || evt.address?.[0] || 'N/A',
          address: evt.address?.join(', ') || 'N/A',
          event_time: evt.date?.when || 'N/A',
          category: categorizeEvent(evt.title),
          expected_attendance: 'medium',
          source: 'SerpAPI Google Events'
        });
      }
    }

    return {
      model: 'SerpAPI Events',
      events,
      rawLength: JSON.stringify(data.events_results || []).length,
      timeMs: Date.now() - startTime,
      params
    };
  } catch (err) {
    return { model: 'SerpAPI Events', events: [], error: err.message, timeMs: Date.now() - startTime, params };
  }
}

// ============================================================================
// MODEL 8: TomTom Search API (POI/Events)
// ============================================================================
async function searchWithTomTom(city, state, date, lat, lng) {
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) {
    return { model: 'TomTom POI Search', events: [], error: 'TOMTOM_API_KEY not set', timeMs: 0, params: {} };
  }

  const startTime = Date.now();
  const params = {
    endpoint: 'poiSearch',
    query: 'events concerts sports stadium arena theater',
    lat,
    lng,
    radius: 15000, // 15km ~ 9 miles
    limit: 20
  };

  try {
    // TomTom POI Search for event venues
    const url = `https://api.tomtom.com/search/2/poiSearch/${encodeURIComponent(params.query)}.json?key=${apiKey}&lat=${lat}&lon=${lng}&radius=${params.radius}&limit=${params.limit}&categorySet=7318,7376,9362,9363,9902`;
    // Categories: 7318=stadium, 7376=theater, 9362=concert hall, 9363=arena, 9902=nightlife

    const response = await fetch(url);

    if (!response.ok) {
      const err = await response.text();
      return { model: 'TomTom POI Search', events: [], error: `API ${response.status}: ${err.slice(0, 200)}`, timeMs: Date.now() - startTime, params };
    }

    const data = await response.json();

    // Parse TomTom POI results as potential event venues
    const events = [];
    if (data.results) {
      for (const poi of data.results.slice(0, 15)) {
        events.push({
          title: `Event Venue: ${poi.poi?.name || 'Unknown'}`,
          venue: poi.poi?.name || 'N/A',
          address: poi.address?.freeformAddress || 'N/A',
          event_time: 'Check venue schedule',
          category: poi.poi?.categories?.[0] || 'venue',
          expected_attendance: 'medium',
          source: 'TomTom POI Search'
        });
      }
    }

    return {
      model: 'TomTom POI Search',
      events,
      rawLength: JSON.stringify(data.results || []).length,
      timeMs: Date.now() - startTime,
      params
    };
  } catch (err) {
    return { model: 'TomTom POI Search', events: [], error: err.message, timeMs: Date.now() - startTime, params };
  }
}

// Helper to categorize events from title
function categorizeEvent(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('concert') || t.includes('music') || t.includes('live')) return 'concert';
  if (t.includes('sport') || t.includes('game') || t.includes('football') || t.includes('basketball')) return 'sports';
  if (t.includes('theater') || t.includes('theatre') || t.includes('play') || t.includes('musical')) return 'theater';
  if (t.includes('comedy') || t.includes('standup')) return 'comedy';
  if (t.includes('festival') || t.includes('fair')) return 'festival';
  if (t.includes('conference') || t.includes('convention') || t.includes('expo')) return 'conference';
  return 'other';
}

// ============================================================================
// MODEL 6: GPT-5.2 with Web Search
// ============================================================================
async function searchWithGPT52(city, state, date, lat, lng) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { model: 'GPT-5.2 + Web Search', events: [], error: 'OPENAI_API_KEY not set', timeMs: 0 };
  }

  const startTime = Date.now();
  const prompt = buildEventPrompt(city, state, date, lat, lng);

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5.2',
        tools: [{ type: 'web_search' }],
        input: prompt,
        instructions: `You are an event discovery assistant for rideshare drivers. Search the web thoroughly and return ONLY a JSON array of events, no prose or explanation.`,
        max_output_tokens: 16000
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return { model: 'GPT-5.2 + Web Search', events: [], error: `API ${response.status}: ${err.slice(0, 200)}`, timeMs: Date.now() - startTime };
    }

    const data = await response.json();

    // Extract output text from GPT-5.2 response format
    let output = '';
    if (data.output) {
      for (const item of data.output) {
        if (item.type === 'message' && item.content) {
          for (const content of item.content) {
            if (content.type === 'output_text') {
              output += content.text;
            }
          }
        }
      }
    }

    const events = parseEventsJson(output);
    return {
      model: 'GPT-5.2 + Web Search',
      events,
      rawLength: output.length,
      timeMs: Date.now() - startTime
    };
  } catch (err) {
    return { model: 'GPT-5.2 + Web Search', events: [], error: err.message, timeMs: Date.now() - startTime };
  }
}

// ============================================================================
// Utility: Parse events JSON from model output
// ============================================================================
function parseEventsJson(output) {
  if (!output) return [];

  try {
    // Remove <think>...</think> tags from reasoning models
    let clean = output.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // Clean markdown code blocks
    clean = clean
      .replace(/^```json\s*/i, '')
      .replace(/\s*```$/i, '')
      .replace(/^```\s*/i, '')
      .trim();

    // Try to extract JSON array
    const arrayMatch = clean.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      clean = arrayMatch[0];
    }

    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed)) {
      return parsed.filter(e => e.title && (e.venue || e.address));
    }
    return [];
  } catch (err) {
    console.log(`  Parse error: ${err.message}`);
    console.log(`  Raw output preview: ${output.slice(0, 300)}...`);
    return [];
  }
}

// ============================================================================
// Main: Run comparison
// ============================================================================
async function main() {
  const city = process.argv[2] || 'Frisco';
  const state = process.argv[3] || 'TX';
  const lat = parseFloat(process.argv[4]) || 33.1283;
  const lng = parseFloat(process.argv[5]) || -96.8756;
  const date = new Date().toISOString().split('T')[0];

  const runStartTime = new Date();
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`EVENT DISCOVERY MODEL COMPARISON`);
  console.log(`Location: ${city}, ${state} | Max drive: ${MAX_DRIVE_MINUTES} min | Date: ${date}`);
  console.log(`Coordinates: ${lat}, ${lng}`);
  console.log(`Started: ${runStartTime.toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('Running 8 models in parallel...\n');

  // Run all models in parallel with timestamps
  const modelCalls = [
    { name: 'Gemini 3 Pro + Google', fn: searchWithGemini },
    { name: 'Gemini 2.5 Pro + Google', fn: searchWithGemini25Pro },
    { name: 'GPT-5.2 + Web Search', fn: searchWithGPT52 },
    { name: 'Claude Web Search', fn: searchWithClaude },
    { name: 'Perplexity Sonar Pro', fn: searchWithPerplexitySonar },
    { name: 'Perplexity Sonar Reasoning Pro', fn: searchWithPerplexityReasoning },
    { name: 'SerpAPI Events', fn: searchWithSerpAPI },
    { name: 'TomTom POI Search', fn: searchWithTomTom }
  ];

  const results = await Promise.all(
    modelCalls.map(async ({ name, fn }) => {
      const startTs = new Date();
      const result = await fn(city, state, date, lat, lng);
      const endTs = new Date();
      return {
        ...result,
        startTime: startTs.toISOString(),
        endTime: endTs.toISOString()
      };
    })
  );

  const runEndTime = new Date();
  const totalRunTime = ((runEndTime - runStartTime) / 1000).toFixed(1);

  // Display results
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('RESULTS SUMMARY');
  console.log(`Completed: ${runEndTime.toISOString()} (Total: ${totalRunTime}s parallel)`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const summary = [];

  for (const result of results) {
    console.log(`\n┌─────────────────────────────────────────────────────────────┐`);
    console.log(`│ ${result.model.padEnd(57)} │`);
    console.log(`└─────────────────────────────────────────────────────────────┘`);
    console.log(`  🕐 Start: ${result.startTime}`);
    console.log(`  🕐 End:   ${result.endTime}`);

    // Show parameters if available
    if (result.params && Object.keys(result.params).length > 0) {
      console.log(`  📋 Params: ${JSON.stringify(result.params)}`);
    }

    if (result.error) {
      console.log(`  ❌ Error: ${result.error}`);
      summary.push({ model: result.model, events: 0, time: result.timeMs, error: result.error, start: result.startTime, end: result.endTime, params: result.params });
    } else {
      console.log(`  ✅ Events found: ${result.events.length}`);
      console.log(`  ⏱️  Duration: ${(result.timeMs / 1000).toFixed(1)}s`);
      if (result.rawLength) console.log(`  📝 Response length: ${result.rawLength} chars`);
      if (result.citations) console.log(`  🔗 Citations: ${result.citations}`);
      if (result.searches) console.log(`  🔍 Web searches: ${result.searches}`);

      // List ALL events with full details
      console.log(`\n  ALL EVENTS:`);
      for (let i = 0; i < result.events.length; i++) {
        const e = result.events[i];
        console.log(`    ${i + 1}. ${e.title}`);
        console.log(`       Venue: ${e.venue || 'N/A'}`);
        console.log(`       Address: ${e.address || 'N/A'}`);
        console.log(`       Date: ${e.event_date || 'N/A'} | Time: ${e.event_time || 'N/A'}`);
        console.log(`       Category: ${e.category || 'N/A'} | Attendance: ${e.expected_attendance || 'N/A'}`);
        if (e.source) console.log(`       Source: ${e.source}`);
        console.log('');
      }

      summary.push({ model: result.model, events: result.events.length, time: result.timeMs, start: result.startTime, end: result.endTime });
    }
  }

  // Final comparison table
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('COMPARISON TABLE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Model                              | Events | Time (s) | Evt/sec | Status');
  console.log('-----------------------------------|--------|----------|---------|--------');

  summary.sort((a, b) => b.events - a.events);

  for (const s of summary) {
    const status = s.error ? '❌ Error' : '✅ OK';
    const evtPerSec = s.time > 0 ? (s.events / (s.time / 1000)).toFixed(2) : '0.00';
    console.log(`${s.model.padEnd(35)}| ${String(s.events).padStart(6)} | ${(s.time / 1000).toFixed(1).padStart(8)} | ${evtPerSec.padStart(7)} | ${status}`);
  }

  // Winners by category
  const validResults = summary.filter(s => !s.error && s.events > 0);
  if (validResults.length > 0) {
    const mostEvents = validResults.reduce((a, b) => a.events > b.events ? a : b);
    const fastest = validResults.reduce((a, b) => a.time < b.time ? a : b);
    const bestEfficiency = validResults.reduce((a, b) => (a.events / a.time) > (b.events / b.time) ? a : b);

    console.log(`\n🏆 Most Events: ${mostEvents.model} (${mostEvents.events} events)`);
    console.log(`⚡ Fastest: ${fastest.model} (${(fastest.time / 1000).toFixed(1)}s)`);
    console.log(`📊 Best Efficiency: ${bestEfficiency.model} (${(bestEfficiency.events / (bestEfficiency.time / 1000)).toFixed(2)} events/sec)`);
  }

  console.log(`\n⏱️  Total parallel run time: ${totalRunTime}s`);
}

main().catch(console.error);
