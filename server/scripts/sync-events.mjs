/**
 * Event Discovery Sync Module (ETL Pipeline)
 *
 * ETL ARCHITECTURE:
 * ═══════════════════════════════════════════════════════════════════════════
 * Phase 1 (EXTRACT): Provider calls - SerpAPI, Gemini, Claude, GPT, Perplexity
 * Phase 2 (TRANSFORM-A): Normalize + Validate (canonical modules)
 * Phase 3 (TRANSFORM-B): Geocode + Venue linking
 * Phase 4 (LOAD): Upsert to discovered_events with event_hash deduplication
 * Phase 5 (ASSEMBLE): (In briefing-service) Query from DB + shape for briefings
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two modes:
 * 1. DAILY: Run ALL discovery providers for maximum event coverage
 *    - Gemini (google_search), GPT (web_search), Claude (web_search), Perplexity, SerpAPI
 * 2. NORMAL: Run only SerpAPI + GPT (fast/efficient updates)
 *
 * INVARIANT: Discovery providers return RawEvent format.
 * INVARIANT: All events are normalized/validated before storage.
 * INVARIANT: Strategy LLMs ONLY receive data read from DB (never cached responses).
 *
 * Called from briefing service with snapshot location context.
 * Never hardcodes locations - always uses user's snapshot location.
 *
 * @module server/scripts/sync-events
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { findOrCreateVenue } from '../lib/venue/venue-cache.js';

// Canonical ETL pipeline modules - use these, not duplicates
import { normalizeEvent, normalizeEvents } from '../lib/events/pipeline/normalizeEvent.js';
import { validateEventsHard, VALIDATION_SCHEMA_VERSION } from '../lib/events/pipeline/validateEvent.js';
import { generateEventHash, buildHashInput } from '../lib/events/pipeline/hashEvent.js';

// Workflow-aware logging with ETL phases
import { eventsLog, OP } from '../logger/workflow.js';

const { Pool } = pg;

const MAX_DRIVE_MINUTES = 8;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// ============================================================================
// Geocode address to coordinates (forward geocoding)
// ETL Phase 3: TRANSFORM-B
// ============================================================================
// 2026-01-10: AUDIT FIX - Now returns full result including place_id, formatted_address
// Previously only returned {lat, lng}, dropping critical data for venue identification
// See: docs/AUDIT_LEDGER.md - Breakpoint 1
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
      const result = data.results[0];
      const { lat, lng } = result.geometry.location;

      // 2026-01-10: AUDIT FIX - Return full result, not just coords
      // place_id is critical for venue identification (ChIJ... format)
      // formatted_address provides verified street address
      // address_components enables granular parsing
      return {
        lat,
        lng,
        place_id: result.place_id,                    // Google Place ID (ChIJ...)
        formatted_address: result.formatted_address,  // Verified address string
        address_components: result.address_components // Granular address parts
      };
    }
    return null;
  } catch (err) {
    // Don't log individual geocode errors - batched logging happens in geocodeMissingCoordinates
    return null;
  }
}

// ============================================================================
// Batch geocode events that are missing coordinates
// ETL Phase 3: TRANSFORM-B - Geocoding
// ============================================================================
// 2026-01-10: AUDIT FIX - Now captures place_id and formatted_address from geocoding
// Previously only stored lat/lng, missing critical venue identity data
// See: docs/AUDIT_LEDGER.md - Breakpoint 1
// ============================================================================
async function geocodeMissingCoordinates(events) {
  const eventsNeedingGeocode = events.filter(e => !e.lat || !e.lng);

  if (eventsNeedingGeocode.length === 0) {
    return events;
  }

  // Process in batches of 5 to avoid rate limits
  for (let i = 0; i < eventsNeedingGeocode.length; i += 5) {
    const batch = eventsNeedingGeocode.slice(i, i + 5);

    await Promise.all(batch.map(async (event) => {
      // Try venue name + city first, then full address
      const searchQuery = event.venue_name || event.address;
      const geocodeResult = await geocodeAddress(searchQuery, event.city, event.state);

      if (geocodeResult) {
        // 2026-01-10: AUDIT FIX - Capture full geocode result
        event.lat = geocodeResult.lat;
        event.lng = geocodeResult.lng;

        // Capture place_id for venue identification (ChIJ... format)
        // This enables proper venue linking without fuzzy matching
        if (geocodeResult.place_id) {
          event._geocoded_place_id = geocodeResult.place_id;
        }

        // Capture formatted_address for verified address
        if (geocodeResult.formatted_address) {
          event._geocoded_formatted_address = geocodeResult.formatted_address;
        }

        // Store address_components for potential granular parsing
        if (geocodeResult.address_components) {
          event._geocoded_address_components = geocodeResult.address_components;
        }
      }
    }));

    // Small delay between batches
    if (i + 5 < eventsNeedingGeocode.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  const geocoded = events.filter(e => e.lat && e.lng).length;
  // Logging handled by caller (syncEventsForLocation)

  return events;
}

// ============================================================================
// Process events through venue cache for precise coordinates and deduplication
// ETL Phase 3: TRANSFORM-B - Venue Linking
//
// 2026-01-09: VENUE ID PRIORITIZATION
// The venue_catalog contains two types of place IDs:
// - ChIJ* IDs: Valid Google Place IDs (high quality, verified)
// - Ei* IDs: Synthetic/session IDs (low quality, may be stale)
//
// When linking events to venues:
// 1. Always prefer venues with ChIJ* place_id
// 2. Treat Ei* IDs as "soft match" - use coordinates but flag for cleanup
// 3. Log when falling back to Ei* ID for future cleanup opportunities
// ============================================================================
async function processEventsWithVenueCache(events) {
  const eventsWithVenues = [];
  let venuesCached = 0;
  let venuesReused = 0;
  let venuesFailed = 0;
  let syntheticIdCount = 0;  // Track Ei* ID matches for reporting

  for (const event of events) {
    // Skip events without venue name
    if (!event.venue_name) {
      eventsWithVenues.push(event);
      continue;
    }

    try {
      // 2026-01-10: AUDIT FIX - Pass geocoded place_id and formatted_address
      // This enables place_id-first lookup strategy and proper venue identification
      // See: docs/AUDIT_LEDGER.md - Breakpoint 1 + Breakpoint 4
      const venue = await findOrCreateVenue({
        venue: event.venue_name,
        address: event.address,
        latitude: event.lat,
        longitude: event.lng,
        city: event.city,
        state: event.state,
        // Pass geocoded data if available (from geocodeMissingCoordinates)
        placeId: event._geocoded_place_id,
        formattedAddress: event._geocoded_formatted_address
      }, `sync_events_${(event.source_model || 'unknown').toLowerCase()}`);

      if (venue) {
        // 2026-01-09: Check venue ID quality
        // ChIJ* = valid Google Place ID, Ei* = synthetic/session ID
        const isChIJId = venue.place_id?.startsWith('ChIJ');
        const isSyntheticId = venue.place_id?.startsWith('Ei');

        // Update event with precise venue coordinates (regardless of ID type)
        if (venue.lat && venue.lng) {
          event.lat = venue.lat;
          event.lng = venue.lng;
        }

        // 2026-01-09: FIX - venue_catalog PK is venue_id, not id
        // Only link to venues with quality IDs; mark synthetic for later cleanup
        if (isChIJId) {
          event._venue_id = venue.venue_id;
        } else if (isSyntheticId) {
          // Soft match - use coordinates but flag for potential cleanup
          event._venue_id = venue.venue_id;
          event._synthetic_venue_id = true;  // Flag for future cleanup
          syntheticIdCount++;
        } else if (venue.venue_id) {
          // No place_id at all - still link but flag
          event._venue_id = venue.venue_id;
          event._no_place_id = true;
        }

        // Track if this was a reuse or new cache
        if (venue.access_count > 1) {
          venuesReused++;
        } else {
          venuesCached++;
        }
      }
    } catch (err) {
      // Venue cache is best-effort, don't fail event processing
      venuesFailed++;
    }

    eventsWithVenues.push(event);
  }

  // Log synthetic ID usage for future cleanup opportunities
  if (syntheticIdCount > 0) {
    eventsLog.warn(3, `${syntheticIdCount} events linked to synthetic (Ei*) venue IDs - candidates for cleanup`);
  }

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
// Event hash for deduplication - uses canonical hashEvent module
// See: server/lib/events/pipeline/hashEvent.js
// Hash = MD5(normalized title|venue|date|city)
// ============================================================================
// NOTE: generateEventHash is imported from ../lib/events/pipeline/hashEvent.js
// Do NOT duplicate the implementation here.

// ============================================================================
// Fetch existing events for deduplication
// ============================================================================
async function fetchExistingEvents(db, city, state, startDate, endDate) {
  try {
    // 2026-01-10: Use symmetric field names (event_start_date, event_start_time)
    const result = await db.execute(sql`
      SELECT title, venue_name, address, event_start_date, event_start_time
      FROM discovered_events
      WHERE city = ${city}
        AND state = ${state}
        AND event_start_date >= ${startDate}
        AND event_start_date <= ${endDate}
        AND is_active = true
      ORDER BY event_start_date, title
      LIMIT 100
    `);
    return result.rows || [];
  } catch (err) {
    eventsLog.error(1, '[Dedup] Error fetching existing events', err.message);
    return [];
  }
}

// ============================================================================
// Format existing events for LLM prompt
// ============================================================================
function formatExistingEventsForPrompt(events) {
  if (!events || events.length === 0) return '';

  // 2026-01-10: Use symmetric field names from DB rows
  const eventList = events.map(e => {
    const time = e.event_start_time || 'time unknown';
    return `- "${e.title}" @ ${e.venue_name || 'Unknown Venue'} on ${e.event_start_date} at ${time}`;
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

  // 2026-01-14: CRITICAL FIX - Always format coordinates to 6 decimals
  // This is required per CLAUDE.md "ABSOLUTE PRECISION" rule
  // 6 decimals = ~11cm accuracy, prevents fuzzy matching issues
  const latStr = Number(lat).toFixed(6);
  const lngStr = Number(lng).toFixed(6);

  // TODAY-ONLY MODE: For briefing tab, only get today's events with required times
  if (todayOnly) {
    return `Search for events happening TODAY (${date}) within ${MAX_DRIVE_MINUTES} minutes drive of coordinates ${latStr}, ${lngStr} (near ${city}, ${state}).${dedupSection}

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

  // 2026-01-14: Use 6-decimal formatted coordinates (latStr, lngStr defined above)
  return `Search for ALL events happening within ${MAX_DRIVE_MINUTES} minutes drive of coordinates ${latStr}, ${lngStr} (near ${city}, ${state}) from ${dateRange}.${dedupSection}

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

**CRITICAL - event_end_time is REQUIRED (2026-01-10 Rule):**
- MUST include event_end_time for EVERY event (no TBD, no omitting)
- If end time is not listed, ESTIMATE based on event type:
  - Concerts: 2-3 hours after start
  - Sports: Check typical game length (NBA ~2.5hr, NFL ~3.5hr, MLB ~3hr)
  - Theater: 2-3 hours
  - Festivals: Use posted closing time
- Events without determinable end times should NOT be returned
- This is required for rideshare driver pickup surge prediction

Search multiple sources thoroughly. Return [] only if truly no events found.`;
}

// ============================================================================
// SerpAPI Search (fastest, most efficient)
// ============================================================================
async function searchWithSerpAPI(city, state) {
  const apiKey = process.env.SERP_API_KEY || process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    eventsLog.phase(1, '[SerpAPI] Skipped - SERP_API_KEY not set');
    return [];
  }

  const startTime = Date.now();
  eventsLog.phase(1, `[SerpAPI] Searching events near ${city}, ${state}...`, OP.API);

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
      eventsLog.error(1, `[SerpAPI] Error ${response.status}`, err.slice(0, 100));
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

    eventsLog.done(1, `[SerpAPI] ${events.length} events`, Date.now() - startTime);
    return events;
  } catch (err) {
    eventsLog.error(1, `[SerpAPI] Error`, err.message);
    return [];
  }
}

// ============================================================================
// GPT-5.2 Search (best quality)
// ============================================================================
async function searchWithGPT52(city, state, lat, lng, existingEvents = [], options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    eventsLog.phase(1, '[GPT-5.2] Skipped - OPENAI_API_KEY not set');
    return [];
  }

  const startTime = Date.now();
  // Use user's local date if provided, otherwise use server date
  const date = options.userLocalDate || new Date().toISOString().split('T')[0];
  const modeLabel = options.todayOnly ? 'TODAY ONLY' : '7-day';
  eventsLog.phase(1, `[GPT-5.2] Searching ${city}, ${state} (${modeLabel}, date: ${date}, ${existingEvents.length} existing)`, OP.AI);

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
      eventsLog.error(1, `[GPT-5.2] Error ${response.status}`, err.slice(0, 100));
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

    eventsLog.done(1, `[GPT-5.2] ${events.length} events`, Date.now() - startTime);
    return events;
  } catch (err) {
    eventsLog.error(1, `[GPT-5.2] Error`, err.message);
    return [];
  }
}

// ============================================================================
// MODEL: Gemini 3 Pro with Google Search (daily sync)
// ============================================================================
async function searchWithGoogleSearch(city, state, lat, lng, existingEvents = [], options = {}) {
  // 2026-01-09: REFACTOR - Capability-based name (uses google_search tool)
  // Model-agnostic: uses Gemini 3 Pro via env-driven configuration
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    eventsLog.phase(1, '[Google Search] Skipped - GEMINI_API_KEY not set');
    return [];
  }

  const startTime = Date.now();
  // Use user's local date if provided, otherwise use server date
  const date = options.userLocalDate || new Date().toISOString().split('T')[0];
  const modeLabel = options.todayOnly ? 'TODAY ONLY' : '7-day';
  eventsLog.phase(1, `[Google Search] Searching ${city}, ${state} (${modeLabel}, date: ${date}, ${existingEvents.length} existing)`, OP.AI);

  try {
    const prompt = buildEventPrompt(city, state, date, lat, lng, existingEvents, options);

    // 2026-01-09: Uses gemini-3-pro-preview with google_search tool
    // Model ID requires -preview suffix per project memory
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
      eventsLog.error(1, `[Google Search] Error ${response.status}`, err.slice(0, 100));
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
      source_model: 'Google-Search',  // Capability-based, not model-specific
      source_url: evt.source || null,
      raw_source_data: evt
    }));

    eventsLog.done(1, `[Google Search] ${events.length} events`, Date.now() - startTime);
    return events;
  } catch (err) {
    eventsLog.error(1, `[Google Search] Error`, err.message);
    return [];
  }
}

// 2026-01-09: REMOVED - searchWithGemini25Pro was redundant with searchWithGoogleSearch
// Both used google_search tool. Consolidated into single capability-based function.

// ============================================================================
// MODEL: Claude with Web Search (daily sync)
// ============================================================================
async function searchWithClaude(city, state, lat, lng, existingEvents = [], options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    eventsLog.phase(1, '[Claude] Skipped - ANTHROPIC_API_KEY not set');
    return [];
  }

  const startTime = Date.now();
  // Use user's local date if provided, otherwise use server date
  const date = options.userLocalDate || new Date().toISOString().split('T')[0];
  const modeLabel = options.todayOnly ? 'TODAY ONLY' : '7-day';
  eventsLog.phase(1, `[Claude] Searching ${city}, ${state} (${modeLabel}, date: ${date}, ${existingEvents.length} existing)`, OP.AI);

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
      eventsLog.error(1, `[Claude] Error ${response.status}`, err.slice(0, 100));
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

    eventsLog.done(1, `[Claude] ${events.length} events`, Date.now() - startTime);
    return events;
  } catch (err) {
    eventsLog.error(1, `[Claude] Error`, err.message);
    return [];
  }
}

// ============================================================================
// MODEL: Perplexity Sonar Reasoning Pro (daily sync)
// ============================================================================
async function searchWithPerplexityReasoning(city, state, lat, lng, existingEvents = [], options = {}) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    eventsLog.phase(1, '[Perplexity] Skipped - PERPLEXITY_API_KEY not set');
    return [];
  }

  const startTime = Date.now();
  // Use user's local date if provided, otherwise use server date
  const date = options.userLocalDate || new Date().toISOString().split('T')[0];
  const modeLabel = options.todayOnly ? 'TODAY ONLY' : '7-day';
  eventsLog.phase(1, `[Perplexity] Searching ${city}, ${state} (${modeLabel}, date: ${date}, ${existingEvents.length} existing)`, OP.AI);

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
      eventsLog.error(1, `[Perplexity] Error ${response.status}`, err.slice(0, 100));
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

    eventsLog.done(1, `[Perplexity] ${events.length} events`, Date.now() - startTime);
    return events;
  } catch (err) {
    eventsLog.error(1, `[Perplexity] Error`, err.message);
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
// ETL Phase 4: LOAD
//
// 2026-01-09: Fixed insert counting (use RETURNING) and added upsert for safe fields
//
// IMPORTANT: is_active PRESERVATION
// The ON CONFLICT clause intentionally does NOT touch is_active.
// This preserves the state of manually deactivated events:
// - AI Coach can toggle is_active = false for low-value events
// - Re-discovery of the same event will NOT re-activate it
// - Only venue_id and updated_at are updated on conflict
// ============================================================================
async function storeEvents(db, events) {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const event of events) {
    const hash = generateEventHash(event);

    try {
      // 2026-01-09: Use UPSERT with RETURNING to accurately count inserts vs updates
      // - New rows: INSERT and return id → count as inserted
      // - Existing rows: UPDATE safe fields (venue_id, updated_at) → count as updated
      // INVARIANT: is_active is NEVER touched in ON CONFLICT - preserves manual deactivation
      // 2026-01-10: Use symmetric field names (event_start_date, event_start_time)
      const result = await db.execute(sql`
        INSERT INTO discovered_events (
          title, venue_name, address, city, state, zip,
          event_start_date, event_start_time, event_end_time, event_end_date,
          lat, lng, category, expected_attendance,
          source_model, source_url, raw_source_data,
          event_hash, venue_id, updated_at
        ) VALUES (
          ${event.title},
          ${event.venue_name},
          ${event.address},
          ${event.city},
          ${event.state},
          ${event.zip},
          ${event.event_start_date},
          ${event.event_start_time},
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
          ${event._venue_id || null},
          NOW()
        )
        ON CONFLICT (event_hash) DO UPDATE SET
          venue_id = COALESCE(EXCLUDED.venue_id, discovered_events.venue_id),
          updated_at = NOW()
        RETURNING id, (xmax = 0) AS was_inserted
      `);

      // xmax = 0 means INSERT, xmax > 0 means UPDATE
      if (result.rows.length > 0) {
        if (result.rows[0].was_inserted) {
          inserted++;
        } else {
          updated++;
        }
      }
    } catch (err) {
      // 2026-01-09: Removed defensive 23505 catch
      // With ON CONFLICT (event_hash) DO UPDATE, error 23505 should NEVER occur:
      // - New row → INSERT succeeds
      // - Duplicate hash → UPDATE fires (not error)
      // If we see 23505 here, it's a real bug (constraint mismatch, etc.) that should surface
      console.error(`  [DB] Error storing event "${event.title?.slice(0, 30)}": ${err.message}`);
      console.error(`  [DB] Event hash: ${hash}, Code: ${err.code}`);
      skipped++;
      // Re-throw 23505 to surface the root cause instead of masking it
      if (err.code === '23505') {
        throw new Error(`Unexpected duplicate key error despite ON CONFLICT: ${err.message}. This indicates a constraint/SQL mismatch.`);
      }
    }
  }

  return { inserted, updated, skipped };
}

// ============================================================================
// Main sync function (for user location)
// ETL Pipeline: Extract → Transform (Normalize + Validate) → Load
// ============================================================================
async function syncEventsForLocation(location, isDaily = false, options = {}) {
  const { city, state, lat, lng } = location;
  const { userLocalDate, todayOnly = false } = options;
  const startTime = Date.now();

  const mode = isDaily ? 'DAILY (all providers)' : 'NORMAL (SerpAPI + GPT)';
  const dateMode = todayOnly ? 'TODAY ONLY' : '7-day window';

  // ETL Pipeline start
  eventsLog.start(`${city}, ${state} | ${mode} | ${dateMode}`);

  const db = getDb();
  let allEvents = [];

  // Fetch existing events for semantic deduplication (pre-extract)
  // Use user's local date if provided, otherwise use server date
  const today = userLocalDate || new Date().toISOString().split('T')[0];
  const weekFromNow = new Date(today);
  weekFromNow.setDate(weekFromNow.getDate() + 7);
  const endDate = weekFromNow.toISOString().split('T')[0];

  eventsLog.phase(1, `Fetching existing events for semantic deduplication...`, OP.DB);
  const existingEvents = await fetchExistingEvents(db, city, state, today, endDate);
  eventsLog.done(1, `${existingEvents.length} existing events for dedup`, OP.DB);

  // Options to pass to discovery functions
  const searchOptions = { userLocalDate: today, todayOnly };

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 1: EXTRACT - Call discovery providers
  // ══════════════════════════════════════════════════════════════════════════
  eventsLog.phase(1, `Running ${isDaily ? '5 providers' : '2 providers'} in parallel...`, OP.AI);

  if (isDaily) {
    // DAILY MODE: Run ALL working providers in parallel for maximum coverage
    // All providers receive existing events for semantic deduplication
    // 2026-01-09: Consolidated to 5 providers (removed redundant Gemini 2.5 Pro)
    const results = await Promise.all([
      searchWithSerpAPI(city, state),  // SerpAPI doesn't support custom prompts
      searchWithGPT52(city, state, lat, lng, existingEvents, searchOptions),
      searchWithGoogleSearch(city, state, lat, lng, existingEvents, searchOptions),  // Capability-based: uses google_search tool
      searchWithClaude(city, state, lat, lng, existingEvents, searchOptions),
      searchWithPerplexityReasoning(city, state, lat, lng, existingEvents, searchOptions)
    ]);
    allEvents = results.flat();
  } else {
    // NORMAL MODE: Run only SerpAPI + GPT (fast/efficient)
    const [serpEvents, gptEvents] = await Promise.all([
      searchWithSerpAPI(city, state),
      searchWithGPT52(city, state, lat, lng, existingEvents, searchOptions)
    ]);
    allEvents = [...serpEvents, ...gptEvents];
  }

  eventsLog.done(1, `${allEvents.length} raw events from providers`, OP.AI);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  if (allEvents.length > 0) {
    // ════════════════════════════════════════════════════════════════════════
    // PHASE 2: TRANSFORM-A - Normalize + Validate (canonical modules)
    // Uses validateEventsHard from pipeline/validateEvent.js
    // ════════════════════════════════════════════════════════════════════════
    eventsLog.phase(2, `Validating ${allEvents.length} events...`, OP.VALIDATE);

    // 2026-01-09: Use canonical validateEventsHard (replaces filterInvalidEvents)
    // This is the ONLY place validation should happen at STORE time
    const validationResult = validateEventsHard(allEvents, {
      logRemovals: true,
      phase: 'SYNC_EVENTS'
    });
    allEvents = validationResult.valid;

    eventsLog.done(2, `${validationResult.stats.valid}/${validationResult.stats.total} valid (${validationResult.stats.invalid} invalid removed)`, OP.VALIDATE);

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 3: TRANSFORM-B - Geocode + Venue linking
    // ════════════════════════════════════════════════════════════════════════
    eventsLog.phase(3, `Geocoding ${allEvents.filter(e => !e.lat || !e.lng).length} events missing coordinates...`, OP.API);
    allEvents = await geocodeMissingCoordinates(allEvents);

    eventsLog.phase(3, `Processing ${allEvents.length} events through venue cache...`, OP.DB);
    allEvents = await processEventsWithVenueCache(allEvents);
    eventsLog.done(3, `Venue linking complete`, OP.DB);

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 4: LOAD - Upsert to discovered_events with event_hash deduplication
    // ════════════════════════════════════════════════════════════════════════
    eventsLog.phase(4, `Storing ${allEvents.length} events...`, OP.DB);
    const result = await storeEvents(db, allEvents);
    inserted = result.inserted;
    updated = result.updated || 0;
    skipped = result.skipped;
    eventsLog.done(4, `Inserted: ${inserted}, Updated: ${updated}, Skipped: ${skipped}`, OP.DB);
  } else {
    eventsLog.warn(1, 'No events found from any provider');
  }

  // Pipeline complete
  const totalMs = Date.now() - startTime;
  eventsLog.complete(`${allEvents.length} events (${inserted} new, ${updated} updated)`, totalMs);

  return { events: allEvents, inserted, updated, skipped };
}

// ============================================================================
// Export for use in briefing service
// ============================================================================
export {
  syncEventsForLocation,
  searchWithSerpAPI,
  searchWithGPT52,
  searchWithGoogleSearch,  // 2026-01-09: Renamed from searchWithGemini3Pro (capability-based)
  searchWithClaude,
  searchWithPerplexityReasoning,
  generateEventHash,
  storeEvents
};
