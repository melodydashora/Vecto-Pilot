/**
 * Import Platform Data Script
 *
 * Imports rideshare platform city data from CSV/JSON files into the platform_data table.
 *
 * Usage:
 *   node scripts/import-platform-data.js [--dry-run] [--platform=uber]
 *
 * Options:
 *   --dry-run     Preview what would be imported without writing to database
 *   --platform    Specify platform (default: uber)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../server/db/drizzle.js';
import { platform_data } from '../shared/schema.js';
import { sql } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const platformArg = args.find(a => a.startsWith('--platform='));
const platform = platformArg ? platformArg.split('=')[1] : 'uber';

console.log(`\n🚀 Platform Data Import Script`);
console.log(`   Platform: ${platform}`);
console.log(`   Dry Run: ${dryRun ? 'YES (no writes)' : 'NO (will write to DB)'}\n`);

/**
 * Read and parse the JSON data file
 */
function readJsonData(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Read and parse the CSV data file
 */
function readCsvData(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());

  return lines.slice(1).map(line => {
    // Handle quoted CSV values
    const values = [];
    let current = '';
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] || '';
    });
    return obj;
  });
}

/**
 * Normalize and clean city data
 */
function normalizeCityData(rawData, platform) {
  return rawData
    .filter(item => {
      // Skip entries where city is "Cities" (header rows in source data)
      if (item.city === 'Cities') return false;
      // Skip empty city names
      if (!item.city || item.city.trim() === '') return false;
      return true;
    })
    .map(item => ({
      platform: platform.toLowerCase(),
      country: item.country || item.Country || '',
      country_code: (item.countryCode || item.country_code || '').toUpperCase(),
      region: item.region || item.Region || item.state || item.State || null,
      city: item.city || item.City || '',
      market: null, // Can be populated later
      timezone: null, // Can be populated via geocoding
      coord_boundary: null,
      center_lat: null,
      center_lng: null,
      is_active: true,
    }));
}

/**
 * Insert data in batches
 */
async function insertBatch(batch) {
  if (batch.length === 0) return 0;

  try {
    await db.insert(platform_data)
      .values(batch)
      .onConflictDoNothing(); // Skip duplicates based on unique index

    return batch.length;
  } catch (error) {
    console.error(`  ❌ Batch insert error: ${error.message}`);
    // Try inserting one by one to identify problematic rows
    let successCount = 0;
    for (const row of batch) {
      try {
        await db.insert(platform_data)
          .values(row)
          .onConflictDoNothing();
        successCount++;
      } catch (rowError) {
        console.error(`  ⚠️ Failed to insert: ${row.city}, ${row.region}, ${row.country}`);
      }
    }
    return successCount;
  }
}

/**
 * Main import function
 */
async function importPlatformData() {
  const dataDir = path.join(__dirname, '..', 'platform-data', platform);

  // Check if data directory exists
  if (!fs.existsSync(dataDir)) {
    console.error(`❌ Data directory not found: ${dataDir}`);
    process.exit(1);
  }

  // Find data files
  const jsonFile = path.join(dataDir, `${platform}_cities_data.json`);
  const csvFile = path.join(dataDir, `${platform}_cities_data.csv`);

  let rawData = [];

  // Prefer CSV (has more complete data with regions), fall back to JSON
  if (fs.existsSync(csvFile)) {
    console.log(`📄 Reading CSV: ${path.basename(csvFile)}`);
    rawData = readCsvData(csvFile);
  } else if (fs.existsSync(jsonFile)) {
    console.log(`📄 Reading JSON: ${path.basename(jsonFile)}`);
    rawData = readJsonData(jsonFile);
  } else {
    console.error(`❌ No data file found in ${dataDir}`);
    console.error(`   Expected: ${platform}_cities_data.json or ${platform}_cities_data.csv`);
    process.exit(1);
  }

  console.log(`   Found ${rawData.length} raw entries\n`);

  // Normalize the data
  const normalizedData = normalizeCityData(rawData, platform);
  console.log(`📊 After normalization: ${normalizedData.length} entries\n`);

  // Show sample data
  console.log(`📋 Sample data (first 5 entries):`);
  normalizedData.slice(0, 5).forEach((entry, i) => {
    console.log(`   ${i + 1}. ${entry.city}, ${entry.region || 'N/A'}, ${entry.country} (${entry.country_code})`);
  });
  console.log();

  // Count by country
  const countryCounts = {};
  normalizedData.forEach(entry => {
    countryCounts[entry.country] = (countryCounts[entry.country] || 0) + 1;
  });

  console.log(`🌍 Countries summary (top 10):`);
  Object.entries(countryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([country, count]) => {
      console.log(`   ${country}: ${count} cities`);
    });
  console.log();

  if (dryRun) {
    console.log(`🔍 DRY RUN - No data will be written to database\n`);
    console.log(`   Would insert ${normalizedData.length} entries`);
    return;
  }

  // Insert in batches
  const BATCH_SIZE = 500;
  let totalInserted = 0;

  console.log(`💾 Inserting data in batches of ${BATCH_SIZE}...`);

  for (let i = 0; i < normalizedData.length; i += BATCH_SIZE) {
    const batch = normalizedData.slice(i, i + BATCH_SIZE);
    const inserted = await insertBatch(batch);
    totalInserted += inserted;

    const progress = Math.min(i + BATCH_SIZE, normalizedData.length);
    const percent = ((progress / normalizedData.length) * 100).toFixed(1);
    process.stdout.write(`\r   Progress: ${progress}/${normalizedData.length} (${percent}%) - Inserted: ${totalInserted}`);
  }

  console.log(`\n\n✅ Import complete!`);
  console.log(`   Total entries processed: ${normalizedData.length}`);
  console.log(`   Total entries inserted: ${totalInserted}`);
  console.log(`   Duplicates skipped: ${normalizedData.length - totalInserted}`);
}

// Run the import
importPlatformData()
  .then(() => {
    console.log(`\n👋 Done!\n`);
    process.exit(0);
  })
  .catch(error => {
    console.error(`\n❌ Import failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  });
