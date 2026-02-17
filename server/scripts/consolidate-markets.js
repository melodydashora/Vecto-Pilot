#!/usr/bin/env node
// server/scripts/consolidate-markets.js
// ============================================================================
// MARKET TABLE CONSOLIDATION MIGRATION
// ============================================================================
//
// 2026-02-17: Created as part of "One Source of Truth" market consolidation.
//
// What this script does:
//   1. Fixes duplicate markets (e.g., dfw vs dallas-tx)
//   2. Adds schema columns (state_abbr on markets, market_slug + country_code on us_market_cities)
//   3. Creates ~258 missing market entries for unmatched Uber market names
//   4. Updates existing market names to Uber canonical naming
//   5. Links all us_market_cities rows to markets via market_slug FK
//   6. Fixes bad timezones from cross-country name collisions
//   7. Re-runs timezone backfill via FK join
//   8. Renames table us_market_cities → market_cities with FK constraint
//
// Usage: node server/scripts/consolidate-markets.js
// ============================================================================

import { db } from '../db/drizzle.js';
import { sql } from 'drizzle-orm';

// ============================================================================
// STATE → TIMEZONE MAPPING (for new market entries)
// ============================================================================
const STATE_TIMEZONES = {
  'AL': 'America/Chicago', 'AK': 'America/Anchorage', 'AZ': 'America/Phoenix',
  'AR': 'America/Chicago', 'CA': 'America/Los_Angeles', 'CO': 'America/Denver',
  'CT': 'America/New_York', 'DE': 'America/New_York', 'FL': 'America/New_York',
  'GA': 'America/New_York', 'HI': 'Pacific/Honolulu', 'ID': 'America/Boise',
  'IL': 'America/Chicago', 'IN': 'America/Indiana/Indianapolis',
  'IA': 'America/Chicago', 'KS': 'America/Chicago', 'KY': 'America/Kentucky/Louisville',
  'LA': 'America/Chicago', 'ME': 'America/New_York', 'MD': 'America/New_York',
  'MA': 'America/New_York', 'MI': 'America/Detroit', 'MN': 'America/Chicago',
  'MS': 'America/Chicago', 'MO': 'America/Chicago', 'MT': 'America/Denver',
  'NE': 'America/Chicago', 'NV': 'America/Los_Angeles', 'NH': 'America/New_York',
  'NJ': 'America/New_York', 'NM': 'America/Denver', 'NY': 'America/New_York',
  'NC': 'America/New_York', 'ND': 'America/Chicago', 'OH': 'America/New_York',
  'OK': 'America/Chicago', 'OR': 'America/Los_Angeles', 'PA': 'America/New_York',
  'RI': 'America/New_York', 'SC': 'America/New_York', 'SD': 'America/Chicago',
  'TN': 'America/Chicago', 'TX': 'America/Chicago', 'UT': 'America/Denver',
  'VT': 'America/New_York', 'VA': 'America/New_York', 'WA': 'America/Los_Angeles',
  'WV': 'America/New_York', 'WI': 'America/Chicago', 'WY': 'America/Denver',
  'DC': 'America/New_York', 'PR': 'America/Puerto_Rico',
};

// STATE ABBREVIATION → FULL NAME mapping
const STATE_NAMES = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
  'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
  'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
  'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
  'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
  'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
  'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
  'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
  'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
  'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
  'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
  'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
  'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'District of Columbia', 'PR': 'Puerto Rico',
};

// FULL NAME → ABBREVIATION (reverse lookup)
const STATE_ABBRS = {};
for (const [abbr, name] of Object.entries(STATE_NAMES)) {
  STATE_ABBRS[name] = abbr;
  STATE_ABBRS[name.toLowerCase()] = abbr;
}
// Also map abbreviations to themselves
for (const abbr of Object.keys(STATE_NAMES)) {
  STATE_ABBRS[abbr] = abbr;
}

function slugify(name, stateAbbr) {
  const base = name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return stateAbbr ? `${base}-${stateAbbr.toLowerCase()}` : base;
}

function getStateAbbr(state) {
  if (!state) return null;
  if (state.length <= 3) return state.toUpperCase();
  return STATE_ABBRS[state] || STATE_ABBRS[state.toLowerCase()] || state;
}

// ============================================================================
// STEP 1: Fix Duplicates
// ============================================================================
async function step1_fixDuplicates() {
  console.log('\n=== Step 1: Fix Duplicate Markets ===');

  // Find duplicates by primary_city
  const dupes = await db.execute(sql`
    SELECT primary_city, array_agg(market_slug) as slugs, COUNT(*) as cnt
    FROM markets WHERE is_active = true
    GROUP BY primary_city HAVING COUNT(*) > 1
  `);

  if (dupes.rows.length === 0) {
    console.log('  No duplicates found.');
    return;
  }

  for (const row of dupes.rows) {
    console.log(`  Duplicate: "${row.primary_city}" → ${row.slugs}`);
    const slugs = row.slugs;

    // Keep the first slug (usually the one with more data), deactivate others
    const keepSlug = slugs[0];
    const removeSlug = slugs[1];

    console.log(`    Keeping: ${keepSlug}, deactivating: ${removeSlug}`);

    // Move FK references
    const tables = [
      'market_intelligence', 'venue_catalog', 'zone_intelligence',
      'user_intel_notes', 'coach_conversations', 'staging_saturation'
    ];

    for (const table of tables) {
      try {
        const result = await db.execute(sql.raw(
          `UPDATE ${table} SET market_slug = '${keepSlug}' WHERE market_slug = '${removeSlug}'`
        ));
        if (result.rowCount > 0) {
          console.log(`    Moved ${result.rowCount} rows in ${table}`);
        }
      } catch (_err) {
        // Table may not exist or have the column
      }
    }

    // Merge city_aliases from the duplicate into the keeper
    const [keeper] = (await db.execute(sql.raw(
      `SELECT city_aliases FROM markets WHERE market_slug = '${keepSlug}'`
    ))).rows;
    const [duplicate] = (await db.execute(sql.raw(
      `SELECT city_aliases FROM markets WHERE market_slug = '${removeSlug}'`
    ))).rows;

    if (duplicate?.city_aliases && Array.isArray(duplicate.city_aliases)) {
      const keepAliases = keeper?.city_aliases || [];
      const merged = [...new Set([...keepAliases, ...duplicate.city_aliases])];
      await db.execute(sql.raw(
        `UPDATE markets SET city_aliases = '${JSON.stringify(merged)}'::jsonb WHERE market_slug = '${keepSlug}'`
      ));
      console.log(`    Merged ${duplicate.city_aliases.length} aliases into ${keepSlug}`);
    }

    // Deactivate the duplicate
    await db.execute(sql.raw(
      `UPDATE markets SET is_active = false, updated_at = NOW() WHERE market_slug = '${removeSlug}'`
    ));
    console.log(`    Deactivated ${removeSlug}`);
  }
}

// ============================================================================
// STEP 2: Add Schema Columns
// ============================================================================
async function step2_addColumns() {
  console.log('\n=== Step 2: Add Schema Columns ===');

  // Add state_abbr to markets
  await db.execute(sql`ALTER TABLE markets ADD COLUMN IF NOT EXISTS state_abbr VARCHAR(5)`);
  console.log('  Added markets.state_abbr');

  // Add market_slug FK column to us_market_cities
  await db.execute(sql`ALTER TABLE us_market_cities ADD COLUMN IF NOT EXISTS market_slug TEXT`);
  console.log('  Added us_market_cities.market_slug');

  // Add country_code to us_market_cities
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE us_market_cities ADD COLUMN country_code VARCHAR(2) NOT NULL DEFAULT 'US';
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$
  `);
  console.log('  Added us_market_cities.country_code');

  // Index on market_slug
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_umc_market_slug ON us_market_cities (market_slug)`);
  console.log('  Created index on us_market_cities.market_slug');

  // Populate state_abbr on existing markets
  const marketsRows = await db.execute(sql`SELECT market_slug, state FROM markets WHERE state_abbr IS NULL`);
  let stateAbbrUpdated = 0;
  for (const row of marketsRows.rows) {
    const abbr = getStateAbbr(row.state);
    if (abbr && abbr !== row.state) {
      await db.execute(sql.raw(
        `UPDATE markets SET state_abbr = '${abbr}' WHERE market_slug = '${row.market_slug}'`
      ));
      stateAbbrUpdated++;
    }
  }
  console.log(`  Populated state_abbr on ${stateAbbrUpdated} markets`);
}

// ============================================================================
// STEP 3: Create Missing Market Entries + Update Names
// ============================================================================
async function step3_createAndUpdateMarkets() {
  console.log('\n=== Step 3: Create Missing Markets + Update Names ===');

  // Get all distinct Uber market names
  const uberMarkets = await db.execute(sql`
    SELECT DISTINCT market_name,
      MIN(state_abbr) as state_abbr,
      MIN(state) as state
    FROM us_market_cities
    GROUP BY market_name
    ORDER BY market_name
  `);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const uber of uberMarkets.rows) {
    const { market_name, state_abbr, state } = uber;

    // Try to find matching market by primary_city (exact match, same country)
    const matchResult = await db.execute(sql`
      SELECT market_slug, market_name, state, country_code
      FROM markets
      WHERE primary_city = ${market_name}
        AND country_code = 'US'
        AND is_active = true
      LIMIT 1
    `);

    if (matchResult.rows.length > 0) {
      // Match found — update market_name to Uber canonical if different
      const existing = matchResult.rows[0];
      if (existing.market_name !== market_name) {
        await db.execute(sql`
          UPDATE markets SET market_name = ${market_name}, updated_at = NOW()
          WHERE market_slug = ${existing.market_slug}
        `);
        console.log(`  Updated: "${existing.market_name}" → "${market_name}" (${existing.market_slug})`);
        updated++;
      }
      continue;
    }

    // Try alias match (US only)
    const aliasResult = await db.execute(sql`
      SELECT market_slug, market_name
      FROM markets
      WHERE city_aliases @> ${JSON.stringify([market_name])}::jsonb
        AND country_code = 'US'
        AND is_active = true
      LIMIT 1
    `);

    if (aliasResult.rows.length > 0) {
      // Found via alias — don't update the market_name (the alias market covers this city)
      // But we'll link in Step 4
      continue;
    }

    // No match — create a new market entry
    const abbr = state_abbr || getStateAbbr(state);
    const timezone = STATE_TIMEZONES[abbr] || 'America/New_York';
    const slug = slugify(market_name, abbr);
    const fullState = STATE_NAMES[abbr] || state;

    // Find the Core city for this market
    const coreCity = await db.execute(sql`
      SELECT city FROM us_market_cities
      WHERE market_name = ${market_name} AND region_type = 'Core'
      LIMIT 1
    `);
    const primaryCity = coreCity.rows.length > 0 ? coreCity.rows[0].city : market_name.split('-')[0].split(' (')[0].trim();

    // Check slug uniqueness
    const slugExists = await db.execute(sql`SELECT 1 FROM markets WHERE market_slug = ${slug}`);
    if (slugExists.rows.length > 0) {
      console.log(`  Skipped: "${market_name}" — slug "${slug}" already exists`);
      skipped++;
      continue;
    }

    await db.execute(sql`
      INSERT INTO markets (market_slug, market_name, primary_city, state, state_abbr, country_code, timezone, has_uber, has_lyft, is_active)
      VALUES (${slug}, ${market_name}, ${primaryCity}, ${fullState}, ${abbr}, 'US', ${timezone}, true, true, true)
    `);
    console.log(`  Created: "${market_name}" → ${slug} (${timezone})`);
    created++;
  }

  console.log(`\nMarkets: ${created} created, ${updated} updated, ${skipped} skipped`);
}

// ============================================================================
// STEP 4: Link Cities to Markets via market_slug
// ============================================================================
async function step4_linkCities() {
  console.log('\n=== Step 4: Link Cities to Markets via market_slug ===');

  // Strategy 1: Direct market_name match (covers most cases after Step 3)
  // 2026-02-17: FIX - Added country_code = 'US' to prevent cross-country collisions
  // (e.g., "Birmingham" in AL matching "Birmingham" in UK without this filter)
  const directResult = await db.execute(sql`
    UPDATE us_market_cities umc
    SET market_slug = m.market_slug
    FROM markets m
    WHERE m.market_name = umc.market_name
      AND m.country_code = 'US'
      AND m.is_active = true
      AND umc.market_slug IS NULL
  `);
  console.log(`  Direct name match: ${directResult.rowCount} linked`);

  // Strategy 2: primary_city match (for markets where name wasn't updated)
  const primaryResult = await db.execute(sql`
    UPDATE us_market_cities umc
    SET market_slug = m.market_slug
    FROM markets m
    WHERE m.primary_city = umc.market_name
      AND m.country_code = 'US'
      AND m.is_active = true
      AND umc.market_slug IS NULL
  `);
  console.log(`  Primary city match: ${primaryResult.rowCount} linked`);

  // Strategy 3: Alias match
  const aliasResult = await db.execute(sql`
    UPDATE us_market_cities umc
    SET market_slug = sub.market_slug
    FROM (
      SELECT DISTINCT ON (umc2.market_name) umc2.market_name, m.market_slug
      FROM us_market_cities umc2
      JOIN markets m ON m.city_aliases @> to_jsonb(umc2.market_name) AND m.country_code = 'US' AND m.is_active = true
      WHERE umc2.market_slug IS NULL
    ) sub
    WHERE umc.market_name = sub.market_name
      AND umc.market_slug IS NULL
  `);
  console.log(`  Alias match: ${aliasResult.rowCount} linked`);

  // Check for orphans
  const orphans = await db.execute(sql`
    SELECT DISTINCT market_name, COUNT(*) as cnt
    FROM us_market_cities
    WHERE market_slug IS NULL
    GROUP BY market_name
    ORDER BY cnt DESC
  `);

  if (orphans.rows.length > 0) {
    console.log(`\n  WARNING: ${orphans.rows.length} market names still unlinked:`);
    for (const o of orphans.rows) {
      console.log(`    "${o.market_name}" (${o.cnt} cities)`);
    }
  } else {
    console.log('  All cities linked successfully!');
  }
}

// ============================================================================
// STEP 5: Fix Bad Timezones from Cross-Country Collisions
// ============================================================================
async function step5_fixBadTimezones() {
  console.log('\n=== Step 5: Fix Bad Timezones (Cross-Country Collisions) ===');

  // Fix US cities that got international timezones
  const badTz = await db.execute(sql`
    SELECT market_name, state_abbr, timezone, COUNT(*) as cnt
    FROM us_market_cities
    WHERE timezone IS NOT NULL
      AND timezone NOT LIKE 'America/%'
      AND timezone NOT LIKE 'Pacific/%'
      AND timezone NOT LIKE 'US/%'
    GROUP BY market_name, state_abbr, timezone
    ORDER BY cnt DESC
  `);

  let fixed = 0;
  for (const row of badTz.rows) {
    const correctTz = STATE_TIMEZONES[row.state_abbr];
    if (correctTz) {
      const result = await db.execute(sql`
        UPDATE us_market_cities
        SET timezone = ${correctTz}, updated_at = NOW()
        WHERE market_name = ${row.market_name} AND timezone = ${row.timezone}
      `);
      console.log(`  Fixed: ${row.market_name} (${row.state_abbr}): ${row.timezone} → ${correctTz} (${result.rowCount} cities)`);
      fixed += result.rowCount;
    }
  }

  // Also fix US cities with wrong American timezones (Beaumont TX → Edmonton, etc.)
  const wrongAmerican = await db.execute(sql`
    SELECT umc.market_name, umc.state_abbr, umc.timezone, COUNT(*) as cnt
    FROM us_market_cities umc
    JOIN markets m ON umc.market_slug = m.market_slug
    WHERE umc.timezone IS NOT NULL
      AND umc.timezone != m.timezone
    GROUP BY umc.market_name, umc.state_abbr, umc.timezone
    ORDER BY cnt DESC
  `);

  for (const row of wrongAmerican.rows) {
    // Get correct timezone from the linked market
    const correct = await db.execute(sql`
      SELECT m.timezone FROM us_market_cities umc
      JOIN markets m ON umc.market_slug = m.market_slug
      WHERE umc.market_name = ${row.market_name}
      LIMIT 1
    `);
    if (correct.rows.length > 0) {
      const correctTz = correct.rows[0].timezone;
      const result = await db.execute(sql`
        UPDATE us_market_cities
        SET timezone = ${correctTz}, updated_at = NOW()
        WHERE market_name = ${row.market_name} AND timezone = ${row.timezone}
      `);
      console.log(`  Fixed: ${row.market_name} (${row.state_abbr}): ${row.timezone} → ${correctTz} (${result.rowCount} cities)`);
      fixed += result.rowCount;
    }
  }

  console.log(`Total timezone fixes: ${fixed} cities`);
}

// ============================================================================
// STEP 6: Timezone Backfill via FK Join
// ============================================================================
async function step6_timezoneBackfill() {
  console.log('\n=== Step 6: Timezone Backfill via FK Join ===');

  const result = await db.execute(sql`
    UPDATE us_market_cities umc
    SET timezone = m.timezone, updated_at = NOW()
    FROM markets m
    WHERE umc.market_slug = m.market_slug
      AND (umc.timezone IS NULL OR umc.timezone != m.timezone)
  `);
  console.log(`  Updated ${result.rowCount} cities with correct timezone from linked market`);

  // Check coverage
  const missing = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM us_market_cities WHERE timezone IS NULL
  `);
  console.log(`  Cities still missing timezone: ${missing.rows[0].cnt}`);
}

// ============================================================================
// STEP 7: Rename Table + Add FK Constraint
// ============================================================================
async function step7_renameAndConstrain() {
  console.log('\n=== Step 7: Rename Table + Add FK Constraint ===');

  // Check for any NULL market_slug before making NOT NULL
  const nullSlugs = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM us_market_cities WHERE market_slug IS NULL
  `);

  if (parseInt(nullSlugs.rows[0].cnt) > 0) {
    console.log(`  ERROR: ${nullSlugs.rows[0].cnt} cities still have NULL market_slug. Cannot rename table yet.`);
    console.log('  Fix orphans first, then re-run this step.');
    return false;
  }

  // Rename table
  await db.execute(sql`ALTER TABLE us_market_cities RENAME TO market_cities`);
  console.log('  Renamed: us_market_cities → market_cities');

  // Make market_slug NOT NULL
  await db.execute(sql`ALTER TABLE market_cities ALTER COLUMN market_slug SET NOT NULL`);
  console.log('  Set market_slug NOT NULL');

  // Add FK constraint
  try {
    await db.execute(sql`
      ALTER TABLE market_cities
      ADD CONSTRAINT fk_market_cities_market_slug
      FOREIGN KEY (market_slug) REFERENCES markets(market_slug)
    `);
    console.log('  Added FK constraint: market_cities.market_slug → markets.market_slug');
  } catch (err) {
    if (err.message.includes('already exists')) {
      console.log('  FK constraint already exists');
    } else {
      throw err;
    }
  }

  // Update unique index for international support
  try {
    await db.execute(sql`DROP INDEX IF EXISTS idx_us_market_cities_state_city`);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_market_cities_country_city_state
      ON market_cities (country_code, state, city)
    `);
    console.log('  Updated unique index: (country_code, state, city)');
  } catch (err) {
    console.log(`  Index update: ${err.message}`);
  }

  // Create additional indexes with new names
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_market_cities_market_slug ON market_cities (market_slug)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_market_cities_market_name ON market_cities (market_name)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_market_cities_region_type ON market_cities (region_type)`);
  console.log('  Created new indexes');

  return true;
}

// ============================================================================
// VERIFICATION
// ============================================================================
async function verify() {
  console.log('\n=== VERIFICATION ===');

  // Use market_cities (the renamed table)
  const tableName = 'market_cities';

  // 1. Zero orphans
  const orphans = await db.execute(sql.raw(
    `SELECT COUNT(*) as cnt FROM ${tableName} WHERE market_slug IS NULL`
  ));
  const orphanCount = parseInt(orphans.rows[0].cnt);
  console.log(`  ${orphanCount === 0 ? '✅' : '❌'} Orphan cities (NULL market_slug): ${orphanCount}`);

  // 2. Zero active duplicates
  const dupes = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM (
      SELECT primary_city FROM markets WHERE is_active = true
      GROUP BY primary_city HAVING COUNT(*) > 1
    ) d
  `);
  const dupeCount = parseInt(dupes.rows[0].cnt);
  console.log(`  ${dupeCount === 0 ? '✅' : '❌'} Duplicate active markets: ${dupeCount}`);

  // 3. Timezone coverage
  const noTz = await db.execute(sql.raw(
    `SELECT COUNT(*) as cnt FROM ${tableName} WHERE timezone IS NULL`
  ));
  const noTzCount = parseInt(noTz.rows[0].cnt);
  console.log(`  ${noTzCount === 0 ? '✅' : '⚠️'} Cities without timezone: ${noTzCount}`);

  // 4. FK integrity
  const fkBroken = await db.execute(sql.raw(
    `SELECT COUNT(*) as cnt FROM ${tableName} mc
     LEFT JOIN markets m ON mc.market_slug = m.market_slug
     WHERE m.market_slug IS NULL`
  ));
  const fkCount = parseInt(fkBroken.rows[0].cnt);
  console.log(`  ${fkCount === 0 ? '✅' : '❌'} FK integrity violations: ${fkCount}`);

  // 5. No wrong international timezones on US cities
  const badTz = await db.execute(sql.raw(
    `SELECT COUNT(*) as cnt FROM ${tableName}
     WHERE country_code = 'US'
       AND timezone NOT LIKE 'America/%'
       AND timezone NOT LIKE 'Pacific/%'`
  ));
  const badTzCount = parseInt(badTz.rows[0].cnt);
  console.log(`  ${badTzCount === 0 ? '✅' : '❌'} US cities with non-American timezone: ${badTzCount}`);

  // 6. Total counts
  const totalMarkets = await db.execute(sql`SELECT COUNT(*) as cnt FROM markets WHERE is_active = true`);
  const totalCities = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM ${tableName}`));
  console.log(`  Total active markets: ${totalMarkets.rows[0].cnt}`);
  console.log(`  Total cities: ${totalCities.rows[0].cnt}`);

  // 7. DFW spot check
  const dfw = await db.execute(sql.raw(
    `SELECT mc.market_name, mc.market_slug, mc.timezone, COUNT(*) as cnt
     FROM ${tableName} mc
     WHERE mc.market_name = 'Dallas-Fort Worth'
     GROUP BY mc.market_name, mc.market_slug, mc.timezone`
  ));
  if (dfw.rows.length > 0) {
    const r = dfw.rows[0];
    const ok = r.market_slug === 'dfw' && r.timezone === 'America/Chicago';
    console.log(`  ${ok ? '✅' : '❌'} DFW: ${r.cnt} cities → slug=${r.market_slug}, tz=${r.timezone}`);
  }
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  console.log('🏗️  MARKET TABLE CONSOLIDATION');
  console.log('One source of truth: markets + market_cities (renamed from us_market_cities)');
  console.log('========================================');

  try {
    await step1_fixDuplicates();
    await step2_addColumns();
    await step3_createAndUpdateMarkets();
    await step4_linkCities();
    await step5_fixBadTimezones();
    await step6_timezoneBackfill();
    const renamed = await step7_renameAndConstrain();

    if (renamed) {
      await verify();
    }

    console.log('\n========================================');
    console.log('✅ Market consolidation complete!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Migration failed:', err);
    process.exit(1);
  }
}

main();
