// server/scripts/link-events.js
// ============================================================================
// EVENT-VENUE LINKING SCRIPT
// ============================================================================
//
// PURPOSE: Links unlinked events in discovered_events to venues in venue_catalog
//
// The Problem:
//   - Events are discovered fine (Gemini search)
//   - Venues exist in venue_catalog
//   - But venue_id is NULL in discovered_events (no link!)
//
// This causes:
//   - Events don't show on map (no coordinates)
//   - Strategies are generic (no precise location)
//   - Venue cards lack "Event Tonight" badges
//
// Usage:
//   node server/scripts/link-events.js
//
// ============================================================================

import { db } from '../db/drizzle.js';
import { discovered_events, venue_catalog } from '../../shared/schema.js';
import { eq, isNull, and, sql } from 'drizzle-orm';
import { normalizeVenueName } from '../lib/venue/venue-utils.js';

async function linkEvents() {
  console.log('🔗 Starting Event-Venue Linking...');
  console.log('');

  // 1. Get unlinked events
  const unlinkedEvents = await db.select()
    .from(discovered_events)
    .where(isNull(discovered_events.venue_id));

  console.log(`📊 Found ${unlinkedEvents.length} unlinked events.`);
  console.log('');

  if (unlinkedEvents.length === 0) {
    console.log('✅ All events are already linked!');
    process.exit(0);
  }

  let linkedCount = 0;
  let noMatchCount = 0;
  let noVenueNameCount = 0;

  for (const event of unlinkedEvents) {
    if (!event.venue_name) {
      noVenueNameCount++;
      continue;
    }

    const normalizedEventVenue = normalizeVenueName(event.venue_name);

    // 2. Try to find matching venue in catalog
    // Strategy 1: Exact normalized name match in same city
    let match = null;

    // First try: exact normalized_name match
    const [exactMatch] = await db.select()
      .from(venue_catalog)
      .where(and(
        eq(venue_catalog.normalized_name, normalizedEventVenue),
        eq(venue_catalog.city, event.city)
      ))
      .limit(1);

    if (exactMatch) {
      match = exactMatch;
    } else {
      // Second try: fuzzy match using LIKE (venue contains event name or vice versa)
      const [fuzzyMatch] = await db.select()
        .from(venue_catalog)
        .where(and(
          sql`(
            ${venue_catalog.normalized_name} LIKE '%' || ${normalizedEventVenue} || '%'
            OR ${normalizedEventVenue} LIKE '%' || ${venue_catalog.normalized_name} || '%'
          )`,
          eq(venue_catalog.city, event.city)
        ))
        .limit(1);

      if (fuzzyMatch) {
        match = fuzzyMatch;
      }
    }

    if (match) {
      // 3. Link them
      await db.update(discovered_events)
        .set({
          venue_id: match.venue_id,
          updated_at: new Date()
        })
        .where(eq(discovered_events.id, event.id));

      console.log(`✅ Linked "${event.title}" → "${match.venue_name}" (${match.city})`);
      linkedCount++;
    } else {
      console.log(`❌ No match for "${event.venue_name}" (${event.city}) - event: "${event.title}"`);
      noMatchCount++;
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`🔗 LINKING COMPLETE`);
  console.log(`   ✅ Linked: ${linkedCount}`);
  console.log(`   ❌ No match: ${noMatchCount}`);
  console.log(`   ⚠️  No venue name: ${noVenueNameCount}`);
  console.log(`   📊 Total processed: ${unlinkedEvents.length}`);
  console.log('═══════════════════════════════════════════════════════');

  process.exit(0);
}

linkEvents().catch(err => {
  console.error('❌ Linking failed:', err);
  process.exit(1);
});
