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
    // 2026-01-10: Use symmetric field name (event_start_date)
    const events = await db.select()
      .from(discovered_events)
      .where(
        and(
          eq(discovered_events.city, city),
          eq(discovered_events.state, state),
          eq(discovered_events.event_start_date, eventDate),
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
      const matchedEvents = [];

      for (const event of events) {
        // STRICT matching: require street number + street name OR significant venue name match
        const addressMatch = addressesMatchStrictly(venue.address, event.address);
        const nameMatch = venueNamesMatch(venue.name, event.venue_name);

        if (addressMatch || nameMatch) {
          // 2026-01-10: Use symmetric field names from DB
          matchedEvents.push({
            title: event.title,
            venue_name: event.venue_name,
            event_start_time: event.event_start_time,
            event_end_time: event.event_end_time,
            category: event.category,
            expected_attendance: event.expected_attendance
          });
          console.log(`[event-matcher] ✅ MATCH: "${venue.name}" ↔ "${event.title}" (${addressMatch ? 'address' : 'name'} match)`);
        }
      }

      if (matchedEvents.length > 0) {
        matchMap.set(venue.name, matchedEvents);
      }
    }

    return matchMap;

  } catch (err) {
    console.error('[event-matcher] Error matching events:', err.message);
    return new Map();
  }
}

/**
 * Extract street number from address (e.g., "6991 Main St" → "6991")
 */
function extractStreetNumber(address) {
  if (!address) return '';
  const match = address.match(/^(\d+)\s/);
  return match ? match[1] : '';
}

/**
 * Extract street name from address (e.g., "6991 Main St" → "main")
 */
function extractStreetName(address) {
  if (!address) return '';
  return address
    .toLowerCase()
    .replace(/^\d+\s+/, '')  // Remove leading street number
    .replace(/[,\.#]/g, '')  // Remove punctuation
    .replace(/\b(street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|way|court|ct|place|pl|parkway|pkwy|highway|hwy)\b/g, '')
    .replace(/\s+(tx|texas|usa|frisco|plano|dallas|mckinney)\b.*/i, '')  // Remove city/state suffix
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')[0] || '';  // Just the first word of street name
}

/**
 * Check if two addresses match strictly
 * Requires BOTH street number AND street name to match
 */
function addressesMatchStrictly(addr1, addr2) {
  if (!addr1 || !addr2) return false;

  const num1 = extractStreetNumber(addr1);
  const num2 = extractStreetNumber(addr2);

  // Street numbers must both exist and match
  if (!num1 || !num2 || num1 !== num2) return false;

  const street1 = extractStreetName(addr1);
  const street2 = extractStreetName(addr2);

  // Street names must match (at least one word)
  if (!street1 || !street2) return false;

  return street1 === street2 || street1.includes(street2) || street2.includes(street1);
}

/**
 * Check if venue names match (must be substantial match, not just partial)
 */
function venueNamesMatch(name1, name2) {
  if (!name1 || !name2) return false;

  const n1 = name1.toLowerCase().trim();
  const n2 = name2.toLowerCase().trim();

  // Exact match
  if (n1 === n2) return true;

  // One contains the other, but only if it's a significant portion (>50%)
  if (n1.includes(n2) && n2.length > n1.length * 0.5) return true;
  if (n2.includes(n1) && n1.length > n2.length * 0.5) return true;

  return false;
}
