// scripts/fix-market-names.js
// Updates market_cities table with correct market names from research file

import { db } from '../server/db/drizzle.js';
import fs from 'fs';

async function fixMarketNames() {
  // Read research file
  const content = fs.readFileSync('/home/runner/workspace/platform-data/uber/research-findings/research-intel.txt', 'utf8');
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));

  // Parse into lookup: state_abbr + city -> market_name
  const marketLookup = {};
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length >= 3) {
      const state = parts[0].trim();
      const city = parts[1].trim();
      const market = parts[2].trim();
      marketLookup[state + '|' + city] = market;
    }
  }

  console.log('Parsed', Object.keys(marketLookup).length, 'entries from research file');
  console.log('Sample: TX|Frisco →', marketLookup['TX|Frisco']);
  console.log('Sample: TX|Dallas →', marketLookup['TX|Dallas']);

  // Get all current entries
  const current = await db.execute('SELECT id, state_abbr, city, market_name FROM market_cities');

  let updated = 0;
  const mismatches = [];

  for (const row of current.rows) {
    const key = row.state_abbr + '|' + row.city;
    const correctMarket = marketLookup[key];

    if (correctMarket && correctMarket !== row.market_name) {
      mismatches.push({ city: row.city, state: row.state_abbr, current: row.market_name, correct: correctMarket });
      // Use raw SQL with string interpolation (safe since we control the values)
      const safeMarket = correctMarket.replace(/'/g, "''");
      await db.execute(`UPDATE market_cities SET market_name = '${safeMarket}' WHERE id = '${row.id}'`);
      updated++;
    }
  }

  console.log('\nMismatches found and fixed:');
  mismatches.forEach(m => console.log('  ' + m.state + '/' + m.city + ': "' + m.current + '" → "' + m.correct + '"'));
  console.log('\nTotal updated:', updated);

  process.exit(0);
}

fixMarketNames().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
