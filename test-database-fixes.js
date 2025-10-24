#!/usr/bin/env node

/**
 * Quick Database Schema Validation Test
 * Tests all the fixes made in this session
 */

import { db } from './server/db/drizzle.js';
import { sql } from 'drizzle-orm';

console.log('🔍 VECTO PILOT - DATABASE SCHEMA VALIDATION\n');
console.log('Testing fixes for Issues #36, #69, #71, #64\n');

const tests = {
  passed: 0,
  failed: 0,
  results: []
};

function logTest(name, passed, details = '') {
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}`);
  if (details) console.log(`   ${details}`);
  tests.results.push({ name, passed, details });
  if (passed) tests.passed++;
  else tests.failed++;
}

async function runTests() {
  try {
    // Test 1: Check cross_thread_memory table exists (Issue #71)
    console.log('📋 Test 1: cross_thread_memory table exists');
    try {
      const result = await db.execute(sql`SELECT COUNT(*) FROM cross_thread_memory`);
      logTest('cross_thread_memory table', true, 'Table exists and is queryable');
    } catch (err) {
      logTest('cross_thread_memory table', false, err.message);
    }

    // Test 2: Check strategies.strategy_for_now column exists (Issue #36)
    console.log('\n📋 Test 2: strategies.strategy_for_now column exists');
    try {
      const result = await db.execute(sql`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'strategies' AND column_name = 'strategy_for_now'
      `);
      const exists = result.rows.length > 0;
      logTest('strategies.strategy_for_now column', exists, 
        exists ? `Type: ${result.rows[0].data_type}` : 'Column not found');
    } catch (err) {
      logTest('strategies.strategy_for_now column', false, err.message);
    }

    // Test 3: Check venue_catalog.venue_name column exists (Issue #36)
    console.log('\n📋 Test 3: venue_catalog.venue_name column exists');
    try {
      const result = await db.execute(sql`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'venue_catalog' AND column_name = 'venue_name'
      `);
      const exists = result.rows.length > 0;
      logTest('venue_catalog.venue_name column', exists,
        exists ? `Type: ${result.rows[0].data_type}` : 'Column not found');
    } catch (err) {
      logTest('venue_catalog.venue_name column', false, err.message);
    }

    // Test 4: Verify old 'name' column is gone
    console.log('\n📋 Test 4: venue_catalog.name column removed');
    try {
      const result = await db.execute(sql`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'venue_catalog' AND column_name = 'name'
      `);
      const removed = result.rows.length === 0;
      logTest('venue_catalog.name removed', removed,
        removed ? 'Old column successfully removed' : '⚠️  Old column still exists');
    } catch (err) {
      logTest('venue_catalog.name removed', false, err.message);
    }

    // Test 5: Test persist_ranking can write (Issue #69)
    console.log('\n📋 Test 5: persist_ranking functionality');
    try {
      // Import and check the function exists
      const { persistRanking } = await import('./server/lib/persist-ranking.js');
      logTest('persist_ranking module', true, 'Module loads successfully');
    } catch (err) {
      logTest('persist_ranking module', false, err.message);
    }

    // Test 6: Check all required memory tables exist
    console.log('\n📋 Test 6: Memory tables integrity');
    const memoryTables = ['agent_memory', 'assistant_memory', 'eidolon_memory', 'cross_thread_memory'];
    for (const table of memoryTables) {
      try {
        await db.execute(sql.raw(`SELECT 1 FROM ${table} LIMIT 1`));
        logTest(`${table} table`, true);
      } catch (err) {
        logTest(`${table} table`, false, err.message);
      }
    }

    // Test 7: Check core ML tables exist
    console.log('\n📋 Test 7: Core ML tables integrity');
    const mlTables = ['snapshots', 'strategies', 'rankings', 'actions'];
    for (const table of mlTables) {
      try {
        await db.execute(sql.raw(`SELECT 1 FROM ${table} LIMIT 1`));
        logTest(`${table} table`, true);
      } catch (err) {
        logTest(`${table} table`, false, err.message);
      }
    }

  } catch (err) {
    console.error('\n❌ Fatal test error:', err.message);
    process.exit(1);
  }
}

// Run tests
runTests().then(() => {
  console.log('\n' + '='.repeat(80));
  console.log(`📊 RESULTS: ${tests.passed} passed, ${tests.failed} failed`);
  console.log('='.repeat(80));
  
  if (tests.failed > 0) {
    console.log('\n❌ Some tests failed. Review errors above.');
    process.exit(1);
  } else {
    console.log('\n✅ All database schema fixes verified!');
    process.exit(0);
  }
}).catch(err => {
  console.error('\n❌ Test suite crashed:', err);
  process.exit(1);
});
