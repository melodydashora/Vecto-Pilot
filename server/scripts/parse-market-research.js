#!/usr/bin/env node
/**
 * parse-market-research.js
 *
 * Parses research documents from platform-data and extracts structured
 * market intelligence for the market_intelligence table.
 *
 * Usage:
 *   node server/scripts/parse-market-research.js [--dry-run] [--file=<path>]
 *
 * Options:
 *   --dry-run   Parse and display results without inserting into database
 *   --file      Specific file to parse (default: all files in research-findings)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db/drizzle.js';
import { market_intelligence } from '../../shared/schema.js';
import { callModel } from '../lib/ai/adapters/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM_DATA_DIR = path.join(__dirname, '../../platform-data');

// Market configurations
const MARKETS = {
  'los-angeles': { name: 'Los Angeles', aliases: ['LA', 'L.A.', 'Los Angeles'] },
  'new-york-city': { name: 'New York City', aliases: ['NYC', 'New York', 'New York City'] },
  'chicago': { name: 'Chicago', aliases: ['Chicago'] },
  'miami': { name: 'Miami', aliases: ['Miami'] },
  'atlanta': { name: 'Atlanta', aliases: ['Atlanta'] },
  'dallas-fort-worth': { name: 'Dallas-Fort Worth', aliases: ['Dallas', 'DFW', 'Dallas-Fort Worth'] },
  'houston': { name: 'Houston', aliases: ['Houston'] },
  'phoenix': { name: 'Phoenix', aliases: ['Phoenix'] },
  'san-francisco': { name: 'San Francisco', aliases: ['SF', 'San Francisco', 'Bay Area'] },
  'seattle': { name: 'Seattle', aliases: ['Seattle'] },
};

// Intelligence extraction prompt
const EXTRACTION_PROMPT = `You are an expert at extracting structured market intelligence from rideshare research documents.

Given a section of research text about a specific market, extract ALL pieces of actionable intelligence and categorize them.

For each piece of intelligence, provide:
1. intel_type: One of: regulatory, strategy, zone, timing, airport, safety, algorithm, vehicle, general
2. intel_subtype: For zones only: honey_hole, danger_zone, dead_zone, safe_corridor, caution_zone
3. title: A short descriptive title (max 80 chars)
4. summary: A 1-2 sentence summary of the key insight
5. content: The full detailed intelligence (can be multiple paragraphs, preserve important details)
6. neighborhoods: Array of neighborhood names mentioned (if applicable)
7. tags: Array of relevant tags for searchability
8. priority: 1-100 where 100 = critical safety info, 80 = very important strategy, 50 = useful info
9. confidence: 1-100 based on specificity and sourcing of the information

Return a JSON array of intelligence objects. Focus on ACTIONABLE insights that would help a driver.

Examples of what to extract:
- Specific neighborhoods that are honey holes or danger zones
- Time-based strategies (when to drive, when to avoid)
- Regulatory rules affecting pay (Prop 22, TLC rates)
- Algorithm mechanics (Advantage Mode thresholds, lockouts)
- Airport queue strategies
- Safety warnings with specific locations
- Vehicle type recommendations`;

/**
 * Parse a research document and extract market intelligence
 */
async function parseDocument(filePath, platform) {
  console.log(`\n📄 Parsing: ${filePath}`);

  const content = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = path.relative(PLATFORM_DATA_DIR, filePath);

  // Split document into market-specific sections
  const sections = extractMarketSections(content);

  console.log(`   Found ${sections.length} market sections`);

  const allIntelligence = [];

  for (const section of sections) {
    console.log(`   📍 Processing: ${section.market} (${section.title})`);

    try {
      const intelligence = await extractIntelligence(section, platform, sourceFile);
      allIntelligence.push(...intelligence);
      console.log(`      ✅ Extracted ${intelligence.length} intelligence items`);
    } catch (error) {
      console.error(`      ❌ Error extracting intelligence: ${error.message}`);
    }
  }

  return allIntelligence;
}

/**
 * Extract market-specific sections from the document
 */
function extractMarketSections(content) {
  const sections = [];

  // Define the market sections we're looking for
  const marketSections = [
    { num: 3, pattern: /3\.\s*Market Analysis:\s*Los Angeles\s*\([^)]+\)\s*([\s\S]*?)(?=4\.\s*Market Analysis)/i, market: 'Los Angeles', slug: 'los-angeles' },
    { num: 4, pattern: /4\.\s*Market Analysis:\s*New York City\s*\([^)]+\)\s*([\s\S]*?)(?=5\.\s*Market Analysis)/i, market: 'New York City', slug: 'new-york-city' },
    { num: 5, pattern: /5\.\s*Market Analysis:\s*Chicago\s*\([^)]+\)\s*([\s\S]*?)(?=6\.\s*Market Analysis)/i, market: 'Chicago', slug: 'chicago' },
    { num: 6, pattern: /6\.\s*Market Analysis:\s*Miami\s*\([^)]+\)\s*([\s\S]*?)(?=7\.\s*Market Analysis)/i, market: 'Miami', slug: 'miami' },
    { num: 7, pattern: /7\.\s*Market Analysis:\s*Atlanta\s*\([^)]+\)\s*([\s\S]*?)(?=8\.\s*Advanced Tactics)/i, market: 'Atlanta', slug: 'atlanta' },
  ];

  for (const section of marketSections) {
    const match = section.pattern.exec(content);
    if (match) {
      sections.push({
        market: section.market,
        marketSlug: section.slug,
        title: `Section ${section.num}: ${section.market}`,
        content: match[1].trim(),
      });
    }
  }

  // Also extract universal mechanics section
  const universalPattern = /2\.\s*Universal Mechanics[^(]*(?:\([^)]+\))?\s*([\s\S]*?)(?=3\.\s*Market Analysis)/i;
  const universalMatch = universalPattern.exec(content);

  if (universalMatch) {
    sections.unshift({
      market: 'Universal',
      marketSlug: 'universal',
      title: 'Universal Mechanics',
      content: universalMatch[1].trim(),
      isUniversal: true,
    });
  }

  return sections;
}

/**
 * Find market slug from market name or alias
 * Uses word boundary matching to avoid false matches (e.g., "Atlanta" containing "LA")
 */
function findMarketSlug(name) {
  const normalizedName = name.toLowerCase().trim();

  // Check in order of specificity (longer names first to avoid substring false matches)
  const orderedMarkets = Object.entries(MARKETS).sort((a, b) => {
    // Sort by longest alias first
    const maxA = Math.max(...a[1].aliases.map(al => al.length));
    const maxB = Math.max(...b[1].aliases.map(al => al.length));
    return maxB - maxA;
  });

  for (const [slug, config] of orderedMarkets) {
    for (const alias of config.aliases) {
      // Use word boundary matching - alias must match as whole word
      const aliasLower = alias.toLowerCase();
      const regex = new RegExp(`\\b${aliasLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(normalizedName)) {
        return slug;
      }
    }
  }

  return null;
}

/**
 * Use LLM to extract structured intelligence from a section
 */
async function extractIntelligence(section, platform, sourceFile) {
  const systemPrompt = EXTRACTION_PROMPT;

  const userPrompt = `Extract market intelligence from this section about ${section.market}:

---
${section.title}

${section.content.substring(0, 12000)}
---

Return a JSON array of intelligence objects. Be thorough - extract ALL actionable insights.`;

  try {
    const response = await callModel('UTIL_MARKET_PARSER', {
      system: systemPrompt,
      user: userPrompt,
    });

    // Parse the JSON response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn('      ⚠️ No JSON array found in response');
      return [];
    }

    const rawIntelligence = JSON.parse(jsonMatch[0]);

    // Transform and validate each item
    return rawIntelligence.map((item, index) => ({
      market: section.market,
      market_slug: section.marketSlug,
      platform: platform,
      intel_type: item.intel_type || 'general',
      intel_subtype: item.intel_subtype || null,
      title: (item.title || `Intelligence #${index + 1}`).substring(0, 255),
      summary: item.summary || null,
      content: item.content || '',
      neighborhoods: item.neighborhoods?.length ? item.neighborhoods : null,
      boundaries: null,
      time_context: item.time_context || null,
      tags: item.tags || [],
      priority: Math.min(100, Math.max(1, item.priority || 50)),
      source: 'research',
      source_file: sourceFile,
      source_section: section.title,
      confidence: Math.min(100, Math.max(1, item.confidence || 70)),
      version: 1,
      effective_date: new Date(),
      is_active: true,
      is_verified: false,
      coach_can_cite: true,
      coach_priority: item.priority || 50,
      created_by: 'system',
    }));
  } catch (error) {
    console.error(`      ❌ LLM extraction failed: ${error.message}`);
    return [];
  }
}

/**
 * Insert intelligence records into database
 */
async function insertIntelligence(records) {
  if (records.length === 0) {
    console.log('\n⚠️ No records to insert');
    return;
  }

  console.log(`\n💾 Inserting ${records.length} intelligence records...`);

  try {
    // Insert in batches of 50
    const batchSize = 50;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      await db.insert(market_intelligence).values(batch);
      console.log(`   ✅ Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(records.length / batchSize)}`);
    }

    console.log(`\n✅ Successfully inserted ${records.length} intelligence records`);
  } catch (error) {
    console.error(`\n❌ Database insert failed: ${error.message}`);
    throw error;
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fileArg = args.find(a => a.startsWith('--file='));
  const specificFile = fileArg ? fileArg.split('=')[1] : null;

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           MARKET RESEARCH PARSER                               ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║  Mode: ${dryRun ? 'DRY RUN (no database writes)' : 'LIVE (will insert into database)'}          ║`);
  console.log('╚════════════════════════════════════════════════════════════════╝');

  const allIntelligence = [];

  if (specificFile) {
    // Parse specific file
    const platform = specificFile.includes('/uber/') ? 'uber' : specificFile.includes('/lyft/') ? 'lyft' : 'both';
    const intelligence = await parseDocument(specificFile, platform);
    allIntelligence.push(...intelligence);
  } else {
    // Find all research files
    const platforms = ['uber', 'Lyft'];

    for (const platform of platforms) {
      const platformDir = path.join(PLATFORM_DATA_DIR, platform);
      const researchDir = path.join(platformDir, 'research-findings');

      if (!fs.existsSync(researchDir)) {
        console.log(`\n⚠️ No research-findings directory for ${platform}`);
        continue;
      }

      const files = fs.readdirSync(researchDir).filter(f => f.endsWith('.txt') || f.endsWith('.md'));

      for (const file of files) {
        const filePath = path.join(researchDir, file);
        const intelligence = await parseDocument(filePath, platform.toLowerCase());
        allIntelligence.push(...intelligence);
      }
    }
  }

  console.log(`\n📊 Total intelligence items extracted: ${allIntelligence.length}`);

  // Group by market for summary
  const byMarket = {};
  for (const item of allIntelligence) {
    byMarket[item.market] = (byMarket[item.market] || 0) + 1;
  }
  console.log('\n📈 By Market:');
  for (const [market, count] of Object.entries(byMarket)) {
    console.log(`   ${market}: ${count} items`);
  }

  if (dryRun) {
    console.log('\n🔍 DRY RUN - Sample output (first 3 items):');
    console.log(JSON.stringify(allIntelligence.slice(0, 3), null, 2));
  } else {
    await insertIntelligence(allIntelligence);
  }

  console.log('\n✅ Done!');
}

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
