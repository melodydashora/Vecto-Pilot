// server/lib/venue/event-matcher.js
// Simple event matching for SmartBlocks venues
// Queries discovered_events table and matches by address/city

import { db } from '../../db/drizzle.js';
import { discovered_events } from '../../../shared/schema.js';
import { eq, and, sql } from 'drizzle-orm';

/**
 * Match enriched venues to discovered events by address
 *
 * @param {Array} venues - Enriched venues with address field
 * @param {string} city - City name for filtering events
 * @param {string} state - State for filtering events
 * @param {string} eventDate - Date in YYYY-MM-DD format
 * @returns {Map<string, Array>} Map of venue address → matching events
 */
export async function matchVenuesToEvents(venues, city, state, eventDate) {
  if (!venues?.length || !city || !eventDate) {
    return new Map();
  }

  try {
    // Fetch today's events for this city
    const events = await db.select()
      .from(discovered_events)
      .where(
        and(
          eq(discovered_events.city, city),
          eq(discovered_events.state, state),
          eq(discovered_events.event_date, eventDate),
          eq(discovered_events.is_active, true)
        )
      );

    if (!events.length) {
      console.log(`[event-matcher] No events found for ${city}, ${state} on ${eventDate}`);
      return new Map();
    }

    console.log(`[event-matcher] Found ${events.length} events for ${city}, ${state} on ${eventDate}`);

    // Create map of venue address → matching events
    const matchMap = new Map();

    for (const venue of venues) {
      const venueAddress = normalizeAddress(venue.address);
      const venueName = venue.name?.toLowerCase() || '';
      const matchedEvents = [];

      for (const event of events) {
        // Match by normalized address
        const eventAddress = normalizeAddress(event.address);
        const eventVenueName = event.venue_name?.toLowerCase() || '';

        // Check for address match or venue name match
        const addressMatch = eventAddress && venueAddress &&
          (eventAddress.includes(venueAddress) || venueAddress.includes(eventAddress));

        const nameMatch = eventVenueName && venueName &&
          (eventVenueName.includes(venueName) || venueName.includes(eventVenueName));

        if (addressMatch || nameMatch) {
          matchedEvents.push({
            title: event.title,
            venue_name: event.venue_name,
            event_time: event.event_time,
            event_end_time: event.event_end_time,
            category: event.category,
            expected_attendance: event.expected_attendance
          });
        }
      }

      if (matchedEvents.length > 0) {
        matchMap.set(venue.name, matchedEvents);
        console.log(`[event-matcher] ✅ ${venue.name} matched ${matchedEvents.length} event(s): ${matchedEvents.map(e => e.title).join(', ')}`);
      }
    }

    return matchMap;

  } catch (err) {
    console.error('[event-matcher] Error matching events:', err.message);
    return new Map();
  }
}

/**
 * Normalize address for fuzzy matching
 * Removes common suffixes, punctuation, and extra spaces
 */
function normalizeAddress(address) {
  if (!address) return '';

  return address
    .toLowerCase()
    .replace(/[,\.#]/g, '')  // Remove punctuation
    .replace(/\b(street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|way|court|ct|place|pl)\b/g, '') // Remove street suffixes
    .replace(/\s+/g, ' ')    // Collapse whitespace
    .trim();
}
