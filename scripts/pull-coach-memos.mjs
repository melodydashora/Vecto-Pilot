#!/usr/bin/env node
// 2026-05-12: Operator-only script — reads PROD_DATABASE_URL (per CLAUDE.md Rule 18 documented
// exception for operator scripts), pulls coach_memos rows where status='new', appends them to
// docs/coach-inbox.md in the existing markdown format, then UPDATES the rows to status='exported',
// exported_at=NOW().
//
// Background:
//   - Plan:  docs/review-queue/PLAN_coach-memo-db-route-and-workspace-pull-2026-05-12.md
//   - Audit: docs/architecture/audits/pass-f-issue-logging-survivability.md
//
// Usage:
//   PROD_DATABASE_URL='postgresql://...' npm run pull-coach-memos          # prod (default)
//   npm run pull-coach-memos -- --dev                                      # pull from $DATABASE_URL (workspace Helium)
//   npm run pull-coach-memos -- --dry-run                                  # show what would happen, write nothing
//   npm run pull-coach-memos -- --help                                     # this usage
//
// Exit codes:
//   0 — success (0 or more rows exported)
//   1 — config error (missing DB URL, etc.)
//   2 — file write failure (DB rows NOT marked exported, safe to retry)
//   3 — DB status-update failure after file write (file has them, DB still says new — manual fix needed)

import { Pool } from 'pg';
import { appendFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inboxPath = path.join(__dirname, '..', 'docs', 'coach-inbox.md');

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`\nUsage:\n  PROD_DATABASE_URL='...' npm run pull-coach-memos        # prod (default)\n  npm run pull-coach-memos -- --dev                       # workspace Helium DB\n  npm run pull-coach-memos -- --dry-run                   # preview, no writes\n  npm run pull-coach-memos -- --help                      # this help\n\nReads coach_memos rows with status='new', appends them to docs/coach-inbox.md,\nthen marks them status='exported', exported_at=NOW().\n`);
  process.exit(0);
}

const isDev = args.includes('--dev');
const isDryRun = args.includes('--dry-run');
const connString = isDev ? process.env.DATABASE_URL : process.env.PROD_DATABASE_URL;

if (!connString) {
  if (isDev) {
    console.error('✗ DATABASE_URL not set in this shell.');
    console.error('  Workspace shells normally have it auto-injected — check that you sourced .env.local or are inside the Replit workspace.');
  } else {
    console.error('✗ PROD_DATABASE_URL not set in this shell.');
    console.error('  Set it explicitly to read from Neon prod, or pass --dev to read from the workspace DB.');
    console.error('  Example: PROD_DATABASE_URL="postgresql://..." npm run pull-coach-memos');
  }
  process.exit(1);
}

const pool = new Pool({
  connectionString: connString,
  // Helium = local-no-SSL, Neon = SSL required (canonical pattern at server/db/db-client.js per Rule 18)
  ssl: isDev ? false : { rejectUnauthorized: false },
});

const label = isDev ? 'dev' : 'prod';

try {
  const { rows } = await pool.query(`
    SELECT id, type, title, detail, priority, related_files, created_at, source
    FROM coach_memos
    WHERE status = 'new'
    ORDER BY created_at ASC
  `);

  if (rows.length === 0) {
    console.log(`✓ No new memos to export from ${label} DB. Inbox is current.`);
    process.exit(0);
  }

  console.log(`Found ${rows.length} new memo(s) to export from ${label} DB.`);

  let payload = '';
  for (const row of rows) {
    const timestamp = new Date(row.created_at).toISOString().slice(0, 16).replace('T', ' ');
    const files = Array.isArray(row.related_files) ? row.related_files : [];
    const filesLine = files.length ? `\n  - Files: ${files.join(', ')}` : '';
    payload += `\n### [${row.type.toUpperCase()}] ${row.title}\n`;
    payload += `- **Priority:** ${row.priority} | **Date:** ${timestamp}\n`;
    payload += `- ${row.detail}${filesLine}\n`;
  }

  if (isDryRun) {
    console.log('--- DRY RUN — would append the following to docs/coach-inbox.md ---');
    console.log(payload);
    console.log('--- end dry run; DB rows untouched ---');
    process.exit(0);
  }

  try {
    await appendFile(inboxPath, payload, 'utf-8');
    console.log(`✓ Appended ${rows.length} memo(s) to ${inboxPath}`);
  } catch (fsErr) {
    console.error(`✗ Failed to write to ${inboxPath}: ${fsErr.message}`);
    console.error('  DB rows NOT marked exported — safe to retry.');
    process.exit(2);
  }

  try {
    const ids = rows.map(r => r.id);
    await pool.query(
      `UPDATE coach_memos SET status='exported', exported_at=NOW(), updated_at=NOW() WHERE id = ANY($1::uuid[])`,
      [ids]
    );
    console.log(`✓ Marked ${rows.length} DB row(s) as exported.`);
  } catch (dbErr) {
    console.error(`✗ FS write succeeded but DB status update failed: ${dbErr.message}`);
    console.error('  Memos are IN the file but still say status=new in DB.');
    console.error(`  Affected ids: ${rows.map(r => r.id).join(', ')}`);
    console.error(`  Manual fix:`);
    console.error(`    psql "$${isDev ? 'DATABASE_URL' : 'PROD_DATABASE_URL'}" -c "UPDATE coach_memos SET status='exported', exported_at=NOW() WHERE id IN (${rows.map(r => `'${r.id}'`).join(', ')});"`);
    process.exit(3);
  }

  console.log('');
  console.log('Next step: review the diff and commit:');
  console.log('  git diff docs/coach-inbox.md');
  console.log('  git add docs/coach-inbox.md');
  console.log(`  git commit -m "docs(coach-inbox): pull ${rows.length} memo(s) from ${label} DB"`);
} catch (err) {
  console.error(`✗ Unexpected error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
} finally {
  await pool.end();
}
