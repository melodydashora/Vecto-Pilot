// tests/coach-schema.test.js
// Tests for AI Coach schema metadata endpoint
// Created: 2026-01-05

import {
  coachSchemaMetadata,
  formatSchemaForPrompt
} from '../server/api/coach/schema.js';

async function testSchema() {
  console.log('[coach-schema] Starting schema metadata tests...');
  let passed = 0;
  let failed = 0;

  // Helper to run test
  const test = (name, fn) => {
    try {
      fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (err) {
      console.log(`  ❌ ${name}: ${err.message}`);
      failed++;
    }
  };

  const assert = (condition, msg) => {
    if (!condition) throw new Error(msg);
  };

  // ============================================================================
  // Schema Structure
  // ============================================================================
  console.log('\n[coach-schema] Testing schema structure...');

  test('schema has readable_tables', () => {
    assert(coachSchemaMetadata.readable_tables, 'Should have readable_tables');
    assert(typeof coachSchemaMetadata.readable_tables === 'object', 'Should be an object');
  });

  test('schema has writable_tables', () => {
    assert(coachSchemaMetadata.writable_tables, 'Should have writable_tables');
    assert(typeof coachSchemaMetadata.writable_tables === 'object', 'Should be an object');
  });

  test('schema has relationships', () => {
    assert(coachSchemaMetadata.relationships, 'Should have relationships');
    assert(Array.isArray(coachSchemaMetadata.relationships), 'Should be an array');
  });

  test('schema has scoping rules', () => {
    assert(coachSchemaMetadata.scoping, 'Should have scoping');
    assert(coachSchemaMetadata.scoping.user_data, 'Should have user_data scope');
  });

  // ============================================================================
  // Readable Tables
  // ============================================================================
  console.log('\n[coach-schema] Testing readable tables...');

  const requiredReadableTables = [
    'snapshots',
    'strategies',
    'briefings',
    'discovered_events',
    'venue_catalog',
    'ranking_candidates',
    'market_intelligence',
    'zone_intelligence',
    'driver_profiles',
    'driver_vehicles',
    'user_intel_notes'
  ];

  for (const table of requiredReadableTables) {
    test(`readable_tables includes ${table}`, () => {
      const tableInfo = coachSchemaMetadata.readable_tables[table];
      assert(tableInfo, `Should include ${table}`);
      assert(tableInfo.description, 'Should have description');
      assert(Array.isArray(tableInfo.key_columns), 'Should have key_columns array');
      assert(tableInfo.key_columns.length > 0, 'Should have at least one key column');
    });
  }

  // ============================================================================
  // Writable Tables
  // ============================================================================
  console.log('\n[coach-schema] Testing writable tables...');

  const requiredWritableTables = [
    'user_intel_notes',
    'discovered_events',
    'zone_intelligence',
    'coach_conversations',
    'coach_system_notes',
    'news_deactivations'
  ];

  for (const table of requiredWritableTables) {
    test(`writable_tables includes ${table}`, () => {
      const tableInfo = coachSchemaMetadata.writable_tables[table];
      assert(tableInfo, `Should include ${table}`);
      assert(tableInfo.description, 'Should have description');
    });
  }

  // ============================================================================
  // Action Tags
  // ============================================================================
  console.log('\n[coach-schema] Testing action tags...');

  test('user_intel_notes has SAVE_NOTE action tag', () => {
    const tag = coachSchemaMetadata.writable_tables.user_intel_notes.action_tag;
    assert(tag === '[SAVE_NOTE: {...}]', 'Should have SAVE_NOTE tag');
  });

  test('discovered_events has action_tags array', () => {
    const tags = coachSchemaMetadata.writable_tables.discovered_events.action_tags;
    assert(Array.isArray(tags), 'Should have action_tags array');
    assert(tags.includes('[DEACTIVATE_EVENT: {...}]'), 'Should include DEACTIVATE_EVENT');
    assert(tags.includes('[REACTIVATE_EVENT: {...}]'), 'Should include REACTIVATE_EVENT');
  });

  test('zone_intelligence has ZONE_INTEL action tag', () => {
    const tag = coachSchemaMetadata.writable_tables.zone_intelligence.action_tag;
    assert(tag === '[ZONE_INTEL: {...}]', 'Should have ZONE_INTEL tag');
  });

  test('coach_system_notes has SYSTEM_NOTE action tag', () => {
    const tag = coachSchemaMetadata.writable_tables.coach_system_notes.action_tag;
    assert(tag === '[SYSTEM_NOTE: {...}]', 'Should have SYSTEM_NOTE tag');
  });

  // ============================================================================
  // Field Definitions
  // ============================================================================
  console.log('\n[coach-schema] Testing field definitions...');

  test('user_intel_notes has fields definition', () => {
    const fields = coachSchemaMetadata.writable_tables.user_intel_notes.fields;
    assert(fields, 'Should have fields');
    assert(fields.note_type, 'Should have note_type field');
    assert(fields.title, 'Should have title field');
    assert(fields.content, 'Should have content field');
  });

  test('zone_intelligence has fields definition', () => {
    const fields = coachSchemaMetadata.writable_tables.zone_intelligence.fields;
    assert(fields, 'Should have fields');
    assert(fields.zone_type, 'Should have zone_type field');
    assert(fields.market_slug, 'Should have market_slug field');
  });

  // ============================================================================
  // Prompt Formatting
  // ============================================================================
  console.log('\n[coach-schema] Testing prompt formatting...');

  test('formatSchemaForPrompt returns string', () => {
    const prompt = formatSchemaForPrompt(coachSchemaMetadata);
    assert(typeof prompt === 'string', 'Should return string');
    assert(prompt.length > 100, 'Should be substantial');
  });

  test('formatted prompt contains DATABASE SCHEMA AWARENESS', () => {
    const prompt = formatSchemaForPrompt(coachSchemaMetadata);
    assert(prompt.includes('DATABASE SCHEMA AWARENESS'), 'Should have header');
  });

  test('formatted prompt lists readable tables', () => {
    const prompt = formatSchemaForPrompt(coachSchemaMetadata);
    assert(prompt.includes('snapshots'), 'Should list snapshots');
    assert(prompt.includes('strategies'), 'Should list strategies');
    assert(prompt.includes('user_intel_notes'), 'Should list user_intel_notes');
  });

  test('formatted prompt lists writable tables with action tags', () => {
    const prompt = formatSchemaForPrompt(coachSchemaMetadata);
    assert(prompt.includes('SAVE_NOTE'), 'Should mention SAVE_NOTE');
    assert(prompt.includes('DEACTIVATE_EVENT'), 'Should mention DEACTIVATE_EVENT');
  });

  test('formatted prompt includes data scoping info', () => {
    const prompt = formatSchemaForPrompt(coachSchemaMetadata);
    assert(prompt.includes('user_id'), 'Should mention user_id filtering');
    assert(prompt.includes('Market intel'), 'Should mention market intel');
  });

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('\n[coach-schema] ================================');
  console.log(`[coach-schema] Tests: ${passed + failed} total`);
  console.log(`[coach-schema] Passed: ${passed}`);
  console.log(`[coach-schema] Failed: ${failed}`);
  console.log('[coach-schema] ================================');

  return { ok: failed === 0, passed, failed };
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testSchema().then(result => {
    process.exit(result.ok ? 0 : 1);
  });
}

export default testSchema;
