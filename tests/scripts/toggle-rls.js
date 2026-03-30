#!/usr/bin/env node
/**
 * Toggle Row Level Security (RLS) On/Off
 * 
 * Usage:
 *   npm run rls:enable   - Enable RLS (production)
 *   npm run rls:disable  - Disable RLS (development)
 *   npm run rls:status   - Check RLS status
 * 
 * Location: tests/scripts/toggle-rls.js
 */

import { Pool } from 'pg';
import { readFileSync } from 'fs';

// 2026-02-25: Load DATABASE_URL from .env.local or environment
// Renamed from mono-mode.env to align with project convention
let DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  try {
    const envContent = readFileSync('.env.local', 'utf8');
    const match = envContent.match(/^DATABASE_URL=(.+)$/m);
    if (match) {
      DATABASE_URL = match[1].trim();
    }
  } catch (err) {
    console.error('❌ Could not read .env.local:', err.message);
    process.exit(1);
  }
}

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found in environment or .env.local');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL
});

const TABLES = [
  'snapshots',
  'triad_jobs',
  'venue_feedback',
  'actions',
  'venue_metrics',
  'eidolon_memory',
  'cross_thread_memory',
  'agent_memory',
  'llm_venue_suggestions',
  'http_idem',
  'ranking_candidates',
  'places_cache',
  'strategies',
  'app_feedback',
  'rankings',
  'travel_disruptions',
  'strategy_feedback',
  'venue_catalog',
  'assistant_memory'
];

async function enableRLS() {
  console.log('🔒 Enabling Row Level Security on all tables...\n');
  
  const client = await pool.connect();
  try {
    for (const table of TABLES) {
      await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      console.log(`  ✅ ${table}`);
    }
    
    console.log('\n✅ RLS ENABLED on all 19 tables');
    console.log('🔒 Production security mode: Active\n');
  } finally {
    client.release();
    await pool.end();
  }
}

async function disableRLS() {
  console.log('🔓 Disabling Row Level Security on all tables...\n');
  
  const client = await pool.connect();
  try {
    for (const table of TABLES) {
      await client.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
      console.log(`  ⚠️  ${table}`);
    }
    
    console.log('\n⚠️  RLS DISABLED on all 19 tables');
    console.log('🔓 Development mode: Unrestricted access\n');
    console.log('⚠️  WARNING: Do NOT deploy to production with RLS disabled!\n');
  } finally {
    client.release();
    await pool.end();
  }
}

async function checkStatus() {
  console.log('📊 Checking RLS status...\n');
  
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT tablename, rowsecurity 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      ORDER BY tablename
    `);
    
    const enabled = result.rows.filter(r => r.rowsecurity).length;
    const disabled = result.rows.filter(r => !r.rowsecurity).length;
    
    console.log(`Tables with RLS ENABLED:  ${enabled}/19`);
    console.log(`Tables with RLS DISABLED: ${disabled}/19\n`);
    
    if (enabled === 19) {
      console.log('✅ Status: PRODUCTION READY (All tables secured)');
    } else if (disabled === 19) {
      console.log('⚠️  Status: DEVELOPMENT MODE (No security policies active)');
    } else {
      console.log('⚠️  Status: INCONSISTENT (Some tables protected, some not)');
    }
    
    console.log('\nDetailed Status:');
    result.rows.forEach(row => {
      const icon = row.rowsecurity ? '🔒' : '🔓';
      const status = row.rowsecurity ? 'ENABLED ' : 'DISABLED';
      console.log(`  ${icon} ${row.tablename.padEnd(25)} ${status}`);
    });
    console.log();
  } finally {
    client.release();
    await pool.end();
  }
}

// Parse command line arguments
const command = process.argv[2];

switch (command) {
  case 'enable':
    enableRLS();
    break;
  case 'disable':
    disableRLS();
    break;
  case 'status':
    checkStatus();
    break;
  default:
    console.log(`
Usage:
  npm run rls:enable   - Enable RLS (production mode)
  npm run rls:disable  - Disable RLS (development mode)
  npm run rls:status   - Check current RLS status

Example:
  npm run rls:disable  # For local testing
  npm run rls:enable   # Before deploying to production
    `);
    process.exit(1);
}
