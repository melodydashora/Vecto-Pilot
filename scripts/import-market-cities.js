// scripts/import-market-cities.js
// 2026-02-01: Imports market cities from JSON or CSV files
//
// Supports two formats:
// 1. JSON: { markets: [{ market_name, state, state_abbr, cities: [{city, region_type}] }] }
// 2. CSV: state_abbr,state,city,market_name,region_type
//
// Usage:
//   node scripts/import-market-cities.js path/to/markets.json
//   node scripts/import-market-cities.js path/to/markets.csv
//
// Options:
//   --dry-run    Preview changes without applying
//   --upsert     Update existing entries (default: skip existing)

import { db } from '../server/db/drizzle.js';
// 2026-02-17: Renamed market_cities → market_cities (market consolidation)
import { market_cities } from '../shared/schema.js';
import { eq, and, ilike } from 'drizzle-orm';
import fs from 'fs';

const args = process.argv.slice(2);
const filePath = args.find(a => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const upsert = args.includes('--upsert');

if (!filePath) {
  console.error('Usage: node scripts/import-market-cities.js <file.json|file.csv> [--dry-run] [--upsert]');
  process.exit(1);
}

// State abbreviation to full name mapping
const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia'
};

// Parse JSON format
function parseJSON(content) {
  const data = JSON.parse(content);
  const entries = [];

  // Support both 'markets' and 'markets_continued' keys
  const markets = data.markets || data.markets_continued || [];

  for (const market of markets) {
    const { market_name, state, state_abbr, cities } = market;

    for (const city of cities || []) {
      entries.push({
        state: state || STATE_NAMES[state_abbr] || 'Unknown',
        state_abbr: state_abbr || Object.keys(STATE_NAMES).find(k => STATE_NAMES[k] === state),
        city: city.city,
        market_name,
        region_type: city.region_type || 'Satellite'
      });
    }
  }

  return entries;
}

// Parse CSV format (expects header row)
function parseCSV(content) {
  const lines = content.split('\n').filter(l => l.trim());
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const entries = [];

  // Map header columns to our expected fields
  const colMap = {
    state_abbr: header.indexOf('state_abbr') >= 0 ? header.indexOf('state_abbr') : header.indexOf('state'),
    state: header.indexOf('state') >= 0 ? header.indexOf('state') : -1,
    city: header.indexOf('city'),
    market_name: header.indexOf('market_name') >= 0 ? header.indexOf('market_name') : header.indexOf('market_anchor'),
    region_type: header.indexOf('region_type')
  };

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',').map(p => p.trim());
    if (parts.length < 3) continue;

    const stateVal = parts[colMap.state_abbr] || '';
    const stateAbbr = stateVal.length === 2 ? stateVal.toUpperCase() : null;
    const stateFull = colMap.state >= 0 ? parts[colMap.state] : STATE_NAMES[stateAbbr];

    entries.push({
      state: stateFull || 'Unknown',
      state_abbr: stateAbbr,
      city: parts[colMap.city],
      market_name: parts[colMap.market_name],
      region_type: colMap.region_type >= 0 ? parts[colMap.region_type] : 'Satellite'
    });
  }

  return entries;
}

async function importMarkets() {
  const content = fs.readFileSync(filePath, 'utf8');
  const isJSON = filePath.endsWith('.json');

  console.log(`\n📂 Reading ${isJSON ? 'JSON' : 'CSV'} file: ${filePath}`);

  const entries = isJSON ? parseJSON(content) : parseCSV(content);
  console.log(`📊 Parsed ${entries.length} city entries`);

  if (dryRun) {
    console.log('\n🔍 DRY RUN - No changes will be made\n');
  }

  let added = 0, updated = 0, skipped = 0;
  const errors = [];

  for (const entry of entries) {
    try {
      // Check for existing entry
      const [existing] = await db
        .select()
        .from(market_cities)
        .where(and(
          ilike(market_cities.city, entry.city),
          ilike(market_cities.state_abbr, entry.state_abbr || '')
        ))
        .limit(1);

      if (existing) {
        // 2026-02-02: Check both market_name and region_type for changes
        const needsUpdate = upsert && (
          existing.market_name !== entry.market_name ||
          existing.region_type !== entry.region_type
        );
        if (needsUpdate) {
          if (!dryRun) {
            await db
              .update(market_cities)
              .set({ market_name: entry.market_name, region_type: entry.region_type })
              .where(eq(market_cities.id, existing.id));
          }
          const changes = [];
          if (existing.market_name !== entry.market_name) changes.push(`market: "${existing.market_name}" → "${entry.market_name}"`);
          if (existing.region_type !== entry.region_type) changes.push(`region: ${existing.region_type} → ${entry.region_type}`);
          console.log(`  ✏️ UPDATE: ${entry.city}, ${entry.state_abbr}: ${changes.join(', ')}`);
          updated++;
        } else {
          skipped++;
        }
      } else {
        if (!dryRun) {
          await db.insert(market_cities).values(entry);
        }
        console.log(`  ➕ ADD: ${entry.city}, ${entry.state_abbr} → ${entry.market_name} (${entry.region_type})`);
        added++;
      }
    } catch (err) {
      errors.push({ entry, error: err.message });
    }
  }

  console.log('\n📈 Summary:');
  console.log(`  Added: ${added}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped (existing): ${skipped}`);
  if (errors.length > 0) {
    console.log(`  Errors: ${errors.length}`);
    errors.slice(0, 5).forEach(e => console.log(`    - ${e.entry.city}: ${e.error}`));
  }

  if (dryRun) {
    console.log('\n⚠️ DRY RUN complete - run without --dry-run to apply changes');
  }

  process.exit(0);
}

importMarkets().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
