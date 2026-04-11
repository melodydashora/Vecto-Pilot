#!/usr/bin/env node
/**
 * backfill-venue-addresses.js
 *
 * One-time backfill script to fix venue_catalog entries with wrong addresses/coordinates.
 * Uses Google Places API (New) as the authoritative source of truth.
 *
 * Problem: Many venue_catalog entries were created from imprecise geocoding (e.g., "Globe Life
 * Field" geocoded as "Frisco, TX" instead of "1000 Ballpark Way, Arlington, TX 76011").
 *
 * Solution: For each venue, call Google Places API searchText with the venue name + a wide
 * location bias (50km from the venue's market center). Update venue_catalog AND cascade
 * the correct city to discovered_events rows that reference the venue.
 *
 * Usage:
 *   node scripts/backfill-venue-addresses.js                    # Process all event venues
 *   node scripts/backfill-venue-addresses.js --dry-run           # Preview changes
 *   node scripts/backfill-venue-addresses.js --all               # Process ALL venues (not just event venues)
 *   node scripts/backfill-venue-addresses.js --limit 10          # Process first 10 only
 *   node scripts/backfill-venue-addresses.js --venue "Globe Life" # Process specific venue by name
 *
 * 2026-04-10: Created to fix bad venue data after pipeline architecture correction.
 */

import { db } from '../server/db/drizzle.js';
import { venue_catalog, discovered_events } from '../shared/schema.js';
import { eq, and, isNotNull, sql } from 'drizzle-orm';
import { parseAddressComponents, generateCoordKey } from '../server/lib/venue/venue-utils.js';

// --- CONFIG ---
const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK = 'places.id,places.displayName,places.addressComponents,places.formattedAddress,places.location,places.types';

// 2026-04-11: FIX — Google Places API max radius is 50,000m. Was 100,000 → 400 error.
// 50km radius covers the full DFW metro area (Dallas to Fort Worth is ~50km).
const SEARCH_RADIUS_METERS = 50000;

// DFW metro center — used as default bias when venue has no stored coordinates
const DFW_CENTER = { lat: 32.7767, lng: -96.7970 };

// Rate limiting: 5 venues per batch, 200ms between batches
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 200;

// --- CLI ARGS ---
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ALL_VENUES = args.includes('--all');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null;
const venueIdx = args.indexOf('--venue');
const VENUE_FILTER = venueIdx !== -1 ? args[venueIdx + 1] : null;

/**
 * Raw Google Places API call. If biasLat/biasLng are null, search WITHOUT location bias.
 */
async function callPlacesApi(venueName, biasLat, biasLng) {
  const body = { textQuery: venueName, maxResultCount: 1 };

  // Only add location bias if coordinates are provided
  if (biasLat != null && biasLng != null) {
    body.locationBias = {
      circle: {
        center: { latitude: biasLat, longitude: biasLng },
        radius: SEARCH_RADIUS_METERS
      }
    };
  }

  const response = await fetch(PLACES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      'X-Goog-FieldMask': FIELD_MASK
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`   API error (${response.status}): ${text.slice(0, 200)}`);
    return null;
  }

  const data = await response.json();
  const place = data.places?.[0];
  if (!place) return null;

  // Reject plus codes (unreliable)
  if (place.formattedAddress && /^\w{4}\+\w{2,3}\s/.test(place.formattedAddress)) {
    return null;
  }

  const parsed = parseAddressComponents(place.addressComponents || []);

  // 2026-04-11: Round coords to 6 decimal places — consistent with coord_key precision
  const rawLat = place.location?.latitude;
  const rawLng = place.location?.longitude;

  return {
    placeId: place.id,
    displayName: place.displayName?.text,
    formattedAddress: place.formattedAddress,
    lat: rawLat != null ? parseFloat(Number(rawLat).toFixed(6)) : null,
    lng: rawLng != null ? parseFloat(Number(rawLng).toFixed(6)) : null,
    types: place.types || [],
    city: parsed?.city || null,
    state: parsed?.state || null,
    zip: parsed?.zip || null,
    country: parsed?.country || null,
    address_1: parsed?.address_1 || null
  };
}

/**
 * Two-pass venue search strategy:
 *
 * Pass 1: Search WITHOUT location bias. Google Places textQuery works great for well-known
 * venues (stadiums, arenas, popular bars) without needing coordinate hints. This fixes cases
 * like "Billy Bob's Texas" where stored coords are wrong and would bias to the wrong area.
 *
 * Pass 2: If Pass 1 returns a venue >100km from the metro center, try again WITH location bias.
 * This handles generic venue names (e.g., "Gateway Park") that exist in multiple cities.
 *
 * @param {string} venueName - Venue name to search
 * @param {number} biasLat - Latitude for location bias (fallback)
 * @param {number} biasLng - Longitude for location bias (fallback)
 * @returns {Promise<Object|null>} Place result with parsed address
 */
async function searchPlace(venueName, biasLat, biasLng) {
  if (!venueName) return null;

  // Pass 1: Unbiased search — let Google find the most relevant match by name alone
  const unbiased = await callPlacesApi(venueName, null, null);

  if (unbiased && unbiased.lat != null) {
    const distFromMetro = haversineDistance(biasLat, biasLng, unbiased.lat, unbiased.lng);

    // If the unbiased result is within 100km of our metro, it's the right one
    if (distFromMetro <= 100000) {
      return unbiased;
    }

    // Unbiased result is far away — this venue name exists elsewhere too.
    // Fall through to biased search.
    console.log(`   Pass 1 (unbiased): "${unbiased.displayName}" at ${unbiased.formattedAddress} -- ${Math.round(distFromMetro / 1000)}km away, trying biased search...`);
  }

  // Pass 2: Biased search — anchor to metro center for ambiguous venue names
  const biased = await callPlacesApi(venueName, biasLat, biasLng);
  return biased;
}

/**
 * Main backfill function.
 */
async function main() {
  console.log('=== Venue Address Backfill (Google Places API) ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Scope: ${ALL_VENUES ? 'ALL venues' : 'Event venues only (is_event_venue=true)'}`);
  if (VENUE_FILTER) console.log(`Filter: venue_name LIKE "%${VENUE_FILTER}%"`);
  if (LIMIT) console.log(`Limit: ${LIMIT}`);
  console.log('');

  if (!GOOGLE_API_KEY) {
    console.error('GOOGLE_MAPS_API_KEY not set. Exiting.');
    process.exit(1);
  }

  // Build query
  const conditions = [];
  if (!ALL_VENUES) {
    conditions.push(eq(venue_catalog.is_event_venue, true));
  }
  if (VENUE_FILTER) {
    conditions.push(sql`${venue_catalog.venue_name} ILIKE ${'%' + VENUE_FILTER + '%'}`);
  }

  let query = db.select({
    venue_id: venue_catalog.venue_id,
    venue_name: venue_catalog.venue_name,
    lat: venue_catalog.lat,
    lng: venue_catalog.lng,
    city: venue_catalog.city,
    state: venue_catalog.state,
    address: venue_catalog.address,
    formatted_address: venue_catalog.formatted_address,
    place_id: venue_catalog.place_id,
    coord_key: venue_catalog.coord_key
  })
    .from(venue_catalog)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  if (LIMIT) query = query.limit(LIMIT);

  const venues = await query;
  console.log(`Found ${venues.length} venues to process.\n`);

  if (venues.length === 0) {
    console.log('Nothing to do.');
    process.exit(0);
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let eventsUpdated = 0;

  // Process in batches
  for (let i = 0; i < venues.length; i += BATCH_SIZE) {
    const batch = venues.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (venue) => {
      const label = `[${i + batch.indexOf(venue) + 1}/${venues.length}] "${venue.venue_name}"`;

      // Use DFW metro center as bias — NOT the venue's stored coords which may be wrong.
      // The two-pass search strategy in searchPlace() tries unbiased first anyway.
      const biasLat = DFW_CENTER.lat;
      const biasLng = DFW_CENTER.lng;

      try {
        const result = await searchPlace(venue.venue_name, biasLat, biasLng);

        if (!result) {
          console.log(`${label} -- no Places API result, SKIPPED`);
          skipped++;
          return;
        }

        // Distance sanity check: if Places API returned a venue >100km from the bias
        // center, it's likely a wrong match (e.g., "Rosie McCann's" in Santa Cruz vs Frisco)
        if (result.lat && venue.lat) {
          const distFromBias = haversineDistance(biasLat, biasLng, result.lat, result.lng);
          if (distFromBias > 100000) { // 100km threshold
            console.log(`${label} -- REJECTED: Places result ${Math.round(distFromBias / 1000)}km from venue (likely wrong match)`);
            console.log(`   Google returned: "${result.displayName}" at ${result.formattedAddress}`);
            skipped++;
            return;
          }
        }

        // Show what we found vs what's stored
        const cityChanged = result.city && venue.city && result.city.toLowerCase() !== venue.city.toLowerCase();
        const addrChanged = result.formattedAddress && result.formattedAddress !== venue.formatted_address;

        console.log(`${label}`);
        console.log(`   Google: "${result.displayName}" at ${result.formattedAddress}`);
        console.log(`   Stored: city="${venue.city}", addr="${venue.formatted_address || venue.address || '(none)'}"`);
        if (cityChanged) console.log(`   ** CITY CHANGE: "${venue.city}" -> "${result.city}"`);
        if (result.lat && venue.lat) {
          const dist = Math.round(haversineDistance(venue.lat, venue.lng, result.lat, result.lng));
          if (dist > 100) console.log(`   ** COORDS MOVED: ${dist}m`);
        }

        if (DRY_RUN) {
          if (addrChanged || cityChanged) updated++;
          else skipped++;
          return;
        }

        // Update venue_catalog
        const newCoordKey = result.lat && result.lng ? generateCoordKey(result.lat, result.lng) : venue.coord_key;

        await db.update(venue_catalog)
          .set({
            formatted_address: result.formattedAddress,
            address: result.address_1 || result.formattedAddress,
            city: result.city || venue.city,
            state: result.state || venue.state,
            zip: result.zip || undefined,
            country: result.country || undefined,
            lat: result.lat || venue.lat,
            lng: result.lng || venue.lng,
            coord_key: newCoordKey,
            place_id: result.placeId || venue.place_id,
            updated_at: new Date()
          })
          .where(eq(venue_catalog.venue_id, venue.venue_id));

        updated++;

        // Cascade: update discovered_events that reference this venue
        if (result.city || result.formattedAddress) {
          const eventUpdates = {};
          if (result.city) eventUpdates.city = result.city;
          if (result.state) eventUpdates.state = result.state;
          if (result.formattedAddress) eventUpdates.address = result.formattedAddress;

          const eventResult = await db.update(discovered_events)
            .set(eventUpdates)
            .where(eq(discovered_events.venue_id, venue.venue_id))
            .returning({ id: discovered_events.id });

          const count = eventResult.length;
          if (count > 0) {
            console.log(`   Updated ${count} discovered_events rows`);
            eventsUpdated += count;
          }
        }
      } catch (err) {
        console.error(`${label} -- ERROR: ${err.message}`);
        failed++;
      }
    }));

    // Rate limit between batches
    if (i + BATCH_SIZE < venues.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Venues updated:  ${updated}`);
  console.log(`Venues skipped:  ${skipped}`);
  console.log(`Venues failed:   ${failed}`);
  console.log(`Events cascaded: ${eventsUpdated}`);
  if (DRY_RUN) console.log('\n(DRY RUN - no changes were made)');

  process.exit(0);
}

/**
 * Haversine distance between two points in meters.
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
