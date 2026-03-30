#!/usr/bin/env node
// server/scripts/backfill-timezone.js
// ============================================================================
// ONE-TIME MIGRATION: Backfill timezone on market_cities, venue_catalog,
// and driver_profiles from the markets table (source of truth).
//
// 2026-02-17: Created as part of "Timezone as Market-Level Data" initiative.
//
// Usage: node server/scripts/backfill-timezone.js
// ============================================================================

import { db } from '../db/drizzle.js';
// 2026-02-17: Renamed market_cities → market_cities (market consolidation)
import { market_cities, venue_catalog, markets, driver_profiles } from '../../shared/schema.js';
import { sql, eq, isNull, isNotNull, and } from 'drizzle-orm';

async function backfillUsMarketCities() {
  console.log('\n=== Step 1: Backfill market_cities.timezone ===');

  // Get all distinct market_name values from market_cities
  const distinctMarkets = await db
    .selectDistinct({ market_name: market_cities.market_name })
    .from(market_cities)
    .where(isNull(market_cities.timezone));

  console.log(`Found ${distinctMarkets.length} markets without timezone in market_cities`);

  let updated = 0;
  let skipped = 0;

  for (const { market_name } of distinctMarkets) {
    // Find matching market by primary_city or city_aliases
    // market_cities.market_name stores the Uber market anchor (e.g., "Dallas", "Houston")
    // markets.primary_city stores the main city (e.g., "Dallas", "Houston")
    const market = await db.query.markets.findFirst({
      where: (m, { eq, and }) => and(
        eq(m.primary_city, market_name),
        eq(m.is_active, true)
      ),
    });

    if (market) {
      const result = await db.update(market_cities)
        .set({ timezone: market.timezone, updated_at: new Date() })
        .where(and(
          eq(market_cities.market_name, market_name),
          isNull(market_cities.timezone)
        ));

      const count = result.rowCount || 0;
      updated += count;
      console.log(`  ✅ ${market_name} → ${market.timezone} (${count} cities)`);
    } else {
      // Try alias matching
      const aliasMarket = await db
        .select({ timezone: markets.timezone, market_name: markets.market_name })
        .from(markets)
        .where(sql`${markets.city_aliases} @> ${JSON.stringify([market_name])}::jsonb AND ${markets.is_active} = true`)
        .limit(1);

      if (aliasMarket.length > 0) {
        const result = await db.update(market_cities)
          .set({ timezone: aliasMarket[0].timezone, updated_at: new Date() })
          .where(and(
            eq(market_cities.market_name, market_name),
            isNull(market_cities.timezone)
          ));

        const count = result.rowCount || 0;
        updated += count;
        console.log(`  ✅ ${market_name} → ${aliasMarket[0].timezone} (${count} cities, via alias)`);
      } else {
        skipped++;
        console.log(`  ⚠️ ${market_name} — no matching market found`);
      }
    }
  }

  console.log(`market_cities: ${updated} updated, ${skipped} skipped`);
}

async function backfillVenueCatalog() {
  console.log('\n=== Step 2: Backfill venue_catalog.timezone ===');

  // Get venues without timezone that have city + state
  const venues = await db
    .select({
      venue_id: venue_catalog.venue_id,
      city: venue_catalog.city,
      state: venue_catalog.state
    })
    .from(venue_catalog)
    .where(and(
      isNull(venue_catalog.timezone),
      isNotNull(venue_catalog.city),
      isNotNull(venue_catalog.state)
    ))
    .limit(5000); // Safety limit

  console.log(`Found ${venues.length} venues without timezone`);

  // Group by city+state to minimize market lookups
  const cityStateMap = new Map();
  for (const v of venues) {
    const key = `${v.city}|${v.state}`;
    if (!cityStateMap.has(key)) {
      cityStateMap.set(key, []);
    }
    cityStateMap.get(key).push(v.venue_id);
  }

  let updated = 0;
  let skipped = 0;

  for (const [key, venueIds] of cityStateMap) {
    const [city, state] = key.split('|');

    // Look up market timezone
    const market = await db.query.markets.findFirst({
      where: (m, { eq, and }) => and(
        eq(m.primary_city, city),
        eq(m.is_active, true)
      ),
    });

    let timezone = market?.timezone;
    let marketSlug = market?.market_slug;

    // Try alias if direct match failed
    if (!timezone) {
      const aliasResult = await db
        .select({ timezone: markets.timezone, market_slug: markets.market_slug })
        .from(markets)
        .where(sql`(${markets.city_aliases} @> ${JSON.stringify([city])}::jsonb OR ${markets.primary_city} = ${city}) AND ${markets.state} = ${state} AND ${markets.is_active} = true`)
        .limit(1);

      if (aliasResult.length > 0) {
        timezone = aliasResult[0].timezone;
        marketSlug = aliasResult[0].market_slug;
      }
    }

    if (timezone) {
      // Batch update all venues with this city+state
      for (let i = 0; i < venueIds.length; i += 100) {
        const batch = venueIds.slice(i, i + 100);
        for (const vid of batch) {
          await db.update(venue_catalog)
            .set({
              timezone,
              market_slug: marketSlug || venue_catalog.market_slug,
              updated_at: new Date()
            })
            .where(eq(venue_catalog.venue_id, vid));
        }
      }
      updated += venueIds.length;
      console.log(`  ✅ ${city}, ${state} → ${timezone} (${venueIds.length} venues)`);
    } else {
      skipped += venueIds.length;
      console.log(`  ⚠️ ${city}, ${state} — no market match (${venueIds.length} venues)`);
    }
  }

  console.log(`venue_catalog: ${updated} updated, ${skipped} skipped`);
}

async function backfillDriverProfiles() {
  console.log('\n=== Step 3: Backfill driver_profiles.home_timezone ===');

  // Get profiles with market but no home_timezone
  const profiles = await db
    .select({
      user_id: driver_profiles.user_id,
      market: driver_profiles.market
    })
    .from(driver_profiles)
    .where(and(
      isNull(driver_profiles.home_timezone),
      isNotNull(driver_profiles.market)
    ))
    .limit(1000);

  console.log(`Found ${profiles.length} profiles without home_timezone`);

  let updated = 0;

  // Group by market to minimize lookups
  const marketMap = new Map();
  for (const p of profiles) {
    if (!marketMap.has(p.market)) {
      marketMap.set(p.market, []);
    }
    marketMap.get(p.market).push(p.user_id);
  }

  for (const [marketName, userIds] of marketMap) {
    const market = await db.query.markets.findFirst({
      where: (m, { eq, and }) => and(
        eq(m.primary_city, marketName),
        eq(m.is_active, true)
      ),
    });

    if (market?.timezone) {
      for (const uid of userIds) {
        await db.update(driver_profiles)
          .set({ home_timezone: market.timezone, updated_at: new Date() })
          .where(eq(driver_profiles.user_id, uid));
      }
      updated += userIds.length;
      console.log(`  ✅ Market "${marketName}" → ${market.timezone} (${userIds.length} profiles)`);
    }
  }

  console.log(`driver_profiles: ${updated} updated`);
}

async function main() {
  console.log('🕐 TIMEZONE BACKFILL SCRIPT');
  console.log('Source of truth: markets.timezone');
  console.log('========================================');

  try {
    await backfillUsMarketCities();
    await backfillVenueCatalog();
    await backfillDriverProfiles();

    console.log('\n========================================');
    console.log('✅ Backfill complete!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Backfill failed:', err);
    process.exit(1);
  }
}

main();
