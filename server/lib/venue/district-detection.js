/**
 * DISTRICT DETECTION & CLUSTERING
 *
 * Detects and manages venue districts (shopping centers, entertainment districts, etc.)
 * to improve Places API matching accuracy when LLM coordinates are imprecise.
 *
 * Problem Solved:
 *   GPT-5.2 says "Legacy Hall" at coords that are 100m off
 *   → Places API finds wrong business at those coords
 *   → With district: text search "Legacy Hall Legacy West Plano TX" finds correct venue
 *
 * Usage:
 *   import { detectDistricts, normalizeDistrictSlug, calculateDistrictCentroid } from './district-detection.js';
 */

import { db } from '../../db/drizzle.js';
import { venue_catalog } from '../../../shared/schema.js';
import { eq, and, sql } from 'drizzle-orm';

/**
 * Calculate distance between two coordinates in meters (Haversine formula)
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number} Distance in meters
 */
export function calculateDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Normalize district name to URL-safe slug
 * @param {string} district - Human-readable district name
 * @returns {string} Normalized slug (e.g., "Legacy West" → "legacy-west")
 */
export function normalizeDistrictSlug(district) {
  if (!district) return null;

  return district
    .toLowerCase()
    .replace(/['']/g, '')           // Remove apostrophes
    .replace(/[^\w\s-]/g, '')       // Remove special chars except hyphens
    .replace(/\s+/g, '-')           // Spaces to hyphens
    .replace(/-+/g, '-')            // Collapse multiple hyphens
    .replace(/^-|-$/g, '');         // Trim leading/trailing hyphens
}

/**
 * Calculate centroid of a set of coordinates
 * @param {Array<{lat: number, lng: number}>} coords
 * @returns {{lat: number, lng: number}} Centroid coordinates
 */
export function calculateCentroid(coords) {
  if (!coords || coords.length === 0) return null;

  const sum = coords.reduce((acc, c) => ({
    lat: acc.lat + c.lat,
    lng: acc.lng + c.lng
  }), { lat: 0, lng: 0 });

  return {
    lat: sum.lat / coords.length,
    lng: sum.lng / coords.length
  };
}

/**
 * Detect district clusters from a set of venues
 * Groups venues within a radius that share similar district mentions
 *
 * @param {Array} venues - Venues with lat, lng, name, and optional district
 * @param {number} radiusMeters - Clustering radius (default 500m)
 * @param {number} minVenuesForCluster - Minimum venues to form a district (default 3)
 * @returns {Map<string, {centroid: {lat, lng}, venues: Array}>} District slug → cluster info
 */
export function detectDistrictClusters(venues, radiusMeters = 500, minVenuesForCluster = 3) {
  if (!venues || venues.length === 0) return new Map();

  // Group venues by district name
  const districtGroups = new Map();

  for (const venue of venues) {
    if (!venue.district) continue;

    const slug = normalizeDistrictSlug(venue.district);
    if (!slug) continue;

    if (!districtGroups.has(slug)) {
      districtGroups.set(slug, {
        name: venue.district,
        venues: []
      });
    }

    districtGroups.get(slug).venues.push(venue);
  }

  // Filter to clusters with minimum venue count
  const clusters = new Map();

  for (const [slug, group] of districtGroups) {
    if (group.venues.length < minVenuesForCluster) continue;

    // Verify venues are actually clustered (within radius of each other)
    const coords = group.venues.map(v => ({ lat: v.lat, lng: v.lng }));
    const centroid = calculateCentroid(coords);

    // Check all venues are within radius of centroid
    const allWithinRadius = group.venues.every(v =>
      calculateDistanceMeters(v.lat, v.lng, centroid.lat, centroid.lng) <= radiusMeters
    );

    if (allWithinRadius) {
      clusters.set(slug, {
        name: group.name,
        slug,
        centroid,
        venues: group.venues,
        venueCount: group.venues.length
      });

      console.log(`[district-detection] Found cluster: "${group.name}" (${group.venues.length} venues, centroid: ${centroid.lat.toFixed(6)}, ${centroid.lng.toFixed(6)})`);
    }
  }

  return clusters;
}

/**
 * Extract district name from venue name if it contains a known pattern
 * Handles patterns like "Legacy Hall (Legacy West)" or "Union Bear - Deep Ellum"
 *
 * @param {string} venueName - Full venue name
 * @returns {string|null} Extracted district name or null
 */
export function extractDistrictFromVenueName(venueName) {
  if (!venueName) return null;

  // Pattern 1: Venue Name (District Name)
  const parenMatch = venueName.match(/\(([^)]+)\)$/);
  if (parenMatch) {
    const candidate = parenMatch[1].trim();
    // Filter out things that aren't districts (like "Food Hall", "Hotel", etc.)
    if (!isServiceType(candidate)) {
      return candidate;
    }
  }

  // Pattern 2: Venue Name - District Name
  const dashMatch = venueName.match(/\s+-\s+([^-]+)$/);
  if (dashMatch) {
    const candidate = dashMatch[1].trim();
    if (!isServiceType(candidate)) {
      return candidate;
    }
  }

  // Pattern 3: Venue Name at District Name
  const atMatch = venueName.match(/\s+at\s+(.+)$/i);
  if (atMatch) {
    const candidate = atMatch[1].trim();
    if (!isServiceType(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Check if a string is a service type rather than a district name
 */
function isServiceType(str) {
  const serviceTypes = [
    'hotel', 'motel', 'inn', 'suites', 'resort',
    'restaurant', 'bar', 'grill', 'cafe', 'bistro',
    'food hall', 'food court', 'brewery', 'taproom',
    'lounge', 'club', 'venue', 'theater', 'theatre',
    'arena', 'stadium', 'center', 'centre'
  ];

  const lower = str.toLowerCase();
  return serviceTypes.some(type => lower.includes(type));
}

/**
 * Update venue catalog with district information
 * @param {string} venueId - Venue UUID
 * @param {string} district - District name
 * @param {Object} centroid - Optional centroid coordinates
 */
export async function updateVenueDistrict(venueId, district, centroid = null) {
  const slug = normalizeDistrictSlug(district);

  const updateData = {
    district,
    district_slug: slug
  };

  if (centroid) {
    updateData.district_centroid_lat = centroid.lat;
    updateData.district_centroid_lng = centroid.lng;
  }

  await db.update(venue_catalog)
    .set(updateData)
    .where(eq(venue_catalog.venue_id, venueId));

  console.log(`[district-detection] Updated venue ${venueId} with district: "${district}" (${slug})`);
}

/**
 * Find venues in same district within a city
 * @param {string} city - City name
 * @param {string} districtSlug - Normalized district slug
 * @returns {Promise<Array>} Venues in that district
 */
export async function findVenuesInDistrict(city, districtSlug) {
  return db.select()
    .from(venue_catalog)
    .where(
      and(
        eq(venue_catalog.city, city),
        eq(venue_catalog.district_slug, districtSlug)
      )
    );
}

/**
 * Deduplicate venues by district - keep max N venues per district
 * Prevents recommending 5 venues all from "Legacy West"
 *
 * @param {Array} venues - Venues with district field
 * @param {number} maxPerDistrict - Max venues per district (default 2)
 * @returns {Array} Deduplicated venues
 */
export function deduplicateByDistrict(venues, maxPerDistrict = 2) {
  if (!venues || venues.length === 0) return [];

  const districtCounts = new Map();
  const result = [];

  for (const venue of venues) {
    const district = venue.district || 'unknown';
    const count = districtCounts.get(district) || 0;

    if (count >= maxPerDistrict) {
      console.log(`[district-dedup] Skipping "${venue.name}" - already ${count} venues from "${district}"`);
      continue;
    }

    districtCounts.set(district, count + 1);
    result.push(venue);
  }

  const skipped = venues.length - result.length;
  if (skipped > 0) {
    console.log(`[district-dedup] Kept ${result.length} venues, skipped ${skipped} duplicates`);
  }

  return result;
}

/**
 * Validate that venue coordinates are reasonable for its claimed district
 * Flags venues that claim a district but are >1km from district centroid
 *
 * @param {Object} venue - Venue with lat, lng, district
 * @param {Map} districtCentroids - Map of district_slug → {lat, lng}
 * @param {number} maxDistanceMeters - Max allowed distance from centroid (default 1000m)
 * @returns {{valid: boolean, distance: number, message: string}}
 */
export function validateVenueDistrict(venue, districtCentroids, maxDistanceMeters = 1000) {
  if (!venue.district) {
    return { valid: true, distance: null, message: 'No district claimed' };
  }

  const slug = normalizeDistrictSlug(venue.district);
  const centroid = districtCentroids.get(slug);

  if (!centroid) {
    return { valid: true, distance: null, message: 'District centroid unknown' };
  }

  const distance = calculateDistanceMeters(venue.lat, venue.lng, centroid.lat, centroid.lng);

  if (distance > maxDistanceMeters) {
    return {
      valid: false,
      distance,
      message: `Venue claims "${venue.district}" but is ${(distance / 1000).toFixed(1)}km from district centroid`
    };
  }

  return { valid: true, distance, message: 'Within district bounds' };
}
