// scripts/import-market-intelligence.js
// 2026-02-02: Imports market intelligence from JSON file
//
// Usage:
//   node scripts/import-market-intelligence.js path/to/intelligence.json
//   node scripts/import-market-intelligence.js path/to/intelligence.json --dry-run

import { db } from '../server/db/drizzle.js';
import { market_intelligence } from '../shared/schema.js';
import { eq, and } from 'drizzle-orm';
import fs from 'fs';

const args = process.argv.slice(2);
const filePath = args.find(a => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');

if (!filePath) {
  console.error('Usage: node scripts/import-market-intelligence.js <file.json> [--dry-run]');
  process.exit(1);
}

async function importIntelligence() {
  const content = fs.readFileSync(filePath, 'utf8');
  const records = JSON.parse(content);

  console.log(`\n📂 Reading: ${filePath}`);
  console.log(`📊 Found ${records.length} intelligence records`);

  if (dryRun) {
    console.log('\n🔍 DRY RUN - No changes will be made\n');
  }

  let added = 0, skipped = 0;

  for (const rec of records) {
    // Check if similar record exists
    const [existing] = await db
      .select()
      .from(market_intelligence)
      .where(and(
        eq(market_intelligence.market, rec.market),
        eq(market_intelligence.title, rec.title)
      ))
      .limit(1);

    if (existing) {
      console.log(`  ⏭️ SKIP: ${rec.market} - "${rec.title}" (exists)`);
      skipped++;
      continue;
    }

    if (!dryRun) {
      await db.insert(market_intelligence).values({
        market: rec.market,
        market_slug: rec.market_slug,
        platform: rec.platform || 'uber',
        intel_type: rec.intel_type,
        title: rec.title,
        summary: rec.summary,
        content: rec.content,
        neighborhoods: rec.neighborhoods || [],
        time_context: rec.time_context || null,
        tags: rec.tags || [],
        priority: rec.priority || 50,
        source: rec.source || 'research',
        source_file: rec.source_file,
        source_section: rec.source_section,
        confidence: rec.confidence || 80
      });
    }

    console.log(`  ✅ ADD: ${rec.market} - "${rec.title}"`);
    added++;
  }

  console.log('\n📈 Summary:');
  console.log(`  Added: ${added}`);
  console.log(`  Skipped (existing): ${skipped}`);

  if (dryRun) {
    console.log('\n⚠️ DRY RUN complete - run without --dry-run to apply changes');
  }

  process.exit(0);
}

importIntelligence().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
