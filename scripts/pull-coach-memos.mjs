#!/usr/bin/env node
// Materialize confirmed Coach memo rows into the workspace inbox. DATABASE_URL
// is the only selector. Never start the gateway/migrations to run this script.
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
import console from 'node:console';

const inboxPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'coach-inbox.md');
const receipt = id => `<!-- vecto-coach-memo:${id}:exported -->`;
function entry(row) {
  const timestamp = new Date(row.created_at).toISOString().slice(0, 16).replace('T', ' ');
  const files = Array.isArray(row.related_files) ? row.related_files : [];
  const filesLine = files.length ? `\n  - Files: ${files.join(', ')}` : '';
  return `\n### [${row.type.toUpperCase()}] ${row.title}\n- **Priority:** ${row.priority} | **Date:** ${timestamp}\n- ${row.detail}${filesLine}\n${receipt(row.id)}\n`;
}

// The transaction lock serializes exporters reading this database. Append keeps
// unrelated inbox writes intact. A completed file receipt survives rollback, so
// retries do not append it again after a failed status UPDATE/COMMIT.
export async function exportCoachMemos({ pool, targetPath = inboxPath, dryRun = false, files = { appendFile, readFile } }) {
  const client = await pool.connect();
  let began = false;
  try {
    await client.query('BEGIN'); began = true;
    await client.query('SELECT pg_advisory_xact_lock(20260512, 1)');
    const { rows } = await client.query(`SELECT id, type, title, detail, priority, related_files, created_at, source
      FROM coach_memos WHERE status = 'new' ORDER BY created_at ASC FOR UPDATE`);
    let existing;
    try { existing = await files.readFile(targetPath, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; existing = ''; }
    const pending = rows.filter(row => !existing.includes(receipt(row.id)));
    if (dryRun) {
      await client.query('ROLLBACK'); began = false;
      return { selected: rows.length, appended: 0, pending: pending.length, recovered: rows.length - pending.length, dryRun: true };
    }
    // One completed marker per append. If a write reports failure after fully
    // landing, the next run recognizes the marker before changing DB status.
    for (const row of pending) await files.appendFile(targetPath, entry(row), 'utf8');
    if (rows.length) await client.query(
      "UPDATE coach_memos SET status='exported', exported_at=NOW(), updated_at=NOW() WHERE id = ANY($1::uuid[]) AND status='new'",
      [rows.map(row => row.id)]
    );
    await client.query('COMMIT'); began = false;
    return { selected: rows.length, appended: pending.length, recovered: rows.length - pending.length, dryRun: false };
  } catch (error) {
    if (began) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function main({ args = process.argv.slice(2), env = process.env, PoolClass, log = console.log } = {}) {
  if (args.some(arg => !['--help', '-h', '--dry-run'].includes(arg))) {
    throw new Error('Supported options: --dry-run, --help. DATABASE_URL is the only database selector; --dev is no longer supported.');
  }
  if (args.includes('--help') || args.includes('-h')) {
    log('Usage: npm run pull-coach-memos -- [--dry-run]\nUses the supplied DATABASE_URL. Preview reports counts only; no memo contents are logged.');
    return;
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not supplied; no connection attempted.');
  const Provider = PoolClass || (await import('pg')).Pool;
  const pool = new Provider({ connectionString: env.DATABASE_URL });
  try {
    const result = await exportCoachMemos({ pool, dryRun: args.includes('--dry-run') });
    log(result.dryRun
      ? `Preview: ${result.selected} new memo(s), ${result.pending} pending append, ${result.recovered} already receipted. No writes.`
      : `Exported ${result.selected} memo(s): ${result.appended} appended, ${result.recovered} recovered from file receipts.`);
    return result;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`Coach memo export failed: ${error.message}. Completed inbox receipts are retained for retry. Review a partial file write before retrying.`);
    process.exitCode = 1;
  });
}
