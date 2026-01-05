/**
 * Event Discovery Sync Module
 *
 * Two modes:
 * 1. DAILY: Run ALL working models for maximum event coverage
 *    - Gemini 3 Pro, Gemini 2.5 Pro, GPT-5.2, Claude, Perplexity Reasoning, SerpAPI
 * 2. NORMAL: Run only SerpAPI + GPT-5.2 for fast/efficient updates
 *
 * Called from briefing service with snapshot location context.
 * Never hardcodes locations - always uses user's snapshot location.
 *
 * Usage (from briefing service):
 *   import { syncEventsForLocation } from '../scripts/sync-events.mjs';
 *   await syncEventsForLocation({ city, state, lat, lng }, isDaily);
 */

import 'dotenv/config';
import crypto from 'crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { findOrCreateVenue, linkEventToVenue } from '../lib/venue/venue-cache.js';

const { Pool } = pg;

const MAX_DRIVE_MINUTES = 8;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// ============================================================================
// Geocode address to coordinates (forward geocoding)
// ============================================================================
async function geocodeAddress(address, city, state) {
  if (!address || !GOOGLE_MAPS_API_KEY) return null;

  try {
    // Build full address string for geocoding
    const fullAddress = [address, city, state].filter(Boolean).join(', ');

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', fullAddress);
    url.searchParams.set('key', GOOGLE_MAPS_API_KEY);

    const response = await fetch(url.toString());
    if (!response.ok) return null;

    const data = await response.json();
    if (data.status === 'OK' && data.results?.[0]?.geometry?.location) {
      const { lat, lng } = data.results[0].geometry.location;
      return { lat, lng };
    }
    return null;
  } catch (err) {
    console.log(`  [Geocode] Error: ${err.message}`);
    return null;
  }
}

// ============================================================================
// Batch geocode events that are missing coordinates
// ============================================================================
async function geocodeMissingCoordinates(events) {
  const eventsNeedingGeocode = events.filter(e => !e.lat || !e.lng);

  if (eventsNeedingGeocode.length === 0) {
    return events;
  }

  console.log(`  [Geocode] Geocoding ${eventsNeedingGeocode.length} events without coordinates...`);

  // Process in batches of 5 to avoid rate limits
  for (let i = 0; i < eventsNeedingGeocode.length; i += 5) {
    const batch = eventsNeedingGeocode.slice(i, i + 5);

    await Promise.all(batch.map(async (event) => {
      // Try venue name + city first, then full address
      const searchQuery = event.venue_name || event.address;
      const coords = await geocodeAddress(searchQuery, event.city, event.state);

      if (coords) {
        event.lat = coords.lat;
        event.lng = coords.lng;
      }
    }));

    // Small delay between batches
    if (i + 5 < eventsNeedingGeocode.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  const geocoded = events.filter(e => e.lat && e.lng).length;
  console.log(`  [Geocode] ${geocoded}/${events.length} events now have coordinates`);

  return events;
}

// ============================================================================
// Process events through venue cache for precise coordinates and deduplication
// ============================================================================
async function processEventsWithVenueCache(events) {
  const eventsWithVenues = [];
  let venuesCached = 0;
  let venuesReused = 0;
  let venuesFailed = 0;

  console.log(`  [VenueCache] Processing ${events.length} events through venue cache...`);

  for (const event of events) {
    // Skip events without venue name
    if (!event.venue_name) {
      eventsWithVenues.push(event);
      continue;
    }

    try {
      const venue = await findOrCreateVenue({
        venue: event.venue_name,
        address: event.address,
        latitude: event.lat,
        longitude: event.lng,
        city: event.city,
        state: event.state
      }, `sync_events_${(event.source_model || 'unknown').toLowerCase()}`);

      if (venue) {
        // Update event with precise venue coordinates
        if (venue.lat && venue.lng) {
          event.lat = venue.lat;
          event.lng = venue.lng;
        }
        // Store venue_id for linking after insert
        event._venue_id = venue.id;

        // Track if this was a reuse or new cache
        if (venue.access_count > 1) {
          venuesReused++;
        } else {
          venuesCached++;
        }
      }
    } catch (err) {
      // Venue cache is best-effort, don't fail event processing
      console.log(`  [VenueCache] Warning for "${event.venue_name}": ${err.message}`);
      venuesFailed++;
    }

    eventsWithVenues.push(event);
  }

  console.log(`  [VenueCache] Results: ${venuesCached} new, ${venuesReused} reused, ${venuesFailed} failed`);
  return eventsWithVenues;
}

// ============================================================================
// Database connection
// ============================================================================
function getDb() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
  });
  return drizzle(pool);
}

// ============================================================================
// Generate event hash for deduplication
// ============================================================================
function generateEventHash(event) {
  // Normalize: lowercase, remove extra spaces, remove punctuation
  const normalize = (str) => (str || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const key = [
    normalize(event.title),
    normalize(event.venue_name || event.venue || ''),
    event.event_date || '',
    normalize(event.city)
  ].join('|');

  return crypto.createHash('md5').update(key).digest('hex');
}

// ============================================================================
// Fetch existing events for deduplication
// ============================================================================
async function fetchExistingEvents(db, city, state, startDate, endDate) {
  try {
    const result = await db.execute(sql`
      SELECT title, venue_name, address, event_date, event_time
      FROM discovered_events
      WHERE city = ${city}
        AND state = ${state}
        AND event_date >= ${startDate}
        AND event_date <= ${endDate}
        AND is_active = true
      ORDER BY event_date, title
      LIMIT 100
    `);
    return result.rows || [];
  } catch (err) {
    console.log(`  [Dedup] Error fetching existing events: ${err.message}`);
    return [];
  }
}

// ============================================================================
// Format existing events for LLM prompt
// ============================================================================
function formatExistingEventsForPrompt(events) {
  if (!events || events.length === 0) return '';

  const eventList = events.map(e => {
    const time = e.event_time || 'time unknown';
    return `- "${e.title}" @ ${e.venue_name || 'Unknown Venue'} on ${e.event_date} at ${time}`;
  }).join('\n');

  return `

IMPORTANT - AVOID DUPLICATES:
The following events are ALREADY in our database. Do NOT return any events that are essentially the same as these (even with slight title variations):

${eventList}

DEDUPLICATION RULES:
1. Same venue + same date + same event type (even with different title wording) = DUPLICATE, skip it
2. Same venue + same date + DIFFERENT time = NOT a duplicate (could be different shows)
3. Example: "Holiday Lights Show" at 6:00 PM = "Holiday Lights Show (Daily)" at 6:00 PM = DUPLICATE
4. Example: "Holiday Lights Show" at 6:00 PM ≠ "Holiday Lights Show" at 9:00 PM = KEEP BOTH
5. Title variations with extra details in parentheses are usually the SAME event

Only return genuinely NEW events not already covered above.`;
}

// ============================================================================
// Event prompt for GPT-5.2
// ============================================================================
function buildEventPrompt(city, state, date, lat, lng, existingEvents = [], options = {}) {
  const { todayOnly = false } = options;
  const dedupSection = formatExistingEventsForPrompt(existingEvents);

  // TODAY-ONLY MODE: For briefing tab, only get today's events with required times
  if (todayOnly) {
    return `Search for events happening TODAY (${date}) within ${MAX_DRIVE_MINUTES} minutes drive of coordinates ${lat}, ${lng} (near ${city}, ${state}).${dedupSection}

**CRITICAL REQUIREMENTS:**
1. ONLY events happening on ${date} (today)
2. MUST include both event_time AND event_end_time (no TBD, no missing times)
3. Times in format "HH:MM AM/PM" (e.g., "7:00 PM")

This is for rideshare drivers - we need events that generate pickups/dropoffs.

Look for these rideshare-relevant event types:
- Concerts, music festivals, live music shows at venues, arenas, amphitheaters
- Professional sports (NFL, NBA, MLB, NHL, MLS), college sports
- Theater performances, comedy shows
- Conferences, conventions, trade shows
- Parades, festivals, community events, holiday celebrations
- Nightclub events, DJ nights
- Marathons, races, athletic events
- Any large gatherings (100+ people expected)

Return a JSON array with events found:
[
  {
    "title": "Event Name",
    "venue": "Venue Name",
    "address": "Full Address with City, State ZIP",
    "lat": 32.7767,
    "lng": -96.7970,
    "event_date": "${date}",
    "event_time": "7:00 PM",
    "event_end_time": "10:00 PM",
    "category": "concert|sports|theater|conference|festival|nightlife|civic|academic|airport|other",
    "expected_attendance": "high|medium|low",
    "source": "where you found this info"
  }
]

IMPORTANT: Skip events without confirmed start AND end times. Return [] if no events with complete times found.`;
  }

  // FULL MODE: For map tab, get 7-day window
  const today = new Date(date);
  const dayAfter = new Date(today);
  dayAfter.setDate(today.getDate() + 6); // Get a week of events
  const dateRange = `${date} to ${dayAfter.toISOString().split('T')[0]}`;

  return `Search for ALL events happening within ${MAX_DRIVE_MINUTES} minutes drive of coordinates ${lat}, ${lng} (near ${city}, ${state}) from ${dateRange}.${dedupSection}

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
- Any large gatherings (100+ people expected)

Return a JSON array with ALL events found:
[
  {
    "title": "Event Name",
    "venue": "Venue Name",
    "address": "Full Address with City, State ZIP",
    "lat": 32.7767,
    "lng": -96.7970,
    "event_date": "YYYY-MM-DD",
    "event_time": "7:00 PM",
    "event_end_time": "10:00 PM",
    "category": "concert|sports|theater|conference|festival|nightlife|civic|academic|airport|other",
    "expected_attendance": "high|medium|low",
    "source": "where you found this info"
  }
]

IMPORTANT: Always include lat/lng coordinates for each event venue. You can search for the venue coordinates or use known landmark coordinates.

IMPORTANT: Always include event_end_time when available. For concerts, typically 2-3 hours after start. For sports, check typical game lengths. If end time is unknown, omit the field.

Search multiple sources thoroughly. Return [] only if truly no events found.`;
}

// ============================================================================
// SerpAPI Search (fastest, most efficient)
// ============================================================================
async function searchWithSerpAPI(city, state) {
  const apiKey = process.env.SERP_API_KEY || process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    console.log('  [SerpAPI] Skipped - SERP_API_KEY not set');
    return [];
  }

  const startTime = Date.now();
  console.log(`  [SerpAPI] Searching events near ${city}, ${state}...`);

  try {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('engine', 'google_events');
    url.searchParams.set('q', `events near ${city} ${state}`);
    url.searchParams.set('hl', 'en');
    url.searchParams.set('gl', 'us');

    const response = await fetch(url.toString());

    if (!response.ok) {
      const err = await response.text();
      console.log(`  [SerpAPI] Error ${response.status}: ${err.slice(0, 100)}`);
      return [];
    }

    const data = await response.json();
    const events = [];

    if (data.events_results) {
      for (const evt of data.events_results) {
        // Parse date from SerpAPI format
        let eventDate = null;
        let eventTime = null;
        if (evt.date?.when) {
          // Try to extract date from "Mon, Dec 16, 7:00 PM" format
          const dateMatch = evt.date.when.match(/([A-Za-z]+),?\s+([A-Za-z]+)\s+(\d+)/);
          if (dateMatch) {
            const monthNames = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
                                Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
            const month = monthNames[dateMatch[2]] || '01';
            const day = dateMatch[3].padStart(2, '0');
            const year = new Date().getFullYear();
            eventDate = `${year}-${month}-${day}`;
          }
          // Extract time
          const timeMatch = evt.date.when.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
          if (timeMatch) {
            eventTime = timeMatch[1];
          }
        }

        // Parse address
        let address = evt.address?.join(', ') || '';
        let parsedCity = city;
        let parsedState = state;
        let zip = null;

        // Try to extract city, state, zip from address
        const zipMatch = address.match(/(\d{5})(?:-\d{4})?/);
        if (zipMatch) zip = zipMatch[1];
        const stateMatch = address.match(/,\s*([A-Z]{2})\s/);
        if (stateMatch) parsedState = stateMatch[1];

        // Extract GPS coordinates if available (SerpAPI may include venue.gps)
        const venueLat = evt.venue?.gps?.latitude || evt.gps?.latitude || null;
        const venueLng = evt.venue?.gps?.longitude || evt.gps?.longitude || null;

        events.push({
          title: evt.title,
          venue_name: evt.venue?.name || evt.address?.[0] || null,
          address: address || null,
          city: parsedCity,
          state: parsedState,
          zip,
          event_date: eventDate || new Date().toISOString().split('T')[0],
          event_time: eventTime || evt.date?.when || null,
          lat: venueLat,
          lng: venueLng,
          category: categorizeEvent(evt.title),
          expected_attendance: 'medium',
          source_model: 'SerpAPI',
          source_url: evt.link || null,
          raw_source_data: evt
        });
      }
    }

    console.log(`  [SerpAPI] Found ${events.length} events (${Date.now() - startTime}ms)`);
    return events;
  } catch (err) {
    console.log(`  [SerpAPI] Error: ${err.message}`);
    return [];
  }
}

// ============================================================================
// GPT-5.2 Search (best quality)
// ============================================================================
async function searchWithGPT52(city, state, lat, lng, existingEvents = [], options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('  [GPT-5.2] Skipped - OPENAI_API_KEY not set');
    return [];
  }

  const startTime = Date.now();
  // Use user's local date if provided, otherwise use server date
  const date = options.userLocalDate || new Date().toISOString().split('T')[0];
  const modeLabel = options.todayOnly ? 'TODAY ONLY' : '7-day';
  console.log(`  [GPT-5.2] Searching events near ${city}, ${state} (${modeLabel}, date: ${date})... (${existingEvents.length} existing events for dedup)`);

  try {
    const prompt = buildEventPrompt(city, state, date, lat, lng, existingEvents, options);

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
        instructions: `You are an event discovery assistant for rideshare drivers in ${city}, ${state}. Search the web thoroughly and return ONLY a JSON array of events, no prose or explanation.`,
        max_output_tokens: 16000
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.log(`  [GPT-5.2] Error ${response.status}: ${err.slice(0, 100)}`);
      return [];
    }

    const data = await response.json();

    // Extract output text
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

    const parsed = parseEventsJson(output);
    const events = parsed.map(evt => ({
      title: evt.title,
      venue_name: evt.venue || null,
      address: evt.address || null,
      city: city,
      state: state,
      zip: extractZip(evt.address),
      event_date: evt.event_date || date,
      event_time: evt.event_time || null,
      event_end_time: evt.event_end_time || null,
      lat: evt.lat || null,
      lng: evt.lng || null,
      category: evt.category || categorizeEvent(evt.title),
      expected_attendance: evt.expected_attendance || 'medium',
      source_model: 'GPT-5.2',
      source_url: evt.source || null,
      raw_source_data: evt
    }));

    console.log(`  [GPT-5.2] Found ${events.length} events (${Date.now() - startTime}ms)`);
    return events;
  } catch (err) {
    console.log(`  [GPT-5.2] Error: ${err.message}`);
    return [];
  }
}

// ============================================================================
// MODEL: Gemini 3 Pro with Google Search (daily sync)
// ============================================================================
async function searchWithGemini3Pro(city, state, lat, lng, existingEvents = [], options = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('  [Gemini 3 Pro] Skipped - GEMINI_API_KEY not set');
    return [];
  }

  const startTime = Date.now();
  // Use user's local date if provided, otherwise use server date
  const date = options.userLocalDate || new Date().toISOString().split('T')[0];
  const modeLabel = options.todayOnly ? 'TODAY ONLY' : '7-day';
  console.log(`  [Gemini 3 Pro] Searching events near ${city}, ${state} (${modeLabel}, date: ${date})... (${existingEvents.length} existing for dedup)`);

  try {
    const prompt = buildEventPrompt(city, state, date, lat, lng, existingEvents, options);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 16384,
            responseMimeType: "application/json"
          }
        })
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.log(`  [Gemini 3 Pro] Error ${response.status}: ${err.slice(0, 100)}`);
      return [];
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    let output = '';
    for (const part of parts) {
      if (part.text && !part.thought) {
        output = part.text;
        break;
      }
    }

    const parsed = parseEventsJson(output);
    const events = parsed.map(evt => ({
      title: evt.title,
      venue_name: evt.venue || null,
      address: evt.address || null,
      city: city,
      state: state,
      zip: extractZip(evt.address),
      event_date: evt.event_date || date,
      event_time: evt.event_time || null,
      event_end_time: evt.event_end_time || null,
      lat: evt.lat || null,
      lng: evt.lng || null,
      category: evt.category || categorizeEvent(evt.title),
      expected_attendance: evt.expected_attendance || 'medium',
      source_model: 'Gemini-3-Pro',
      source_url: evt.source || null,
      raw_source_data: evt
    }));

    console.log(`  [Gemini 3 Pro] Found ${events.length} events (${Date.now() - startTime}ms)`);
    return events;
  } catch (err) {
    console.log(`  [Gemini 3 Pro] Error: ${err.message}`);
    return [];
  }
}

// ============================================================================
// MODEL: Gemini 2.5 Pro with Google Search (daily sync)
// ============================================================================
async function searchWithGemini25Pro(city, state, lat, lng) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('  [Gemini 2.5 Pro] Skipped - GEMINI_API_KEY not set');
    return [];
  }

  const startTime = Date.now();
  const date = new Date().toISOString().split('T')[0];
  console.log(`  [Gemini 2.5 Pro] Searching events near ${city}, ${state}...`);

  try {
    const today = new Date(date);
    const dayAfter = new Date(today);
    dayAfter.setDate(today.getDate() + 6);
    const dateRange = `${date} to ${dayAfter.toISOString().split('T')[0]}`;

    const prompt = `Find events happening within 8 minutes drive of ${lat}, ${lng} (${city}, ${state}) from ${dateRange}.

Return ONLY a valid JSON array (no markdown, no explanation, just the array):
[{"title":"Event Name","venue":"Venue","address":"Address","event_date":"YYYY-MM-DD","event_time":"HH:MM AM/PM","category":"concert|sports|festival|theater|nightlife|other","expected_attendance":"high|medium|low","source":"source"}]

Search for: concerts, sports games, festivals, theater, comedy shows, conventions, holiday events, nightlife.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 16384
          }
        })
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.log(`  [Gemini 3 Pro] Error ${response.status}: ${err.slice(0, 100)}`);
      return [];
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    let output = '';
    for (const part of parts) {
      if (part.text && !part.thought) {
        output += part.text + '\n';
      }
    }

    const parsed = parseEventsJson(output);
    const events = parsed.map(evt => ({
      title: evt.title,
      venue_name: evt.venue || null,
      address: evt.address || null,
      city: city,
      state: state,
      zip: extractZip(evt.address),
      event_date: evt.event_date || date,
      event_time: evt.event_time || null,
      event_end_time: evt.event_end_time || null,
      lat: evt.lat || null,
      lng: evt.lng || null,
      category: evt.category || categorizeEvent(evt.title),
      expected_attendance: evt.expected_attendance || 'medium',
      source_model: 'Gemini-2.5-Pro',
      source_url: evt.source || null,
      raw_source_data: evt
    }));

    console.log(`  [Gemini 2.5 Pro] Found ${events.length} events (${Date.now() - startTime}ms)`);
    return events;
  } catch (err) {
    console.log(`  [Gemini 2.5 Pro] Error: ${err.message}`);
    return [];
  }
}

// ============================================================================
// MODEL: Claude with Web Search (daily sync)
// ============================================================================
async function searchWithClaude(city, state, lat, lng, existingEvents = [], options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('  [Claude] Skipped - ANTHROPIC_API_KEY not set');
    return [];
  }

  const startTime = Date.now();
  // Use user's local date if provided, otherwise use server date
  const date = options.userLocalDate || new Date().toISOString().split('T')[0];
  const modeLabel = options.todayOnly ? 'TODAY ONLY' : '7-day';
  console.log(`  [Claude] Searching events near ${city}, ${state} (${modeLabel}, date: ${date})... (${existingEvents.length} existing for dedup)`);

  try {
    const prompt = buildEventPrompt(city, state, date, lat, lng, existingEvents, options);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5-20251101',
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
      console.log(`  [Claude] Error ${response.status}: ${err.slice(0, 100)}`);
      return [];
    }

    const data = await response.json();
    let output = '';
    for (const block of data.content || []) {
      if (block.type === 'text') {
        output += block.text;
      }
    }

    const parsed = parseEventsJson(output);
    const events = parsed.map(evt => ({
      title: evt.title,
      venue_name: evt.venue || null,
      address: evt.address || null,
      city: city,
      state: state,
      zip: extractZip(evt.address),
      event_date: evt.event_date || date,
      event_time: evt.event_time || null,
      event_end_time: evt.event_end_time || null,
      lat: evt.lat || null,
      lng: evt.lng || null,
      category: evt.category || categorizeEvent(evt.title),
      expected_attendance: evt.expected_attendance || 'medium',
      source_model: 'Claude',
      source_url: evt.source || null,
      raw_source_data: evt
    }));

    console.log(`  [Claude] Found ${events.length} events (${Date.now() - startTime}ms)`);
    return events;
  } catch (err) {
    console.log(`  [Claude] Error: ${err.message}`);
    return [];
  }
}

// ============================================================================
// MODEL: Perplexity Sonar Reasoning Pro (daily sync)
// ============================================================================
async function searchWithPerplexityReasoning(city, state, lat, lng, existingEvents = [], options = {}) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    console.log('  [Perplexity Reasoning] Skipped - PERPLEXITY_API_KEY not set');
    return [];
  }

  const startTime = Date.now();
  // Use user's local date if provided, otherwise use server date
  const date = options.userLocalDate || new Date().toISOString().split('T')[0];
  const modeLabel = options.todayOnly ? 'TODAY ONLY' : '7-day';
  console.log(`  [Perplexity Reasoning] Searching events near ${city}, ${state} (${modeLabel}, date: ${date})... (${existingEvents.length} existing for dedup)`);

  try {
    const prompt = buildEventPrompt(city, state, date, lat, lng, existingEvents, options);

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
      console.log(`  [Perplexity Reasoning] Error ${response.status}: ${err.slice(0, 100)}`);
      return [];
    }

    const data = await response.json();
    const output = data.choices?.[0]?.message?.content?.trim() || '';

    const parsed = parseEventsJson(output);
    const events = parsed.map(evt => ({
      title: evt.title,
      venue_name: evt.venue || null,
      address: evt.address || null,
      city: city,
      state: state,
      zip: extractZip(evt.address),
      event_date: evt.event_date || date,
      event_time: evt.event_time || null,
      event_end_time: evt.event_end_time || null,
      lat: evt.lat || null,
      lng: evt.lng || null,
      category: evt.category || categorizeEvent(evt.title),
      expected_attendance: evt.expected_attendance || 'medium',
      source_model: 'Perplexity-Reasoning',
      source_url: evt.source || null,
      raw_source_data: evt
    }));

    console.log(`  [Perplexity Reasoning] Found ${events.length} events (${Date.now() - startTime}ms)`);
    return events;
  } catch (err) {
    console.log(`  [Perplexity Reasoning] Error: ${err.message}`);
    return [];
  }
}

// ============================================================================
// Helpers
// ============================================================================
function categorizeEvent(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('concert') || t.includes('music') || t.includes('live')) return 'concert';
  if (t.includes('sport') || t.includes('game') || t.includes('football') || t.includes('basketball') || t.includes('cowboys') || t.includes('mavericks') || t.includes('rangers') || t.includes('stars')) return 'sports';
  if (t.includes('theater') || t.includes('theatre') || t.includes('play') || t.includes('musical') || t.includes('broadway')) return 'theater';
  if (t.includes('comedy') || t.includes('standup') || t.includes('comedian')) return 'comedy';
  if (t.includes('festival') || t.includes('fair') || t.includes('parade')) return 'festival';
  if (t.includes('conference') || t.includes('convention') || t.includes('expo') || t.includes('summit')) return 'conference';
  if (t.includes('club') || t.includes('dj') || t.includes('bar') || t.includes('night')) return 'nightlife';
  if (t.includes('church') || t.includes('worship') || t.includes('rally') || t.includes('political')) return 'civic';
  if (t.includes('graduation') || t.includes('college') || t.includes('university') || t.includes('school')) return 'academic';
  if (t.includes('airport') || t.includes('flight') || t.includes('arrival')) return 'airport';
  return 'other';
}

function extractZip(address) {
  if (!address) return null;
  const match = address.match(/(\d{5})(?:-\d{4})?/);
  return match ? match[1] : null;
}

function parseEventsJson(output) {
  if (!output) return [];

  try {
    let clean = output.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    clean = clean
      .replace(/^```json\s*/i, '')
      .replace(/\s*```$/i, '')
      .replace(/^```\s*/i, '')
      .trim();

    const arrayMatch = clean.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      clean = arrayMatch[0];
    }

    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed)) {
      return parsed.filter(e => e.title);
    }
    return [];
  } catch (err) {
    return [];
  }
}

// ============================================================================
// Store events in database with deduplication
// ============================================================================
async function storeEvents(db, events) {
  let inserted = 0;
  let skipped = 0;

  for (const event of events) {
    const hash = generateEventHash(event);

    try {
      // Attempt insert - will fail silently on duplicate hash
      await db.execute(sql`
        INSERT INTO discovered_events (
          title, venue_name, address, city, state, zip,
          event_date, event_time, event_end_time, event_end_date,
          lat, lng, category, expected_attendance,
          source_model, source_url, raw_source_data,
          event_hash, venue_id
        ) VALUES (
          ${event.title},
          ${event.venue_name},
          ${event.address},
          ${event.city},
          ${event.state},
          ${event.zip},
          ${event.event_date},
          ${event.event_time},
          ${event.event_end_time || null},
          ${event.event_end_date || null},
          ${event.lat || null},
          ${event.lng || null},
          ${event.category},
          ${event.expected_attendance},
          ${event.source_model},
          ${event.source_url},
          ${JSON.stringify(event.raw_source_data)}::jsonb,
          ${hash},
          ${event._venue_id || null}
        )
        ON CONFLICT (event_hash) DO NOTHING
      `);

      // Check if row was inserted
      const result = await db.execute(sql`
        SELECT id FROM discovered_events WHERE event_hash = ${hash}
      `);
      if (result.rows.length > 0) {
        inserted++;
      }
    } catch (err) {
      if (err.code === '23505') {
        // Duplicate hash - expected for deduplication
        skipped++;
      } else {
        console.log(`  [DB] Error inserting event: ${err.message}`);
        skipped++;
      }
    }
  }

  return { inserted, skipped };
}

// ============================================================================
// Main sync function (for user location)
// ============================================================================
async function syncEventsForLocation(location, isDaily = false, options = {}) {
  const { city, state, lat, lng } = location;
  const { userLocalDate, todayOnly = false } = options;

  const mode = isDaily ? 'DAILY (all models)' : 'NORMAL (SerpAPI + GPT-5.2)';
  const dateMode = todayOnly ? 'TODAY ONLY' : '7-day window';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('EVENT DISCOVERY SYNC');
  console.log(`Mode: ${mode} | Date Mode: ${dateMode}`);
  console.log(`Location: ${city}, ${state} (${lat}, ${lng})`);
  if (userLocalDate) console.log(`User Local Date: ${userLocalDate}`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const db = getDb();
  let allEvents = [];

  // Fetch existing events for semantic deduplication
  // Use user's local date if provided, otherwise use server date
  const today = userLocalDate || new Date().toISOString().split('T')[0];
  const weekFromNow = new Date(today);
  weekFromNow.setDate(weekFromNow.getDate() + 7);
  const endDate = weekFromNow.toISOString().split('T')[0];

  console.log('[Dedup] Fetching existing events for semantic deduplication...');
  const existingEvents = await fetchExistingEvents(db, city, state, today, endDate);
  console.log(`[Dedup] Found ${existingEvents.length} existing events to avoid duplicates\n`);

  // Options to pass to search functions
  const searchOptions = { userLocalDate: today, todayOnly };

  if (isDaily) {
    // DAILY MODE: Run ALL working models in parallel for maximum coverage
    // All models receive existing events for semantic deduplication
    console.log('Running 6 models in parallel (with semantic deduplication)...');
    const results = await Promise.all([
      searchWithSerpAPI(city, state),  // SerpAPI doesn't support custom prompts
      searchWithGPT52(city, state, lat, lng, existingEvents, searchOptions),
      searchWithGemini3Pro(city, state, lat, lng, existingEvents, searchOptions),
      searchWithGemini25Pro(city, state, lat, lng),  // Uses different prompt format
      searchWithClaude(city, state, lat, lng, existingEvents, searchOptions),
      searchWithPerplexityReasoning(city, state, lat, lng, existingEvents, searchOptions)
    ]);
    allEvents = results.flat();
  } else {
    // NORMAL MODE: Run only SerpAPI + GPT-5.2 (fast/efficient)
    const [serpEvents, gptEvents] = await Promise.all([
      searchWithSerpAPI(city, state),
      searchWithGPT52(city, state, lat, lng, existingEvents, searchOptions)
    ]);
    allEvents = [...serpEvents, ...gptEvents];
  }

  let inserted = 0;
  let skipped = 0;

  if (allEvents.length > 0) {
    // Geocode events missing lat/lng coordinates
    allEvents = await geocodeMissingCoordinates(allEvents);

    // Process through venue cache for precise coordinates and venue linking
    allEvents = await processEventsWithVenueCache(allEvents);

    console.log(`\n[Storing] ${allEvents.length} events...`);
    const result = await storeEvents(db, allEvents);
    inserted = result.inserted;
    skipped = result.skipped;
    console.log(`[Result] Inserted: ${inserted}, Duplicates skipped: ${skipped}`);
  } else {
    console.log(`\n[Result] No events found`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('SYNC COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Mode: ${mode}`);
  console.log(`Total events discovered: ${allEvents.length}`);
  console.log(`New events inserted: ${inserted}`);
  console.log(`Duplicates skipped: ${skipped}`);
  console.log(`Completed: ${new Date().toISOString()}`);

  return { events: allEvents, inserted, skipped };
}

// ============================================================================
// Export for use in briefing service
// ============================================================================
export {
  syncEventsForLocation,
  searchWithSerpAPI,
  searchWithGPT52,
  searchWithGemini3Pro,
  searchWithGemini25Pro,
  searchWithClaude,
  searchWithPerplexityReasoning,
  generateEventHash,
  storeEvents
};
