#!/usr/bin/env node
/**
 * Generate comprehensive database schema documentation in Markdown format
 * Includes data flow analysis: which files push/fetch data to/from each table
 *
 * Usage: node scripts/generate-schema-docs.js [output_file]
 * Example: node scripts/generate-schema-docs.js docs/DATABASE_SCHEMA.md
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const OUTPUT_FILE = process.argv[2] || 'docs/DATABASE_SCHEMA.md';
const DATA_FLOW_FILE = 'docs/DATA_FLOW_MAP.json';

// ============================================
// STEP 1: Analyze Data Flow
// ============================================

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

function searchPattern(pattern) {
  try {
    const cmd = `grep -rln --include="*.js" --include="*.ts" --include="*.tsx" --include="*.mjs" -E "${pattern}" server/ client/src/ shared/ 2>/dev/null || true`;
    const result = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
    return result.trim().split('\n').filter(Boolean);
  } catch (e) {
    return [];
  }
}

function analyzeTableDataFlow(tableName) {
  const pushFiles = new Set();
  const fetchFiles = new Set();

  // Drizzle INSERT patterns
  const insertMatches = searchPattern(`db\\.insert\\(${tableName}\\)|insert\\(${tableName}\\)`);
  insertMatches.forEach(f => pushFiles.add(f));

  // Drizzle UPDATE patterns
  const updateMatches = searchPattern(`db\\.update\\(${tableName}\\)|update\\(${tableName}\\)`);
  updateMatches.forEach(f => pushFiles.add(f));

  // Drizzle SELECT patterns
  const selectMatches = searchPattern(`\\.from\\(${tableName}\\)|from\\(${tableName}\\)`);
  selectMatches.forEach(f => fetchFiles.add(f));

  // Also check for table imports and direct column access
  const importMatches = searchPattern(`import.*\\{[^}]*${tableName}[^}]*\\}.*from.*schema`);
  importMatches.forEach(f => {
    // Check if file has insert/update or select
    try {
      const content = readFileSync(f, 'utf8');
      if (/\.insert\(|\.update\(|INSERT|UPDATE/i.test(content)) {
        if (content.includes(tableName)) pushFiles.add(f);
      }
      if (/\.select\(|\.from\(|SELECT|FROM/i.test(content)) {
        if (content.includes(tableName)) fetchFiles.add(f);
      }
    } catch (e) {}
  });

  return {
    push: Array.from(pushFiles).map(f => f.replace(/^(server\/|client\/src\/)/, '')).sort(),
    fetch: Array.from(fetchFiles).map(f => f.replace(/^(server\/|client\/src\/)/, '')).sort()
  };
}

console.log('🔍 Analyzing data flow...');
const dataFlow = {};
for (const table of DRIZZLE_TABLES) {
  dataFlow[table] = analyzeTableDataFlow(table);
}
writeFileSync(DATA_FLOW_FILE, JSON.stringify(dataFlow, null, 2));
console.log(`   Saved: ${DATA_FLOW_FILE}`);

// ============================================
// STEP 2: Fetch Schema from Database
// ============================================

console.log('📊 Fetching database schema...');

const SCHEMA_QUERY = `
SELECT
    t.table_name,
    c.column_name,
    c.ordinal_position,
    c.data_type,
    c.udt_name,
    c.character_maximum_length,
    c.is_nullable,
    c.column_default,
    CASE WHEN pk.column_name IS NOT NULL THEN 'PK' ELSE NULL END AS is_pk,
    fk.foreign_table,
    fk.foreign_column,
    CASE WHEN uq.column_name IS NOT NULL THEN 'UNIQUE' ELSE NULL END AS is_unique
FROM information_schema.tables t
JOIN information_schema.columns c
    ON t.table_name = c.table_name AND t.table_schema = c.table_schema
LEFT JOIN (
    SELECT kcu.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
) pk ON c.table_name = pk.table_name AND c.column_name = pk.column_name
LEFT JOIN (
    SELECT kcu.table_name, kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
) fk ON c.table_name = fk.table_name AND c.column_name = fk.column_name
LEFT JOIN (
    SELECT kcu.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public'
) uq ON c.table_name = uq.table_name AND c.column_name = uq.column_name
WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name, c.ordinal_position;
`;

const result = execSync(
  `psql "$DATABASE_URL" -t -A -F'|' -c "${SCHEMA_QUERY.replace(/\n/g, ' ')}"`,
  { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
);

const rows = result.trim().split('\n').filter(Boolean).map(line => {
  const parts = line.split('|');
  return {
    table_name: parts[0],
    column_name: parts[1],
    ordinal: parseInt(parts[2]),
    data_type: parts[3],
    udt_name: parts[4],
    max_length: parts[5] || null,
    is_nullable: parts[6],
    column_default: parts[7] || null,
    is_pk: parts[8] === 'PK',
    fk_table: parts[9] || null,
    fk_column: parts[10] || null,
    is_unique: parts[11] === 'UNIQUE'
  };
});

// Group by table
const tables = {};
for (const row of rows) {
  if (!tables[row.table_name]) {
    tables[row.table_name] = [];
  }
  tables[row.table_name].push(row);
}

const tableNames = Object.keys(tables).sort();
const totalColumns = rows.length;
const generatedDate = new Date().toISOString().replace('T', ' ').slice(0, 19);

// ============================================
// STEP 3: Generate Markdown
// ============================================

console.log('📝 Generating markdown...');

let md = `# Database Schema Reference

> Auto-generated database schema documentation for Vecto Pilot.
> **Includes data flow traceability: which files PUSH (write) and FETCH (read) each table.**

| Metric | Value |
|--------|-------|
| **Generated** | ${generatedDate} |
| **Tables** | ${tableNames.length} |
| **Total Columns** | ${totalColumns} |
| **Database** | PostgreSQL |

---

## Quick Navigation

`;

// Category groupings for TOC
const tableCategories = {
  'Core User Data': ['users', 'driver_profiles', 'driver_vehicles', 'auth_credentials', 'verification_codes'],
  'Location & Snapshots': ['snapshots', 'coords_cache'],
  'AI Strategy Pipeline': ['strategies', 'rankings', 'ranking_candidates', 'briefings', 'triad_jobs', 'block_jobs'],
  'Venues': ['venue_cache', 'venue_catalog', 'venue_events', 'venue_metrics', 'nearby_venues', 'llm_venue_suggestions', 'places_cache'],
  'Events': ['discovered_events', 'events_facts'],
  'AI Coach': ['coach_conversations', 'coach_system_notes', 'user_intel_notes'],
  'Intelligence': ['market_intelligence', 'zone_intelligence', 'traffic_zones', 'travel_disruptions'],
  'Reference Data': ['markets', 'countries', 'platform_data', 'vehicle_makes_cache', 'vehicle_models_cache'],
  'Feedback & Actions': ['actions', 'app_feedback', 'venue_feedback', 'strategy_feedback', 'news_deactivations'],
  'System & Memory': ['agent_memory', 'assistant_memory', 'eidolon_memory', 'eidolon_snapshots', 'cross_thread_memory', 'agent_changes', 'connection_audit', 'http_idem']
};

for (const [category, categoryTables] of Object.entries(tableCategories)) {
  md += `### ${category}\n`;
  for (const t of categoryTables) {
    if (tables[t]) {
      const flow = dataFlow[t] || { push: [], fetch: [] };
      md += `- [${t}](#${t}) *(${tables[t].length} cols, ↑${flow.push.length} push, ↓${flow.fetch.length} fetch)*\n`;
    }
  }
  md += '\n';
}

md += `---

## Legend

| Symbol | Meaning |
|--------|---------|
| 🔑 PK | Primary Key |
| → table(col) | Foreign Key reference |
| 🔒 UNIQUE | Unique constraint |
| ✓ | Nullable (YES) |
| ✗ | Not Nullable (NO) |
| ↑ Push | Files that INSERT/UPDATE this table |
| ↓ Fetch | Files that SELECT from this table |

---

`;

// Table documentation
for (const tableName of tableNames) {
  const columns = tables[tableName];
  const flow = dataFlow[tableName] || { push: [], fetch: [] };

  md += `## ${tableName}\n\n`;

  // Data flow section
  md += `### Data Flow\n\n`;

  if (flow.push.length > 0) {
    md += `**↑ Push (INSERT/UPDATE):** ${flow.push.length} file(s)\n`;
    for (const f of flow.push) {
      md += `- \`${f}\`\n`;
    }
    md += '\n';
  } else {
    md += `**↑ Push:** *No direct writes found*\n\n`;
  }

  if (flow.fetch.length > 0) {
    md += `**↓ Fetch (SELECT):** ${flow.fetch.length} file(s)\n`;
    for (const f of flow.fetch) {
      md += `- \`${f}\`\n`;
    }
    md += '\n';
  } else {
    md += `**↓ Fetch:** *No direct reads found*\n\n`;
  }

  // Columns section
  md += `### Columns (${columns.length})\n\n`;
  md += `| # | Column | Type | Null | Default | Constraints |\n`;
  md += `|--:|--------|------|:----:|---------|-------------|\n`;

  for (const col of columns) {
    let typeStr = col.data_type;
    if (col.max_length) {
      typeStr += `(${col.max_length})`;
    }

    const nullIcon = col.is_nullable === 'YES' ? '✓' : '✗';

    let defaultVal = col.column_default || '';
    if (defaultVal.length > 25) {
      defaultVal = defaultVal.slice(0, 22) + '...';
    }
    defaultVal = defaultVal.replace(/\|/g, '\\|');

    const constraints = [];
    if (col.is_pk) constraints.push('🔑 PK');
    if (col.fk_table) constraints.push(`→ ${col.fk_table}(${col.fk_column})`);
    if (col.is_unique) constraints.push('🔒 UNIQUE');

    md += `| ${col.ordinal} | \`${col.column_name}\` | ${typeStr} | ${nullIcon} | \`${defaultVal}\` | ${constraints.join(', ')} |\n`;
  }

  md += `\n`;
}

md += `---

## Data Flow Summary

| Table | Push Files | Fetch Files |
|-------|-----------|-------------|
`;

for (const tableName of tableNames) {
  const flow = dataFlow[tableName] || { push: [], fetch: [] };
  md += `| ${tableName} | ${flow.push.length} | ${flow.fetch.length} |\n`;
}

md += `
---

*Generated by \`scripts/generate-schema-docs.js\`*
*Data flow analysis saved to \`docs/DATA_FLOW_MAP.json\`*
`;

writeFileSync(OUTPUT_FILE, md);
console.log(`\n✅ Generated: ${OUTPUT_FILE}`);
console.log(`   Tables: ${tableNames.length}`);
console.log(`   Columns: ${totalColumns}`);
