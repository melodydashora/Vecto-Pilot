#!/usr/bin/env node
/**
 * Resolve missing addresses in venue_catalog using Google Places API (New)
 *
 * Uses a "Distance Ranker" approach:
 * 1. Search for venue name with location bias from existing coordinates
 * 2. Get multiple candidates from Google
 * 3. Pick the candidate closest to our source coordinates (haversine distance)
 * 4. Update the database with the resolved address
 *
 * Usage: node scripts/resolve-venue-addresses.js [--dry-run] [--limit N]
 *
 * Options:
 *   --dry-run    Show what would be updated without making changes
 *   --limit N    Only process N venues (useful for testing)
 *   --force      Re-resolve addresses even if they exist
 */

import { db } from '../server/db/drizzle.js';
import { venue_catalog } from '../shared/schema.js';
import { eq, isNull, isNotNull, and, sql } from 'drizzle-orm';

// --- CONFIGURATION ---
const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';

// Distance thresholds
const SEARCH_RADIUS_METERS = 500;   // Bias radius for search
const MAX_DISTANCE_METERS = 2000;   // Reject matches further than this

// Parse CLI arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const limitIndex = args.indexOf('--limit');
const LIMIT = limitIndex !== -1 ? parseInt(args[limitIndex + 1], 10) : null;

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} Distance in meters
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Calculate name similarity score (0-1) using word overlap
 * @param {string} name1 - First name
 * @param {string} name2 - Second name
 * @returns {number} Similarity score (0-1)
 */
function nameSimilarity(name1, name2) {
  if (!name1 || !name2) return 0;

  // Normalize: lowercase, remove punctuation, split into words
  const normalize = (str) =>
    str
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 1); // Ignore single letters

  const words1 = new Set(normalize(name1));
  const words2 = new Set(normalize(name2));

  if (words1.size === 0 || words2.size === 0) return 0;

  // Count overlapping words
  let overlap = 0;
  for (const word of words1) {
    if (words2.has(word)) overlap++;
  }

  // Jaccard-like similarity: overlap / union
  const union = new Set([...words1, ...words2]).size;
  return overlap / union;
}

// Thresholds for verification
const MIN_NAME_SIMILARITY = 0.25;  // At least 25% word overlap required
const NAME_WEIGHT = 0.4;           // 40% weight for name similarity
const DISTANCE_WEIGHT = 0.6;       // 60% weight for distance proximity

/**
 * Search Google Places for a venue and return the best matching address
 * Uses DUAL VERIFICATION: name similarity + distance ranking
 *
 * @param {string} venueName - Name of the venue to search
 * @param {number} lat - Source latitude
 * @param {number} lng - Source longitude
 * @returns {Promise<{address: string, placeId: string, distance: number, nameSimilarity: number} | null>}
 */
async function findAddressForVenue(venueName, lat, lng) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': GOOGLE_API_KEY,
    // Field Mask: Only request what we need to minimize costs
    'X-Goog-FieldMask': 'places.formattedAddress,places.location,places.displayName,places.id',
  };

  const payload = {
    textQuery: venueName,
    locationBias: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: SEARCH_RADIUS_METERS,
      },
    },
    maxResultCount: 5, // Get top 5 candidates to compare
  };

  try {
    const response = await fetch(PLACES_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`   API Error (${response.status}): ${errorText}`);
      return null;
    }

    const data = await response.json();
    const candidates = data.places || [];

    if (candidates.length === 0) {
      return null;
    }

    // --- DUAL VERIFICATION: Name + Distance ---
    // Score each candidate by BOTH name similarity AND distance
    let bestCandidate = null;
    let bestScore = -Infinity;
    let bestDetails = {};

    for (const place of candidates) {
      const placeLat = place.location?.latitude;
      const placeLng = place.location?.longitude;
      const placeName = place.displayName?.text || '';

      if (placeLat == null || placeLng == null) continue;

      // Calculate metrics
      const dist = haversineDistance(lat, lng, placeLat, placeLng);
      const nameScore = nameSimilarity(venueName, placeName);

      // Normalize distance to 0-1 (closer = higher score)
      // At 0m = 1.0, at MAX_DISTANCE_METERS = 0.0
      const distanceScore = Math.max(0, 1 - dist / MAX_DISTANCE_METERS);

      // Combined score (weighted)
      const combinedScore = NAME_WEIGHT * nameScore + DISTANCE_WEIGHT * distanceScore;

      if (combinedScore > bestScore) {
        bestScore = combinedScore;
        bestCandidate = place;
        bestDetails = {
          distance: Math.round(dist),
          nameSimilarity: Math.round(nameScore * 100),
          distanceScore: Math.round(distanceScore * 100),
          combinedScore: Math.round(combinedScore * 100),
          googleName: placeName,
        };
      }
    }

    // --- VERIFICATION GATES ---
    // Gate 1: Distance must be within threshold
    if (bestDetails.distance > MAX_DISTANCE_METERS) {
      console.log(`   ⚠️  Distance check FAILED: ${bestDetails.distance}m > ${MAX_DISTANCE_METERS}m`);
      return null;
    }

    // Gate 2: Name must have minimum similarity (unless very close)
    const nameScoreDecimal = bestDetails.nameSimilarity / 100;
    if (nameScoreDecimal < MIN_NAME_SIMILARITY && bestDetails.distance > 200) {
      console.log(`   ⚠️  Name check FAILED: "${bestDetails.googleName}" (${bestDetails.nameSimilarity}% match, ${bestDetails.distance}m away)`);
      return null;
    }

    return {
      address: bestCandidate.formattedAddress,
      placeId: bestCandidate.id,
      displayName: bestDetails.googleName,
      distance: bestDetails.distance,
      nameSimilarity: bestDetails.nameSimilarity,
      combinedScore: bestDetails.combinedScore,
    };
  } catch (err) {
    console.error(`   API Error: ${err.message}`);
    return null;
  }
}

/**
 * Main function - process venues with missing addresses
 */
async function main() {
  console.log('🏢 Venue Address Resolver');
  console.log('─────────────────────────────────────────────');

  if (!GOOGLE_API_KEY) {
    console.error('❌ GOOGLE_MAPS_API_KEY environment variable not set');
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('📋 DRY RUN MODE - No changes will be made\n');
  }

  // Build query based on options
  let whereClause;
  if (FORCE) {
    // Re-resolve all venues with coordinates
    whereClause = and(
      isNotNull(venue_catalog.lat),
      isNotNull(venue_catalog.lng)
    );
    console.log('🔄 FORCE MODE - Re-resolving all venues with coordinates\n');
  } else {
    // Only venues missing addresses but having coordinates
    // Check for NULL OR empty string (common in this database)
    whereClause = and(
      sql`(${venue_catalog.address} IS NULL OR ${venue_catalog.address} = '')`,
      isNotNull(venue_catalog.lat),
      isNotNull(venue_catalog.lng)
    );
  }

  // Fetch venues needing address resolution
  let query = db.select({
    venue_id: venue_catalog.venue_id,
    venue_name: venue_catalog.venue_name,
    lat: venue_catalog.lat,
    lng: venue_catalog.lng,
    city: venue_catalog.city,
    current_address: venue_catalog.address,
  })
  .from(venue_catalog)
  .where(whereClause);

  if (LIMIT) {
    query = query.limit(LIMIT);
  }

  const venues = await query;

  console.log(`📊 Found ${venues.length} venues to process${LIMIT ? ` (limited to ${LIMIT})` : ''}\n`);

  if (venues.length === 0) {
    console.log('✅ No venues need address resolution!');
    process.exit(0);
  }

  // Process venues
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < venues.length; i++) {
    const venue = venues[i];
    const progress = `[${i + 1}/${venues.length}]`;

    console.log(`${progress} 🔍 Searching: ${venue.venue_name} (${venue.city || 'unknown city'})`);
    console.log(`   📍 Coords: ${venue.lat.toFixed(6)}, ${venue.lng.toFixed(6)}`);

    const result = await findAddressForVenue(venue.venue_name, venue.lat, venue.lng);

    if (result) {
      console.log(`   ✅ Found: ${result.address}`);
      console.log(`   📏 Distance: ${result.distance}m | Name: ${result.nameSimilarity}% match | Score: ${result.combinedScore}%`);
      if (result.displayName !== venue.venue_name) {
        console.log(`   🏷️  Google name: "${result.displayName}"`);
      }

      if (!DRY_RUN) {
        try {
          // Only update address - place_id has UNIQUE constraint and
          // multiple venues with same name would conflict
          await db.update(venue_catalog)
            .set({
              address: result.address,
            })
            .where(eq(venue_catalog.venue_id, venue.venue_id));
          updated++;
        } catch (dbErr) {
          console.log(`   ❌ DB Error: ${dbErr.message}`);
          errors++;
        }
      } else {
        updated++;
      }
    } else {
      console.log(`   ⏭️  No suitable match found`);
      skipped++;
    }

    // Rate limiting: 100ms delay between API calls
    await new Promise((r) => setTimeout(r, 100));
  }

  // Summary
  console.log('\n─────────────────────────────────────────────');
  console.log('📊 Summary');
  console.log(`   ✅ Updated: ${updated}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Errors: ${errors}`);

  if (DRY_RUN) {
    console.log('\n📋 This was a dry run. Run without --dry-run to apply changes.');
  }
}

// Run
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
