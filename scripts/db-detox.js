#!/usr/bin/env node
/**
 * Database Detox Script
 *
 * Cleans up zombie rows, bloat columns, and duplicates to prepare the database
 * for the new data pipeline. Safe operations with DRY_RUN mode.
 *
 * Usage:
 *   node scripts/db-detox.js              # Dry run (no changes)
 *   node scripts/db-detox.js --execute    # Actually perform cleanup
 *   node scripts/db-detox.js --analyze    # Only analyze, show stats
 *
 * @date 2026-01-09
 */

import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

// Configuration
const DRY_RUN = !process.argv.includes('--execute');
const ANALYZE_ONLY = process.argv.includes('--analyze');

// Connect to database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

// Logging helpers
const log = {
  header: (msg) => console.log(`\n${'═'.repeat(60)}\n${msg}\n${'═'.repeat(60)}`),
  section: (msg) => console.log(`\n${'─'.repeat(50)}\n${msg}\n${'─'.repeat(50)}`),
  info: (msg) => console.log(`  ℹ️  ${msg}`),
  success: (msg) => console.log(`  ✅ ${msg}`),
  warning: (msg) => console.log(`  ⚠️  ${msg}`),
  error: (msg) => console.error(`  ❌ ${msg}`),
  stat: (label, value) => console.log(`  📊 ${label}: ${value}`),
  affected: (count, type) => console.log(`  🗑️  ${count} ${type} ${DRY_RUN ? 'would be' : 'were'} affected`),
};

/**
 * Execute a query with dry-run protection
 */
async function execute(sql, params = [], description = '') {
  if (ANALYZE_ONLY) {
    log.info(`[ANALYZE] ${description}: Query prepared but not counted`);
    return { rowCount: 0 };
  }

  if (DRY_RUN) {
    // For dry run, convert DELETE/UPDATE to SELECT COUNT(*)
    const countSql = sql
      .replace(/^DELETE FROM/i, 'SELECT COUNT(*) as count FROM')
      .replace(/^UPDATE\s+(\S+)\s+SET[^WHERE]+WHERE/i, 'SELECT COUNT(*) as count FROM $1 WHERE');

    try {
      const result = await pool.query(countSql, params);
      const count = result.rows[0]?.count || 0;
      log.info(`[DRY RUN] ${description}: ${count} rows would be affected`);
      return { rowCount: parseInt(count) };
    } catch (err) {
      // If count query fails, just log the original query
      log.warning(`[DRY RUN] ${description}: Could not estimate (${err.message})`);
      return { rowCount: 0 };
    }
  }

  const result = await pool.query(sql, params);
  log.success(`${description}: ${result.rowCount} rows affected`);
  return result;
}

/**
 * Analyze database state before cleanup
 */
async function analyzeDatabase() {
  log.header('DATABASE ANALYSIS');

  // Table sizes
  log.section('Table Sizes');
  const sizeQuery = `
    SELECT
      tablename as table_name,
      pg_size_pretty(pg_total_relation_size(quote_ident(tablename))) as total_size,
      pg_total_relation_size(quote_ident(tablename)) as size_bytes
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY pg_total_relation_size(quote_ident(tablename)) DESC
    LIMIT 15;
  `;
  const sizes = await pool.query(sizeQuery);
  for (const row of sizes.rows) {
    log.stat(row.table_name, row.total_size);
  }

  // Row counts for key tables
  log.section('Row Counts');
  const tables = ['discovered_events', 'briefings', 'venue_catalog', 'strategies', 'snapshots'];
  for (const table of tables) {
    try {
      const result = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
      log.stat(table, result.rows[0].count);
    } catch (e) {
      log.warning(`${table}: Could not count (${e.message})`);
    }
  }

  // Zombie analysis for discovered_events
  log.section('Discovered Events - Zombie Analysis');

  const zombieQueries = [
    {
      label: 'Events with TBD/Unknown in title',
      sql: `SELECT COUNT(*) as count FROM discovered_events WHERE title ILIKE '%tbd%' OR title ILIKE '%unknown%'`
    },
    {
      label: 'Events with TBD/Unknown in venue_name',
      sql: `SELECT COUNT(*) as count FROM discovered_events WHERE venue_name ILIKE '%tbd%' OR venue_name ILIKE '%unknown%' OR venue_name ILIKE '%venue tbd%'`
    },
    {
      label: 'Events with NULL venue_name',
      sql: `SELECT COUNT(*) as count FROM discovered_events WHERE venue_name IS NULL`
    },
    {
      label: 'Events with NULL event_time',
      sql: `SELECT COUNT(*) as count FROM discovered_events WHERE event_time IS NULL OR event_time = ''`
    },
    {
      label: 'Past events (event_date < today)',
      sql: `SELECT COUNT(*) as count FROM discovered_events WHERE event_date < CURRENT_DATE::text`
    },
    {
      label: 'Inactive events (is_active = false)',
      sql: `SELECT COUNT(*) as count FROM discovered_events WHERE is_active = false`
    },
    {
      label: 'Events with raw_source_data (bloat)',
      sql: `SELECT COUNT(*) as count FROM discovered_events WHERE raw_source_data IS NOT NULL`
    },
  ];

  for (const q of zombieQueries) {
    const result = await pool.query(q.sql);
    log.stat(q.label, result.rows[0].count);
  }

  // Briefings analysis
  log.section('Briefings - Staleness Analysis');

  const briefingQueries = [
    {
      label: 'Briefings older than 24 hours',
      sql: `SELECT COUNT(*) as count FROM briefings WHERE created_at < NOW() - INTERVAL '24 HOURS'`
    },
    {
      label: 'Briefings older than 48 hours',
      sql: `SELECT COUNT(*) as count FROM briefings WHERE created_at < NOW() - INTERVAL '48 HOURS'`
    },
    {
      label: 'Briefings with NULL events',
      sql: `SELECT COUNT(*) as count FROM briefings WHERE events IS NULL`
    },
    {
      label: 'Briefings with empty events array',
      sql: `SELECT COUNT(*) as count FROM briefings WHERE events = '[]'::jsonb OR events = 'null'::jsonb`
    },
  ];

  for (const q of briefingQueries) {
    const result = await pool.query(q.sql);
    log.stat(q.label, result.rows[0].count);
  }

  // Venue catalog analysis
  log.section('Venue Catalog - Quality Analysis');

  const venueQueries = [
    {
      label: 'Venues with NULL venue_name',
      sql: `SELECT COUNT(*) as count FROM venue_catalog WHERE venue_name IS NULL OR venue_name = ''`
    },
    {
      label: 'Permanently closed venues',
      sql: `SELECT COUNT(*) as count FROM venue_catalog WHERE last_known_status = 'permanently_closed'`
    },
    {
      label: 'Auto-suppressed venues',
      sql: `SELECT COUNT(*) as count FROM venue_catalog WHERE auto_suppressed = true`
    },
    {
      label: 'Venues without coordinates',
      sql: `SELECT COUNT(*) as count FROM venue_catalog WHERE lat IS NULL OR lng IS NULL`
    },
  ];

  for (const q of venueQueries) {
    const result = await pool.query(q.sql);
    log.stat(q.label, result.rows[0].count);
  }

  // Strategies analysis
  log.section('Strategies - Status Analysis');

  const strategyQueries = [
    {
      label: 'Failed strategies',
      sql: `SELECT COUNT(*) as count FROM strategies WHERE status = 'failed'`
    },
    {
      label: 'Strategies older than 48 hours',
      sql: `SELECT COUNT(*) as count FROM strategies WHERE created_at < NOW() - INTERVAL '48 HOURS'`
    },
    {
      label: 'Strategies with NULL strategy_for_now',
      sql: `SELECT COUNT(*) as count FROM strategies WHERE strategy_for_now IS NULL`
    },
  ];

  for (const q of strategyQueries) {
    const result = await pool.query(q.sql);
    log.stat(q.label, result.rows[0].count);
  }

  // Bloat analysis - estimate raw_source_data size
  log.section('Bloat Analysis');
  try {
    const bloatQuery = `
      SELECT
        COUNT(*) as rows_with_data,
        pg_size_pretty(SUM(pg_column_size(raw_source_data))) as total_size
      FROM discovered_events
      WHERE raw_source_data IS NOT NULL
    `;
    const bloatResult = await pool.query(bloatQuery);
    log.stat('raw_source_data column size', bloatResult.rows[0].total_size || 'N/A');
    log.stat('rows with raw_source_data', bloatResult.rows[0].rows_with_data);
  } catch (e) {
    log.warning(`Could not analyze bloat: ${e.message}`);
  }
}

/**
 * Phase 1: Purge zombie rows from discovered_events
 */
async function purgeDiscoveredEventsZombies() {
  log.section('Phase 1: Purge Discovered Events Zombies');

  let totalAffected = 0;

  // 1a. Delete events with TBD/Unknown in critical fields
  const tbdResult = await execute(
    `DELETE FROM discovered_events
     WHERE title ILIKE '%tbd%'
        OR title ILIKE '%unknown%'
        OR venue_name ILIKE '%tbd%'
        OR venue_name ILIKE '%unknown%'
        OR venue_name ILIKE '%venue tbd%'
        OR venue_name ILIKE '%location tbd%'
        OR event_time ILIKE '%tbd%'`,
    [],
    'Remove TBD/Unknown events'
  );
  totalAffected += tbdResult.rowCount;

  // 1b. Delete events with NULL venue_name (can't geolocate)
  const nullVenueResult = await execute(
    `DELETE FROM discovered_events WHERE venue_name IS NULL OR venue_name = ''`,
    [],
    'Remove events with NULL/empty venue_name'
  );
  totalAffected += nullVenueResult.rowCount;

  // 1c. Delete past events (keep today and future only)
  const pastResult = await execute(
    `DELETE FROM discovered_events WHERE event_date < CURRENT_DATE::text`,
    [],
    'Remove past events'
  );
  totalAffected += pastResult.rowCount;

  // 1d. Delete inactive events older than 7 days
  const inactiveResult = await execute(
    `DELETE FROM discovered_events
     WHERE is_active = false
       AND deactivated_at < NOW() - INTERVAL '7 DAYS'`,
    [],
    'Remove old inactive events'
  );
  totalAffected += inactiveResult.rowCount;

  log.affected(totalAffected, 'discovered_events rows');
  return totalAffected;
}

/**
 * Phase 2: Clear stale briefings
 */
async function purgeStalesBriefings() {
  log.section('Phase 2: Purge Stale Briefings');

  let totalAffected = 0;

  // 2a. Delete briefings older than 24 hours (force fresh fetch)
  // Note: This also cascades cleanup to orphaned snapshots via FK
  const staleResult = await execute(
    `DELETE FROM briefings WHERE created_at < NOW() - INTERVAL '24 HOURS'`,
    [],
    'Remove briefings older than 24 hours'
  );
  totalAffected += staleResult.rowCount;

  // 2b. Delete briefings with completely empty data
  const emptyResult = await execute(
    `DELETE FROM briefings
     WHERE events IS NULL
       AND news IS NULL
       AND traffic_conditions IS NULL`,
    [],
    'Remove completely empty briefings'
  );
  totalAffected += emptyResult.rowCount;

  log.affected(totalAffected, 'briefings rows');
  return totalAffected;
}

/**
 * Phase 3: Clean venue catalog
 */
async function purgeVenueCatalogZombies() {
  log.section('Phase 3: Clean Venue Catalog');

  let totalAffected = 0;

  // 3a. Delete venues without names
  const nullNameResult = await execute(
    `DELETE FROM venue_catalog WHERE venue_name IS NULL OR venue_name = ''`,
    [],
    'Remove venues with NULL/empty name'
  );
  totalAffected += nullNameResult.rowCount;

  // 3b. Delete permanently closed venues
  const closedResult = await execute(
    `DELETE FROM venue_catalog WHERE last_known_status = 'permanently_closed'`,
    [],
    'Remove permanently closed venues'
  );
  totalAffected += closedResult.rowCount;

  log.affected(totalAffected, 'venue_catalog rows');
  return totalAffected;
}

/**
 * Phase 4: Clean failed/stale strategies
 */
async function purgeStaleStrategies() {
  log.section('Phase 4: Clean Stale Strategies');

  let totalAffected = 0;

  // 4a. Delete failed strategies older than 24 hours
  const failedResult = await execute(
    `DELETE FROM strategies
     WHERE status = 'failed'
       AND created_at < NOW() - INTERVAL '24 HOURS'`,
    [],
    'Remove old failed strategies'
  );
  totalAffected += failedResult.rowCount;

  // 4b. Delete strategies older than 48 hours (keep recent for debugging)
  const staleResult = await execute(
    `DELETE FROM strategies WHERE created_at < NOW() - INTERVAL '48 HOURS'`,
    [],
    'Remove strategies older than 48 hours'
  );
  totalAffected += staleResult.rowCount;

  log.affected(totalAffected, 'strategies rows');
  return totalAffected;
}

/**
 * Phase 5: Clear bloat columns (raw_source_data)
 */
async function clearBloatColumns() {
  log.section('Phase 5: Clear Bloat Columns');

  // Set raw_source_data to NULL for all events (we don't need debugging data long-term)
  // This saves significant space while keeping the event rows
  const result = await execute(
    `UPDATE discovered_events SET raw_source_data = NULL WHERE raw_source_data IS NOT NULL`,
    [],
    'Clear raw_source_data (bloat removal)'
  );

  log.affected(result.rowCount, 'rows had raw_source_data cleared');
  return result.rowCount;
}

/**
 * Phase 6: Deduplicate venue_catalog
 * Keeps venues with place_id over those without, and newest if tied
 * 2026-01-09: Must clean up FK references (venue_metrics, ranking_candidates) first
 */
async function deduplicateVenues() {
  log.section('Phase 6: Deduplicate Venue Catalog');

  // First, analyze the duplication
  const dupeAnalysis = await pool.query(`
    SELECT venue_name, city, COUNT(*) as count
    FROM venue_catalog
    GROUP BY venue_name, city
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT 10
  `);

  if (dupeAnalysis.rowCount > 0) {
    log.info(`Top duplicated venues:`);
    for (const row of dupeAnalysis.rows.slice(0, 5)) {
      log.stat(`"${row.venue_name.substring(0, 35)}" (${row.city})`, `${row.count} copies`);
    }
  }

  // Get IDs of duplicates to remove (keeping best one per venue)
  const duplicateIdsQuery = `
    SELECT venue_id FROM (
      SELECT venue_id,
             ROW_NUMBER() OVER (
               PARTITION BY LOWER(TRIM(venue_name)), city
               ORDER BY
                 CASE WHEN place_id IS NOT NULL THEN 0 ELSE 1 END,
                 created_at DESC
             ) as rn
      FROM venue_catalog
    ) ranked
    WHERE rn > 1
  `;

  // Count total removable duplicates
  const countResult = await pool.query(`SELECT COUNT(*) as removable FROM (${duplicateIdsQuery}) AS dupes`);
  const removableCount = parseInt(countResult.rows[0].removable);
  log.stat('Total duplicate venue rows', removableCount);

  if (removableCount === 0) {
    log.info('No venue duplicates found');
    return 0;
  }

  // Step 1: Clean up venue_metrics that reference duplicate venues
  const metricsCleanup = await execute(
    `DELETE FROM venue_metrics WHERE venue_id IN (${duplicateIdsQuery})`,
    [],
    'Clean up venue_metrics for duplicate venues'
  );
  log.affected(metricsCleanup.rowCount, 'venue_metrics rows cleaned');

  // Step 2: Delete duplicate venues, keeping the one with place_id (or newest)
  const dedupeResult = await execute(
    `DELETE FROM venue_catalog WHERE venue_id IN (${duplicateIdsQuery})`,
    [],
    'Remove duplicate venues (keep one with place_id)'
  );

  log.affected(dedupeResult.rowCount, 'duplicate venues removed');
  return dedupeResult.rowCount;
}

/**
 * Phase 7: Deduplicate events
 */
async function purgeEventDuplicatesFromDB() {
  log.section('Phase 7: Purge Duplicate Events from DB');

  // 2026-01-10: Renamed from deduplicateEvents to avoid confusion
  // with briefing-service.js:deduplicateEvents which does in-memory display dedup
  // This function does SQL DELETE to remove duplicate rows by event_hash
  
  // Find duplicate event_hashes and keep only the most recent
  // First, identify duplicates
  const dupeCheckResult = await pool.query(`
    SELECT event_hash, COUNT(*) as dupe_count
    FROM discovered_events
    GROUP BY event_hash
    HAVING COUNT(*) > 1
  `);

  log.stat('Duplicate event_hash groups', dupeCheckResult.rowCount);

  if (dupeCheckResult.rowCount === 0) {
    log.info('No duplicates found');
    return 0;
  }

  // Delete all but the most recently discovered duplicate
  const dedupeResult = await execute(
    `DELETE FROM discovered_events de
     WHERE id NOT IN (
       SELECT DISTINCT ON (event_hash) id
       FROM discovered_events
       ORDER BY event_hash, discovered_at DESC
     )
     AND event_hash IN (
       SELECT event_hash
       FROM discovered_events
       GROUP BY event_hash
       HAVING COUNT(*) > 1
     )`,
    [],
    'Remove duplicate events (keep newest)'
  );

  log.affected(dedupeResult.rowCount, 'duplicate events removed');
  return dedupeResult.rowCount;
}

/**
 * Phase 8: Vacuum and analyze tables
 */
async function vacuumTables() {
  if (DRY_RUN || ANALYZE_ONLY) {
    log.section('Phase 8: VACUUM (skipped in dry-run/analyze mode)');
    log.info('Run with --execute to perform VACUUM ANALYZE');
    return;
  }

  log.section('Phase 8: VACUUM ANALYZE');

  const tables = ['discovered_events', 'briefings', 'venue_catalog', 'strategies', 'snapshots'];

  for (const table of tables) {
    try {
      await pool.query(`VACUUM ANALYZE ${table}`);
      log.success(`Vacuumed ${table}`);
    } catch (e) {
      log.warning(`Could not vacuum ${table}: ${e.message}`);
    }
  }
}

/**
 * Main execution
 */
async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║               DATABASE DETOX SCRIPT                            ║
║                                                                ║
║  Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : ANALYZE_ONLY ? 'ANALYZE ONLY' : 'EXECUTE (making changes!)'}${' '.repeat(30 - (DRY_RUN ? 20 : ANALYZE_ONLY ? 12 : 26))}║
║  Time: ${new Date().toISOString()}                    ║
╚═══════════════════════════════════════════════════════════════╝
  `);

  if (DRY_RUN && !ANALYZE_ONLY) {
    log.warning('DRY RUN MODE - No changes will be made');
    log.info('Run with --execute to actually perform cleanup');
  }

  try {
    // Always analyze first
    await analyzeDatabase();

    if (ANALYZE_ONLY) {
      log.header('ANALYSIS COMPLETE');
      log.info('Run with --execute to perform cleanup');
      return; // pool.end() called in finally block
    }

    log.header('STARTING CLEANUP');

    const stats = {
      discoveredEvents: 0,
      briefings: 0,
      venueCatalogZombies: 0,
      venueCatalogDupes: 0,
      strategies: 0,
      bloat: 0,
      eventDuplicates: 0,
    };

    // Execute cleanup phases
    stats.discoveredEvents = await purgeDiscoveredEventsZombies();
    stats.briefings = await purgeStalesBriefings();
    stats.venueCatalogZombies = await purgeVenueCatalogZombies();
    stats.strategies = await purgeStaleStrategies();
    stats.bloat = await clearBloatColumns();
    stats.venueCatalogDupes = await deduplicateVenues();
    stats.eventDuplicates = await purgeEventDuplicatesFromDB();

    // Vacuum if executing
    await vacuumTables();

    // Summary
    log.header('CLEANUP SUMMARY');
    console.log(`
  ┌───────────────────────────────────────────────────┐
  │ Category                  │ Rows ${DRY_RUN ? 'Would Be ' : ''}Affected │
  ├───────────────────────────────────────────────────┤
  │ discovered_events zombies │ ${String(stats.discoveredEvents).padStart(10)} │
  │ briefings (stale)         │ ${String(stats.briefings).padStart(10)} │
  │ venue_catalog zombies     │ ${String(stats.venueCatalogZombies).padStart(10)} │
  │ venue_catalog DUPLICATES  │ ${String(stats.venueCatalogDupes).padStart(10)} │
  │ strategies (stale)        │ ${String(stats.strategies).padStart(10)} │
  │ bloat columns cleared     │ ${String(stats.bloat).padStart(10)} │
  │ event duplicates          │ ${String(stats.eventDuplicates).padStart(10)} │
  └───────────────────────────────────────────────────┘
    `);

    const totalAffected = Object.values(stats).reduce((a, b) => a + b, 0);

    if (DRY_RUN) {
      log.warning(`Total rows that WOULD be affected: ${totalAffected}`);
      log.info('Run with --execute to actually perform these changes');
    } else {
      log.success(`Total rows affected: ${totalAffected}`);
      log.success('Database detox complete!');
    }

  } catch (error) {
    log.error(`Fatal error: ${error.message}`);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run
main().catch(console.error);
