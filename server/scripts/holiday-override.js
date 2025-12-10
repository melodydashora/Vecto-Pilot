#!/usr/bin/env node
/**
 * Holiday Override Management Script
 *
 * Usage:
 *   node server/scripts/holiday-override.js list                    # List all overrides
 *   node server/scripts/holiday-override.js add "Happy Holidays" "2024-12-01" "2026-01-02"
 *   node server/scripts/holiday-override.js remove <id>             # Remove by ID
 *   node server/scripts/holiday-override.js enable                  # Enable override system
 *   node server/scripts/holiday-override.js disable                 # Disable override system
 *   node server/scripts/holiday-override.js test                    # Test current detection
 *
 * Options for add:
 *   --priority <n>       Set priority (higher wins, default: 10)
 *   --no-supersede       Don't let actual holidays override this
 *   --id <custom-id>     Set custom ID instead of auto-generated
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_PATH = join(__dirname, '../config/holiday-override.json');

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    return { active: true, overrides: [] };
  }
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
}

function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log(`\n✅ Config saved to: ${CONFIG_PATH}`);
}

function listOverrides() {
  const config = loadConfig();
  console.log('\n📋 Holiday Override Configuration');
  console.log('─'.repeat(60));
  console.log(`System Status: ${config.active ? '✅ ENABLED' : '❌ DISABLED'}`);
  console.log('─'.repeat(60));

  if (config.overrides.length === 0) {
    console.log('No overrides configured.');
    return;
  }

  const now = new Date();

  for (const override of config.overrides) {
    const start = new Date(override.start_date);
    const end = new Date(override.end_date);
    const isActive = now >= start && now <= end;
    const status = isActive ? '🟢 ACTIVE' : (now < start ? '⏳ PENDING' : '⏹️ EXPIRED');

    console.log(`\n[${override.id}] ${override.holiday_name}`);
    console.log(`  Status: ${status}`);
    console.log(`  Period: ${start.toLocaleDateString()} → ${end.toLocaleDateString()}`);
    console.log(`  Priority: ${override.priority || 10}`);
    console.log(`  Superseded by actual: ${override.superseded_by_actual !== false ? 'Yes' : 'No'}`);
    if (override.notes) {
      console.log(`  Notes: ${override.notes}`);
    }
  }
  console.log('\n');
}

function addOverride(args) {
  const [holidayName, startDate, endDate] = args;

  if (!holidayName || !startDate || !endDate) {
    console.error('❌ Usage: add <holiday_name> <start_date> <end_date>');
    console.error('   Example: add "Happy Holidays" "2024-12-01" "2026-01-02"');
    process.exit(1);
  }

  // Parse optional flags
  const priorityIdx = args.indexOf('--priority');
  const priority = priorityIdx !== -1 ? parseInt(args[priorityIdx + 1], 10) : 10;

  const noSupersede = args.includes('--no-supersede');

  const idIdx = args.indexOf('--id');
  const customId = idIdx !== -1 ? args[idIdx + 1] : null;

  const config = loadConfig();

  // Generate ID
  const id = customId || `${holidayName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;

  // Parse dates
  let start, end;
  try {
    start = new Date(startDate);
    end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error('Invalid date');
    }
    // Set end to end of day if no time specified
    if (!endDate.includes('T')) {
      end.setHours(23, 59, 59, 999);
    }
  } catch {
    console.error('❌ Invalid date format. Use YYYY-MM-DD or ISO 8601.');
    process.exit(1);
  }

  const newOverride = {
    id,
    holiday_name: holidayName,
    start_date: start.toISOString(),
    end_date: end.toISOString(),
    priority,
    superseded_by_actual: !noSupersede,
    notes: `Added via CLI on ${new Date().toISOString()}`
  };

  config.overrides.push(newOverride);
  saveConfig(config);

  console.log(`\n✅ Added holiday override:`);
  console.log(`   ID: ${id}`);
  console.log(`   Holiday: ${holidayName}`);
  console.log(`   Period: ${start.toLocaleDateString()} → ${end.toLocaleDateString()}`);
  console.log(`   Priority: ${priority}`);
  console.log(`   Superseded by actual holidays: ${!noSupersede}`);
}

function removeOverride(id) {
  if (!id) {
    console.error('❌ Usage: remove <override_id>');
    process.exit(1);
  }

  const config = loadConfig();
  const idx = config.overrides.findIndex(o => o.id === id);

  if (idx === -1) {
    console.error(`❌ Override not found: ${id}`);
    process.exit(1);
  }

  const removed = config.overrides.splice(idx, 1)[0];
  saveConfig(config);

  console.log(`\n✅ Removed override: ${removed.holiday_name} (${id})`);
}

function setEnabled(enabled) {
  const config = loadConfig();
  config.active = enabled;
  saveConfig(config);
  console.log(`\n✅ Holiday override system ${enabled ? 'ENABLED' : 'DISABLED'}`);
}

async function testDetection() {
  console.log('\n🧪 Testing Holiday Detection');
  console.log('─'.repeat(60));

  try {
    const { detectHoliday } = await import('../lib/holiday-detector.js');

    const testContext = {
      created_at: new Date().toISOString(),
      city: 'Dallas',
      state: 'Texas',
      country: 'United States',
      timezone: 'America/Chicago'
    };

    console.log(`Test Date: ${new Date().toLocaleDateString()}`);
    console.log(`Location: ${testContext.city}, ${testContext.state}`);
    console.log('─'.repeat(60));

    const result = await detectHoliday(testContext);

    console.log(`\nResult:`);
    console.log(`  Holiday: ${result.holiday}`);
    console.log(`  Is Holiday: ${result.is_holiday}`);

    if (result.is_holiday && result.holiday !== 'none') {
      console.log(`\n🎉 Banner will display: "Happy ${result.holiday}!"`);
    } else {
      console.log(`\n📌 Default driver greeting will be displayed (Good morning/afternoon/evening, driver!)`);
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Main
const [,, command, ...args] = process.argv;

switch (command) {
  case 'list':
  case 'ls':
    listOverrides();
    break;

  case 'add':
    addOverride(args);
    break;

  case 'remove':
  case 'rm':
  case 'delete':
    removeOverride(args[0]);
    break;

  case 'enable':
    setEnabled(true);
    break;

  case 'disable':
    setEnabled(false);
    break;

  case 'test':
    testDetection();
    break;

  default:
    console.log(`
Holiday Override Management Script

Commands:
  list                    List all overrides
  add <name> <start> <end> Add new override
      --priority <n>      Set priority (default: 10, higher wins)
      --no-supersede      Don't let actual holidays override this
      --id <custom-id>    Set custom ID
  remove <id>             Remove override by ID
  enable                  Enable override system
  disable                 Disable override system
  test                    Test current holiday detection

Examples:
  node server/scripts/holiday-override.js list
  node server/scripts/holiday-override.js add "Happy Holidays" "2024-12-01" "2026-01-02"
  node server/scripts/holiday-override.js add "Spring Sale" "2025-03-01" "2025-03-15" --priority 5
  node server/scripts/holiday-override.js remove happy-holidays-2024-2025
  node server/scripts/holiday-override.js test
`);
}
