// server/db/run-migrations.js
//
// Boot-time schema-parity runner (2026-08-06, Melody's green light).
//
// HISTORY: the original drizzle-kit pipeline died early in the repo's life
// (migrations/manual/0000-0012 are its legacy artifacts; drizzle/ out-dir is
// empty) and was never replaced by anything automated — prod parity was hand
// parity, which silently cost prod the airports + offer_rulesets tables
// (2026-07-06 publish ran a month against a DB missing both). This runner
// closes that gap structurally: a migration file reviewed, merged, and
// published IS the explicit human approval; execution is deterministic.
//
// CONTRACT:
//  - Applies migrations/*.sql (repo root; migrations/manual/ excluded) in
//    filename order, each exactly once, tracked in schema_migrations.
//  - pg advisory lock serializes concurrent instances (Cloud Run autoscale
//    can boot several at once; only one applies, the rest wait then no-op).
//  - BASELINE: on first run, files older than BASELINE_CUTOFF are recorded
//    as applied WITHOUT executing. Both dev and prod verifiably predate-applied
//    them, and re-running old data-cleanup migrations is exactly the hazard
//    we must not automate. Files at/after the cutoff execute if unrecorded —
//    those five were audited for idempotency on 2026-08-06 (app_rules ON
//    CONFLICT, holiday type-guard) so dev's first pass re-executes them
//    harmlessly, which doubles as a rehearsal of prod's first boot.
//  - FAIL LOUD: any error throws → gateway main() catch → exit(1). A bad
//    migration crashes boot visibly instead of letting schema drift silently
//    (Melody chose this tradeoff explicitly).
//  - Checksum drift on an already-applied file logs a loud warning but does
//    NOT re-run (applied history is immutable; fix forward with a new file).
//
// Deliberately dependency-free (raw pg, no drizzle, no app logger) so the
// runner cannot be broken by app-layer changes.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

// Files lexicographically below this executed on both dev and prod before the
// runner existed (verified 2026-08-06: prod ran the pre-20260703 app for
// months; dev state confirmed directly). One-time bootstrapping fact — inert
// once schema_migrations is populated.
const BASELINE_CUTOFF = '20260703';

const ADVISORY_LOCK_KEY = 'vecto_pilot_migrations';

function log(msg) {
  console.log(`[GATEWAY] [MIGRATIONS] ${msg}`);
}

export async function runMigrations({ migrationsDir = DEFAULT_MIGRATIONS_DIR } = {}) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('[MIGRATIONS] DATABASE_URL is required — refusing to boot without a database');
  }

  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort();

  if (files.length === 0) {
    log('no migration files found — nothing to do');
    return { applied: [], baselined: [], skipped: 0 };
  }

  // Same SSL conditional as db-client.js: Helium dev is local/no-SSL,
  // deployment (Neon) requires it.
  const isProduction = process.env.REPLIT_DEPLOYMENT === '1' || process.env.NODE_ENV === 'production';
  const client = new pg.Client({
    connectionString,
    application_name: 'migration-runner',
    ssl: isProduction ? { rejectUnauthorized: false } : false,
  });

  const applied = [];
  const baselined = [];
  let skipped = 0;

  await client.connect();
  try {
    // Serialize against concurrent booting instances. hashtext() is stable
    // per-cluster; the lock is session-scoped and released in finally.
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [ADVISORY_LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        checksum   TEXT NOT NULL,
        baseline   BOOLEAN NOT NULL DEFAULT false,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query('SELECT filename, checksum FROM schema_migrations');
    const recorded = new Map(rows.map((r) => [r.filename, r.checksum]));

    for (const filename of files) {
      const filePath = path.join(migrationsDir, filename);
      const content = await fs.readFile(filePath, 'utf8');
      const checksum = crypto.createHash('sha256').update(content).digest('hex');

      if (recorded.has(filename)) {
        if (recorded.get(filename) !== checksum) {
          console.warn(
            `[GATEWAY] [MIGRATIONS] ⚠️ checksum drift on already-applied ${filename} — ` +
            `NOT re-running (applied history is immutable; fix forward with a new migration file)`
          );
        }
        skipped++;
        continue;
      }

      if (filename < BASELINE_CUTOFF) {
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum, baseline) VALUES ($1, $2, true)',
          [filename, checksum]
        );
        baselined.push(filename);
        continue;
      }

      log(`applying ${filename}...`);
      const started = Date.now();
      try {
        // One simple-query per file: multi-statement scripts run in an
        // implicit transaction (their own BEGIN/COMMIT, where present, is
        // honored); an error aborts the whole file's work.
        await client.query(content);
      } catch (err) {
        throw new Error(`[MIGRATIONS] ${filename} failed: ${err.message}`, { cause: err });
      }
      await client.query(
        'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
        [filename, checksum]
      );
      applied.push(filename);
      log(`applied ${filename} in ${Date.now() - started}ms`);
    }

    if (baselined.length > 0) {
      log(`baselined ${baselined.length} pre-${BASELINE_CUTOFF} file(s) as already-applied (first run)`);
    }
    log(`up to date — ${applied.length} applied, ${baselined.length} baselined, ${skipped} already recorded`);
    return { applied, baselined, skipped };
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [ADVISORY_LOCK_KEY]);
    } catch { /* connection teardown releases session locks anyway */ }
    await client.end();
  }
}
