#!/usr/bin/env node
/**
 * Analyze data flow in the codebase to find which files:
 * - Push (INSERT/UPDATE) data to each table
 * - Fetch (SELECT) data from each table
 *
 * Usage: node scripts/analyze-data-flow.js
 * Output: Creates docs/DATA_FLOW_MAP.json with the analysis
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const OUTPUT_FILE = 'docs/DATA_FLOW_MAP.json';

// Tables from the schema (we'll detect these from imports)
const DRIZZLE_TABLES = [
  'actions', 'agent_changes', 'agent_memory', 'app_feedback', 'assistant_memory',
  'auth_credentials', 'block_jobs', 'briefings', 'coach_conversations',
  'coach_system_notes', 'connection_audit', 'coords_cache', 'countries',
  'cross_thread_memory', 'discovered_events', 'driver_profiles', 'driver_vehicles',
  'eidolon_memory', 'eidolon_snapshots', 'events_facts', 'http_idem',
  'llm_venue_suggestions', 'market_intelligence', 'markets', 'nearby_venues',
  'news_deactivations', 'places_cache', 'platform_data', 'ranking_candidates',
  'rankings', 'snapshots', 'strategies', 'strategy_feedback', 'traffic_zones',
  'travel_disruptions', 'triad_jobs', 'user_intel_notes', 'users',
  'vehicle_makes_cache', 'vehicle_models_cache', 'venue_cache', 'venue_catalog',
  'venue_events', 'venue_feedback', 'venue_metrics', 'verification_codes',
  'zone_intelligence'
];

// Convert snake_case to various patterns used in code
function getTablePatterns(tableName) {
  // snake_case, camelCase variants
  const camel = tableName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  return [tableName, camel];
}

// Search for patterns in codebase
function searchPattern(pattern, fileTypes = '*.js,*.ts,*.tsx,*.mjs') {
  try {
    const cmd = `grep -rn --include="*.js" --include="*.ts" --include="*.tsx" --include="*.mjs" -E "${pattern}" server/ client/src/ shared/ 2>/dev/null || true`;
    const result = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
    return result.trim().split('\n').filter(Boolean);
  } catch (e) {
    return [];
  }
}

// Analyze a table for push/fetch operations
function analyzeTable(tableName) {
  const patterns = getTablePatterns(tableName);
  const pushFiles = new Set();
  const fetchFiles = new Set();

  for (const pattern of patterns) {
    // INSERT patterns (Drizzle)
    const insertPatterns = [
      `db\\.insert\\(${pattern}\\)`,
      `\\.insert\\(${pattern}\\)`,
      `insert\\(${pattern}\\)`,
      `INTO ${tableName}`,
      `into ${tableName}`,
    ];

    // UPDATE patterns (Drizzle)
    const updatePatterns = [
      `db\\.update\\(${pattern}\\)`,
      `\\.update\\(${pattern}\\)`,
      `update\\(${pattern}\\)`,
      `UPDATE ${tableName}`,
    ];

    // SELECT patterns (Drizzle)
    const selectPatterns = [
      `\\.from\\(${pattern}\\)`,
      `from\\(${pattern}\\)`,
      `db\\.select.*${pattern}`,
      `FROM ${tableName}`,
      `from ${tableName}`,
      `${pattern}\\.`,  // table.column access
    ];

    // Search for push operations
    for (const p of [...insertPatterns, ...updatePatterns]) {
      const matches = searchPattern(p);
      for (const match of matches) {
        const file = match.split(':')[0];
        if (file && !file.includes('node_modules') && !file.includes('.test.')) {
          pushFiles.add(relative(ROOT, file));
        }
      }
    }

    // Search for fetch operations
    for (const p of selectPatterns) {
      const matches = searchPattern(p);
      for (const match of matches) {
        const file = match.split(':')[0];
        if (file && !file.includes('node_modules') && !file.includes('.test.')) {
          fetchFiles.add(relative(ROOT, file));
        }
      }
    }
  }

  return {
    push: Array.from(pushFiles).sort(),
    fetch: Array.from(fetchFiles).sort()
  };
}

// Main analysis
console.log('🔍 Analyzing data flow across codebase...\n');

const dataFlow = {};
let totalPush = 0;
let totalFetch = 0;

for (const table of DRIZZLE_TABLES) {
  process.stdout.write(`  Analyzing ${table}...`);
  const result = analyzeTable(table);
  dataFlow[table] = result;
  totalPush += result.push.length;
  totalFetch += result.fetch.length;
  console.log(` push: ${result.push.length}, fetch: ${result.fetch.length}`);
}

// Write JSON output
writeFileSync(OUTPUT_FILE, JSON.stringify(dataFlow, null, 2));
console.log(`\n✅ Analysis complete: ${OUTPUT_FILE}`);
console.log(`   Tables: ${DRIZZLE_TABLES.length}`);
console.log(`   Total push references: ${totalPush}`);
console.log(`   Total fetch references: ${totalFetch}`);
