// server/lib/briefing/context-loader.js
// ============================================================================
// STRATEGIST CONTEXT LOADER
// ============================================================================
//
// PURPOSE: "Short-circuit" the LLM by feeding it verified database data
// (Bars & Events) so it doesn't need to hallucinate or scrape for things
// we already know.
//
// ARCHITECTURE (2026-01-14 - Phase 3 Intelligence Hardening):
//   - Queries venue_catalog for verified high-value bars (is_bar=true)
//   - Queries discovered_events for confirmed events today
//   - Returns structured context that Gemini can correlate with traffic data
//
// USAGE:
//   import { getStrategistContext } from '../briefing/context-loader.js';
//   const context = await getStrategistContext('Frisco', 'TX');
//   // Returns: { topVenues, activeEvents }
//
// ============================================================================

import { db } from '../../db/drizzle.js';
import { venue_catalog, discovered_events } from '../../../shared/schema.js';
import { eq, and, desc, gte, lte } from 'drizzle-orm';
import { briefingLog, OP } from '../../logger/workflow.js';

/**
 * Load strategist context from internal database
 *
 * Provides "ground truth" data to the LLM so it can make informed decisions
 * without relying on web scraping or hallucination.
 *
 * @param {string} city - City name (e.g., 'Frisco')
 * @param {string} state - State code (e.g., 'TX')
 * @param {Date} date - Target date (defaults to today)
 * @returns {Promise<{topVenues: Array, activeEvents: Array}>}
 */
export async function getStrategistContext(city, state, date = new Date()) {
  const startTime = Date.now();

  // Calculate day boundaries
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  // Format date for SQL comparison (YYYY-MM-DD)
  const dateStr = date.toISOString().split('T')[0];

  try {
    // 1. Fetch "Verified" High-Value Bars
    // These are venues with is_bar=true from the Progressive Enrichment migration
    const topVenues = await db.select({
      name: venue_catalog.venue_name,
      district: venue_catalog.district,
      rank: venue_catalog.expense_rank,
      crowd: venue_catalog.crowd_level,
      address: venue_catalog.address,
      // 2026-01-14: Include record_status for AI context
      status: venue_catalog.record_status
    })
    .from(venue_catalog)
    .where(and(
      eq(venue_catalog.city, city),
      eq(venue_catalog.is_bar, true),
      gte(venue_catalog.expense_rank, 2) // $$ and up
    ))
    .limit(15);

    // 2. Fetch "Confirmed" Events for today
    // Using event_start_date per 20260110_rename_event_columns migration
    const activeEvents = await db.select({
      title: discovered_events.title,
      venue: discovered_events.venue_name,
      start: discovered_events.event_start_time,
      end: discovered_events.event_end_time,
      attendance: discovered_events.expected_attendance,
      category: discovered_events.category,
      address: discovered_events.address
    })
    .from(discovered_events)
    .where(and(
      eq(discovered_events.city, city),
      eq(discovered_events.state, state),
      eq(discovered_events.event_start_date, dateStr),
      eq(discovered_events.is_active, true)
    ))
    .orderBy(desc(discovered_events.expected_attendance))
    .limit(10);

    const elapsedMs = Date.now() - startTime;
    briefingLog.phase(1, `Context loaded: ${topVenues.length} venues, ${activeEvents.length} events (${elapsedMs}ms)`, OP.DB);

    return { topVenues, activeEvents };
  } catch (error) {
    console.error('[context-loader] Error loading strategist context:', error);
    // Return empty arrays to allow graceful degradation
    return { topVenues: [], activeEvents: [] };
  }
}

/**
 * Get venue intel for a specific location (for traffic correlation)
 *
 * Returns venues near a coordinate, useful for correlating traffic
 * incidents with specific venue districts.
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} radiusMiles - Search radius (default 5)
 * @returns {Promise<Array>}
 */
export async function getNearbyVenueIntel(lat, lng, radiusMiles = 5) {
  // For now, this is a placeholder that returns city-based data
  // Future: Add PostGIS spatial query support
  return [];
}

/**
 * Get event intel that might affect traffic
 *
 * Returns large events (500+ expected attendance) that are likely
 * to cause traffic impacts.
 *
 * @param {string} city - City name
 * @param {string} state - State code
 * @param {Date} date - Target date
 * @returns {Promise<Array>}
 */
export async function getTrafficImpactingEvents(city, state, date = new Date()) {
  const dateStr = date.toISOString().split('T')[0];

  try {
    const events = await db.select({
      title: discovered_events.title,
      venue: discovered_events.venue_name,
      start: discovered_events.event_start_time,
      attendance: discovered_events.expected_attendance,
      address: discovered_events.address,
      lat: discovered_events.lat,
      lng: discovered_events.lng
    })
    .from(discovered_events)
    .where(and(
      eq(discovered_events.city, city),
      eq(discovered_events.state, state),
      eq(discovered_events.event_start_date, dateStr),
      eq(discovered_events.is_active, true),
      gte(discovered_events.expected_attendance, 500) // Large events only
    ))
    .orderBy(desc(discovered_events.expected_attendance))
    .limit(5);

    return events;
  } catch (error) {
    console.error('[context-loader] Error loading traffic-impacting events:', error);
    return [];
  }
}
