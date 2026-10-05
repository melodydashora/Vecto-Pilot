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
//  - BASELINE FILE (2026-09-13): migrations/00000_baseline.sql is a full
//    pg_dump of the schema carrying a `-- BASELINE_THROUGH: <file>` marker.
//    On an EMPTY database (no public.snapshots or ledger rows) it is executed;
//    covered schema files are recorded without replay. The reviewed airport seed
//    executes separately inside the same bootstrap transaction. On an existing
//    database it is recorded as baselined and never executed. This is the only
//    path from an empty database to the real schema (38 tables have no other
//    CREATE DDL in the repo — DB_SCHEMA_EVALUATION_2026-09-13 §1.1).
//
// 2026-10-04: fresh bootstrap commits schema, the reviewed airport identity
// seed and every covered ledger row together. Partial executed baselines and
// unledgered existing schemas fail before any legacy replay. Historical app_rules
// are deliberately NOT seeded: the old file contains superseded product rules.
// Existing complete ledgers and ordinary later migrations keep their behavior.
//
// Deliberately dependency-free (raw pg, no drizzle, no app logger) so the
// runner cannot be broken by app-layer changes.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { databaseConnectionConfig } from './connection-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

// Files lexicographically below this executed on both dev and prod before the
// runner existed (verified 2026-08-06: prod ran the pre-20260703 app for
// months; dev state confirmed directly). One-time bootstrapping fact — inert
// once schema_migrations is populated.
const BASELINE_CUTOFF = '20260703';

const ADVISORY_LOCK_KEY = 'vecto_pilot_migrations';
const BASELINE_FILE = '00000_baseline.sql';
const BASELINE_THROUGH_RE = /^--\s*BASELINE_THROUGH:\s*(\S+)/m;

// Reviewed immutable inputs for fresh initialization only. Pinning both files
// prevents a changed dump (including transaction-control SQL) or a different
// seed from silently expanding the bootstrap transaction's authority. A future
// regenerated baseline needs a reviewed manifest change and a fresh-DB test.
const FRESH_BOOTSTRAP_SOURCES = Object.freeze({
  [BASELINE_FILE]: '9e81cfdd81977fbec2c7f3a3007461b10de8e06b94d238370559ffbcff17a800',
  '20260806_seed_airports_data.sql': 'e03038a6c5e5bcc7bbcc9a941ed0d51196edd7b81375c52acbbe7b10772374b5',
});
const AIRPORT_SEED_FILE = '20260806_seed_airports_data.sql';
// Retain old dump coverage when a future reviewed baseline advances its marker;
// an existing database must still be able to apply ordinary later migrations.
const BASELINE_COVERAGE_BY_CHECKSUM = Object.freeze({
  '9e81cfdd81977fbec2c7f3a3007461b10de8e06b94d238370559ffbcff17a800': '20260913_schema_repair.sql',
});


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

  // Read each source once: marker, checksum and executed bytes must come from
  // the same plan even if another session edits files during a boot.
  const sources = new Map(await Promise.all(files.map(async filename => {
    const content = await fs.readFile(path.join(migrationsDir, filename), 'utf8');
    return [filename, { content, checksum: crypto.createHash('sha256').update(content).digest('hex') }];
  })));

  // The pool, initial LISTEN, reconnect, and migration runner share one policy.
  const client = new pg.Client({
    ...databaseConnectionConfig(),
    application_name: 'migration-runner',
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

    const { rows } = await client.query('SELECT filename, checksum, baseline FROM schema_migrations');
    const recorded = new Map(rows.map((r) => [r.filename, r]));

    // Empty database = the core table does not exist. Only then may the
    // baseline file execute; everywhere else it is recorded and skipped.
    const { rows: fresh } = await client.query("SELECT to_regclass('public.snapshots') IS NULL AS is_fresh");
    const snapshotsMissing = fresh[0].is_fresh === true;
    const isFreshDb = snapshotsMissing && recorded.size === 0;
    if (snapshotsMissing && recorded.size > 0) {
      throw new Error('[MIGRATIONS] migration ledger exists but public.snapshots is missing — inspect the inconsistent database before continuing');
    }
    if (!snapshotsMissing && recorded.size === 0) {
      throw new Error('[MIGRATIONS] schema exists without a migration ledger — cannot distinguish a legacy database from interrupted initialization; establish a reviewed ledger before continuing');
    }

    // Current dump coverage; existing executed baselines use their recorded checksum below.
    let baselineThrough = null;
    if (files.includes(BASELINE_FILE)) {
      const marker = sources.get(BASELINE_FILE).content.match(BASELINE_THROUGH_RE);
      if (!marker) throw new Error(`[MIGRATIONS] ${BASELINE_FILE} is missing its "-- BASELINE_THROUGH: <file>" marker`);
      baselineThrough = marker[1];
      if (!files.includes(baselineThrough)) {
        throw new Error(`[MIGRATIONS] ${BASELINE_FILE} claims BASELINE_THROUGH ${baselineThrough}, which is not in ${migrationsDir}`);
      }
    }
    const coveredFiles = baselineThrough === null ? [] : files.filter(filename => filename <= baselineThrough);
    // baseline=false means this dump actually EXECUTED during a fresh boot.
    // baseline=true means it was merely recorded on an existing database;
    // that existing database may legitimately still have pending migrations.
    if (recorded.get(BASELINE_FILE)?.baseline === false) {
      if (!baselineThrough) throw new Error('[MIGRATIONS] executed baseline source is unavailable — cannot verify its covered ledger');
      const recordedBaseline = recorded.get(BASELINE_FILE);
      const recordedThrough = BASELINE_COVERAGE_BY_CHECKSUM[recordedBaseline.checksum]
        ?? (recordedBaseline.checksum === sources.get(BASELINE_FILE)?.checksum ? baselineThrough : null);
      if (!recordedThrough) throw new Error('[MIGRATIONS] executed baseline checksum has unknown coverage — inspect its original source before continuing');
      const missing = files.filter(filename => filename <= recordedThrough && !recorded.has(filename));
      if (missing.length) {
        throw new Error(`[MIGRATIONS] incomplete executed baseline ledger (${missing.length} covered files missing) — refusing historical replay; inspect and repair the ledger with verified evidence`);
      }
    }
    const initialized = new Set();
    if (isFreshDb) {
      if (!baselineThrough) throw new Error(`[MIGRATIONS] empty database and no ${BASELINE_FILE} — cannot build the schema from migrations/ alone`);
      for (const [filename, expectedChecksum] of Object.entries(FRESH_BOOTSTRAP_SOURCES)) {
        if (!sources.has(filename) || !coveredFiles.includes(filename)) {
          throw new Error(`[MIGRATIONS] fresh bootstrap requires the reviewed covered source ${filename}`);
        }
        if (sources.get(filename).checksum !== expectedChecksum) {
          throw new Error(`[MIGRATIONS] fresh bootstrap source checksum changed: ${filename} — review the bootstrap manifest before executing`);
        }
      }
      log('empty database detected — baseline, approved airport identities and covered ledger will commit atomically');
      await client.query('BEGIN');
      try {
        await client.query(sources.get(BASELINE_FILE).content);
        // The dump is schema-only. This explicit, provenance-carrying seed is
        // safe only here: airports was just created in this same transaction.
        // Do not replay app_rules: its historical seed contains obsolete rules.
        await client.query(sources.get(AIRPORT_SEED_FILE).content);
        for (const filename of coveredFiles) {
          const baseline = filename !== BASELINE_FILE && filename !== AIRPORT_SEED_FILE;
          await client.query(
            'INSERT INTO schema_migrations (filename, checksum, baseline) VALUES ($1, $2, $3)',
            [filename, sources.get(filename).checksum, baseline]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* disconnect also rolls back */ }
        throw new Error(`[MIGRATIONS] fresh bootstrap failed: ${err.message}`, { cause: err });
      }
      for (const filename of coveredFiles) {
        initialized.add(filename);
        if (filename === BASELINE_FILE || filename === AIRPORT_SEED_FILE) applied.push(filename);
        else baselined.push(filename);
      }
      log('fresh bootstrap committed; current app_rules continuity still requires a reviewed export, not replay of historical rules');
    }

    for (const filename of files) {
      if (initialized.has(filename)) continue;
      const { content, checksum } = sources.get(filename);

      if (recorded.has(filename)) {
        if (recorded.get(filename).checksum !== checksum) {
          console.warn(
            `[GATEWAY] [MIGRATIONS] ⚠️ checksum drift on already-applied ${filename} — ` +
            `NOT re-running (applied history is immutable; fix forward with a new migration file)`
          );
        }
        skipped++;
        continue;
      }

      const isBaselineFile = filename === BASELINE_FILE;
      // Record-without-executing cases:
      //   * the baseline file itself on an existing database
      //   * fresh initialization was already handled atomically above
      //   * legacy first-run bootstrapping of an existing database (BASELINE_CUTOFF)
      if ((isBaselineFile && !isFreshDb) || (!isFreshDb && !isBaselineFile && filename < BASELINE_CUTOFF)) {
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
      log(`baselined ${baselined.length} file(s) as already-applied without executing (${isFreshDb ? 'schema covered by ' + BASELINE_FILE + '; historical data effects not replayed' : 'pre-' + BASELINE_CUTOFF + ' or baseline file'})`);
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
