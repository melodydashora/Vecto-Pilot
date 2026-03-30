/**
 * test-snapshot-workflow.js
 *
 * Watches for the next real snapshot. Outputs:
 *   - The old snapshot_id that was active before
 *   - When it was released (users.current_snapshot_id set to null)
 *   - The new snapshot row (every column, full IDs)
 *   - Time between release and new creation
 *
 * Runs on server boot or standalone.
 *
 * 2026-02-17: Created for workflow verification
 */

import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TIMEOUT_S = 300; // 5 min — user might take a while to log in
const POLL_MS = 500;
const OUTPUT_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'snapshot.txt'
);

let lines = [];

function out(line = '') {
  lines.push(line);
  console.log(`[snapshot-observer] ${line}`);
}

function writeFile() {
  try { fs.writeFileSync(OUTPUT_FILE, lines.join('\n') + '\n', 'utf-8'); }
  catch (err) { console.error(`[snapshot-observer] Write failed: ${err.message}`); }
}

function formatVal(val) {
  if (val === null || val === undefined) return 'null';
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object') return JSON.stringify(val, null, 2);
  return String(val);
}

function printRow(row) {
  const keys = Object.keys(row);
  const maxKey = Math.max(...keys.map(k => k.length));
  for (const key of keys) {
    const val = formatVal(row[key]);
    if (val.includes('\n')) {
      out(`  ${key.padEnd(maxKey)}  ┐`);
      for (const line of val.split('\n')) {
        out(`  ${''.padEnd(maxKey)}  │ ${line}`);
      }
    } else {
      out(`  ${key.padEnd(maxKey)}  ${val}`);
    }
  }
}

export async function observeSnapshotWorkflow() {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    console.error('[snapshot-observer] No DATABASE_URL — skipping');
    return;
  }

  lines = [];

  let client;
  try {
    // 2026-02-26: SSL conditional — Helium (dev) runs locally without SSL
    const isProduction = process.env.REPLIT_DEPLOYMENT === '1' || process.env.NODE_ENV === 'production';
    client = new pg.Client({ connectionString: connStr, application_name: 'snap-observer', ssl: isProduction ? { rejectUnauthorized: false } : false });
    await client.connect();
  } catch (err) {
    console.error(`[snapshot-observer] DB connect failed: ${err.message}`);
    return;
  }

  out(`SNAPSHOT WORKFLOW OBSERVER — ${new Date().toISOString()}`);
  out(`${'═'.repeat(60)}`);

  // ── Capture the current state ──────────────────────────────────────────────

  // Get the current user and their active snapshot
  const userResult = await client.query(`
    SELECT user_id, current_snapshot_id, session_id, last_active_at
    FROM users ORDER BY last_active_at DESC LIMIT 1
  `);
  const currentUser = userResult.rows[0];

  const oldSnapshotId = currentUser?.current_snapshot_id;
  out('');
  out(`BEFORE (server boot)`);
  out(`${'─'.repeat(60)}`);
  out(`  user_id                 ${currentUser?.user_id || 'no users'}`);
  out(`  current_snapshot_id     ${oldSnapshotId || 'null (already released)'}`);
  out(`  session_id              ${currentUser?.session_id || 'null'}`);
  out(`  last_active_at          ${currentUser?.last_active_at?.toISOString() || 'null'}`);

  if (oldSnapshotId) {
    const oldSnap = await client.query(
      'SELECT created_at, city, state, timezone FROM snapshots WHERE snapshot_id = $1',
      [oldSnapshotId]
    );
    if (oldSnap.rows[0]) {
      const age = ((Date.now() - new Date(oldSnap.rows[0].created_at).getTime()) / 60000).toFixed(1);
      out(`  old snapshot city       ${oldSnap.rows[0].city}, ${oldSnap.rows[0].state}`);
      out(`  old snapshot age        ${age} min`);
    }
  }

  writeFile();

  // ── Poll: watch for current_snapshot_id to change ──────────────────────────

  out('');
  out(`Waiting for snapshot change...`);
  out(`  (log in → GPS resolves → new snapshot created)`);
  writeFile();

  let releaseDetectedAt = null;
  let wasReleased = !oldSnapshotId; // If already null, it's already released
  let newSnapshotId = null;
  const start = Date.now();

  while (Date.now() - start < TIMEOUT_S * 1000) {
    try {
      const r = await client.query(`
        SELECT current_snapshot_id FROM users
        WHERE user_id = $1
      `, [currentUser.user_id]);

      const currentId = r.rows[0]?.current_snapshot_id;

      // Detect release (transition to null)
      if (!wasReleased && currentId === null) {
        releaseDetectedAt = new Date();
        wasReleased = true;
        out(`[${releaseDetectedAt.toISOString().slice(11, 23)}] OLD SNAPSHOT RELEASED (current_snapshot_id → null)`);
        writeFile();
      }

      // Detect new snapshot (transition from null or old to new)
      if (currentId && currentId !== oldSnapshotId) {
        newSnapshotId = currentId;
        out(`[${new Date().toISOString().slice(11, 23)}] NEW SNAPSHOT DETECTED: ${newSnapshotId}`);
        break;
      }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, POLL_MS));
  }

  if (!newSnapshotId) {
    out(`No new snapshot within ${TIMEOUT_S}s`);
    writeFile();
    try { await client.end(); } catch {}
    return;
  }

  // ── Fetch the full new snapshot row ────────────────────────────────────────

  const snapResult = await client.query('SELECT * FROM snapshots WHERE snapshot_id = $1', [newSnapshotId]);
  const snap = snapResult.rows[0];

  if (!snap) {
    out('Snapshot row not found');
    writeFile();
    try { await client.end(); } catch {}
    return;
  }

  out('');
  out(`NEW SNAPSHOT`);
  out(`${'═'.repeat(60)}`);
  printRow(snap);

  // ── Timing ─────────────────────────────────────────────────────────────────

  out('');
  out(`TIMING`);
  out(`${'─'.repeat(60)}`);

  if (oldSnapshotId) {
    const oldSnap = await client.query('SELECT created_at FROM snapshots WHERE snapshot_id = $1', [oldSnapshotId]);
    if (oldSnap.rows[0]) {
      out(`  Old snapshot created:   ${oldSnap.rows[0].created_at.toISOString()}`);
    }
  }

  if (releaseDetectedAt) {
    out(`  Old snapshot released:  ${releaseDetectedAt.toISOString()}`);
  } else if (wasReleased) {
    out(`  Old snapshot released:  (was already null at boot)`);
  } else {
    out(`  Old snapshot released:  NOT DETECTED (may have been replaced directly)`);
  }

  out(`  New snapshot created:   ${snap.created_at.toISOString()}`);

  if (releaseDetectedAt) {
    const gapMs = new Date(snap.created_at).getTime() - releaseDetectedAt.getTime();
    out(`  Release → Create gap:   ${(gapMs / 1000).toFixed(1)}s`);
  }

  if (oldSnapshotId) {
    // Check if old snapshot still exists (not deleted)
    const oldExists = await client.query('SELECT snapshot_id FROM snapshots WHERE snapshot_id = $1', [oldSnapshotId]);
    out(`  Old snapshot row:       ${oldExists.rows.length > 0 ? 'STILL IN DB (not deleted, just dereferenced)' : 'DELETED'}`);
  }

  writeFile();
  try { await client.end(); } catch {}
}

// ─── Standalone ──────────────────────────────────────────────────────────────

const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const kill = setTimeout(() => { writeFile(); process.exit(1); }, (TIMEOUT_S + 10) * 1000);
  kill.unref();
  observeSnapshotWorkflow().then(() => process.exit(0)).catch(err => {
    console.error(`[snapshot-observer] Fatal: ${err.message}`);
    writeFile();
    process.exit(1);
  });
}
