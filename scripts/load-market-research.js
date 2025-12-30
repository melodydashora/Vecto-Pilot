#!/usr/bin/env node
/**
 * Load Market Research Data into platform_data table
 *
 * Parses the research-intel.txt file and updates the platform_data table
 * with market anchor and region type information.
 */

import fs from 'fs';
import path from 'path';
import { db } from '../server/db/drizzle.js';
import { platform_data } from '../shared/schema.js';
import { eq, and, sql } from 'drizzle-orm';

// State abbreviation to full name mapping
const STATE_ABBREV_TO_NAME = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
  'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
  'DC': 'District of Columbia', 'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii',
  'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
  'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine',
  'MD': 'Maryland', 'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota',
  'MS': 'Mississippi', 'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska',
  'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico',
  'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
  'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island',
  'SC': 'South Carolina', 'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas',
  'UT': 'Utah', 'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington',
  'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming'
};

async function loadMarketResearch() {
  console.log('📊 Loading market research data...\n');

  // Read the research file
  const researchPath = path.join(process.cwd(), 'platform-data/uber/research-findings/research-intel.txt');
  const content = fs.readFileSync(researchPath, 'utf-8');

  // Find the CSV data section (starts with "State,City,Market_Anchor,Region_Type")
  const lines = content.split('\n');
  const csvStartIndex = lines.findIndex(line =>
    line.trim().startsWith('State,City,Market_Anchor,Region_Type') ||
    line.match(/^[A-Z]{2},[A-Za-z\s]+,/)
  );

  if (csvStartIndex === -1) {
    // Look for the first data line (e.g., "AL,Adamsville,Birmingham,Satellite")
    const dataStart = lines.findIndex(line => line.match(/^[A-Z]{2},[^,]+,[^,]+,(Core|Satellite|Rural)/));
    if (dataStart === -1) {
      console.error('❌ Could not find CSV data in research file');
      process.exit(1);
    }
  }

  // Parse CSV lines
  const records = [];
  for (const line of lines) {
    // Skip empty lines and header
    if (!line.trim() || line.startsWith('State,City')) continue;

    // Match pattern: STATE,City,Market_Anchor,Region_Type[,Source_Ref]
    const match = line.match(/^([A-Z]{2}),([^,]+),([^,]+),(Core|Satellite|Rural)/);
    if (match) {
      const [, stateAbbrev, city, marketAnchor, regionType] = match;
      records.push({
        stateAbbrev,
        stateName: STATE_ABBREV_TO_NAME[stateAbbrev] || stateAbbrev,
        city: city.trim(),
        marketAnchor: marketAnchor.trim(),
        regionType: regionType.trim()
      });
    }
  }

  console.log(`📝 Found ${records.length} city records to process\n`);

  // Group by state for display
  const byState = {};
  for (const record of records) {
    byState[record.stateAbbrev] = (byState[record.stateAbbrev] || 0) + 1;
  }
  console.log('States covered:', Object.keys(byState).sort().join(', '));
  console.log('');

  // Update platform_data table
  let updated = 0;
  let inserted = 0;
  let errors = 0;

  for (const record of records) {
    try {
      // Check if record exists
      const existing = await db
        .select()
        .from(platform_data)
        .where(and(
          eq(platform_data.platform, 'uber'),
          eq(platform_data.city, record.city),
          eq(platform_data.region, record.stateName)
        ))
        .limit(1);

      if (existing.length > 0) {
        // Update existing record
        await db
          .update(platform_data)
          .set({
            market: record.marketAnchor,
            market_anchor: record.marketAnchor,
            region_type: record.regionType,
            updated_at: new Date()
          })
          .where(eq(platform_data.id, existing[0].id));
        updated++;
      } else {
        // Insert new record
        await db
          .insert(platform_data)
          .values({
            platform: 'uber',
            country: 'United States',
            country_code: 'US',
            region: record.stateName,
            city: record.city,
            market: record.marketAnchor,
            market_anchor: record.marketAnchor,
            region_type: record.regionType,
            is_active: true
          })
          .onConflictDoNothing();
        inserted++;
      }
    } catch (err) {
      console.error(`❌ Error processing ${record.city}, ${record.stateName}:`, err.message);
      errors++;
    }
  }

  console.log('\n📊 Results:');
  console.log(`   ✅ Updated: ${updated}`);
  console.log(`   ➕ Inserted: ${inserted}`);
  if (errors > 0) console.log(`   ❌ Errors: ${errors}`);

  // Show sample of data
  console.log('\n📋 Sample data (first 10 records by market):');
  const sample = await db
    .select({
      city: platform_data.city,
      region: platform_data.region,
      market: platform_data.market,
      region_type: platform_data.region_type
    })
    .from(platform_data)
    .where(eq(platform_data.platform, 'uber'))
    .orderBy(platform_data.market, platform_data.city)
    .limit(10);

  console.table(sample);

  // Show market summary
  console.log('\n📊 Market Summary:');
  const marketSummary = await db.execute(sql`
    SELECT
      market_anchor as market,
      COUNT(*) as cities,
      SUM(CASE WHEN region_type = 'Core' THEN 1 ELSE 0 END) as core_cities,
      SUM(CASE WHEN region_type = 'Satellite' THEN 1 ELSE 0 END) as satellites,
      SUM(CASE WHEN region_type = 'Rural' THEN 1 ELSE 0 END) as rural
    FROM platform_data
    WHERE platform = 'uber' AND market_anchor IS NOT NULL
    GROUP BY market_anchor
    ORDER BY cities DESC
    LIMIT 20
  `);

  console.table(marketSummary.rows);

  process.exit(0);
}

loadMarketResearch().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
