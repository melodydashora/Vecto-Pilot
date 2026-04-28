#!/usr/bin/env node
// scripts/p3-13-prod-recheck.mjs
//
// Re-run the P3-13 trigger check against PRODUCTION (Neon) instead of dev
// (Replit Helium). The audit-fix-2026-04-25 session ran this only against
// dev — none of the 6 watch-list tables were 0 in dev, so catch-block
// instrumentation was not triggered. Per Rule 13, dev/prod have isolated
// data, so the prod state must be verified independently.
//
// Usage:
//   PROD_DATABASE_URL='postgres://…neon.tech…' node scripts/p3-13-prod-recheck.mjs
//
// Exit codes:
//   0  — all 6 watch-list tables are non-zero in prod (instrumentation NOT needed)
//   1  — usage error / connection error / unrecognized DB host
//   2  — at least one watch-list table is 0 (instrumentation IS needed); the
//        empty list is logged and the script exits non-zero so CI can gate
//
// Refuses to run unless PROD_DATABASE_URL contains 'neon.tech', so that
// nobody accidentally points it at the dev Helium DB.

import { Client } from 'pg';

const WATCH_LIST = [
  'users',
  'snapshots',
  'strategies',
  'briefings',
  'rankings',
  'triad_jobs',
];

const url = process.env.PROD_DATABASE_URL;

if (!url) {
  console.error('[AGENT] FATAL: PROD_DATABASE_URL is not set.');
  console.error('  Pass it explicitly: PROD_DATABASE_URL=postgres://… node scripts/p3-13-prod-recheck.mjs');
  process.exit(1);
}

if (!url.includes('neon.tech')) {
  console.error('[AGENT] FATAL: PROD_DATABASE_URL does not look like a Neon URL.');
  console.error('  Refusing to run against any host that is not neon.tech (per Rule 13, prod is Neon serverless).');
  console.error('  Got:', url.replace(/:[^:@/]*@/, ':***@'));
  process.exit(1);
}

const client = new Client({ connectionString: url });

try {
  await client.connect();
  console.log('[AGENT] Connected to Neon prod. Querying COUNT(*) on watch list…');
} catch (err) {
  console.error('[AGENT] FATAL: connection failed:', err.message);
  process.exit(1);
}

const counts = {};
const empty = [];

for (const table of WATCH_LIST) {
  try {
    // Identifier comes from a hard-coded constant array — not user input.
    const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
    const n = rows[0]?.n ?? 0;
    counts[table] = n;
    if (n === 0) empty.push(table);
  } catch (err) {
    console.error(`[AGENT] query failed for ${table}: ${err.message}`);
    counts[table] = null;
  }
}

await client.end();

console.log('[AGENT] Counts:');
for (const [table, n] of Object.entries(counts)) {
  console.log(`  ${table.padEnd(16)} ${n === null ? 'ERROR' : n}`);
}

if (empty.length === 0) {
  console.log('[AGENT] All watch-list tables non-zero. Catch-block instrumentation NOT triggered.');
  process.exit(0);
}

console.log('');
console.log('[AGENT] EMPTY tables (instrumentation IS needed):');
for (const table of empty) {
  console.log(`  - ${table}`);
}
console.log('');
console.log('Per Melody\'s P3-13 directive: instrument every catch block on the insert path');
console.log('for the empty tables above with a console.error or pino log including the table');
console.log('name and error.message. Do not change behavior, just stop silent failures.');

process.exit(2);
