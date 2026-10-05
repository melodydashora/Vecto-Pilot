import { afterAll, beforeAll, beforeEach, expect, jest, test } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const BASELINE = '00000_baseline.sql';
const AIRPORTS = '20260806_seed_airports_data.sql';
const FUTURE = '20261005_fixture_only.sql';
let directory, sourceFiles, state, transaction, failAfter;
const queries = [];
const client = { connect: jest.fn(), end: jest.fn(), query: jest.fn(async (query, params) => {
  queries.push({ query, params });
  let rows = [];
  if (query === 'BEGIN') transaction = structuredClone(state);
  else if (query === 'COMMIT') transaction = null;
  else if (query === 'ROLLBACK' && transaction) { state = transaction; transaction = null; }
  else if (query.includes('SELECT filename, checksum')) rows = state.ledger;
  else if (query.includes("to_regclass('public.snapshots')")) rows = [{ is_fresh: state.snapshotsMissing }];
  else if (query === sourceFiles.get(BASELINE)) state.snapshotsMissing = false;
  else if (query.includes('INSERT INTO schema_migrations')) state.ledger.push({ filename: params[0], checksum: params[1], baseline: params[2] ?? query.includes('true)') });
  if (failAfter?.(query, params)) { failAfter = null; throw new Error('synthetic lost connection'); }
  return { rows };
}) };
jest.unstable_mockModule('pg', () => ({ default: { Client: jest.fn(function () { return client; }) } }));
const { runMigrations } = await import('../../server/db/run-migrations.js');
const originalUrl = process.env.DATABASE_URL;
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const ledger = (filename, baseline = false) => ({ filename, checksum: hash(sourceFiles.get(filename)), baseline });
const run = () => runMigrations({ migrationsDir: directory });
let output, warnings;

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'astra-bootstrap-unit-'));
  const source = new URL('../../migrations/', import.meta.url);
  const entries = (await fs.readdir(source)).filter(name => name.endsWith('.sql'));
  sourceFiles = new Map(await Promise.all(entries.map(async name => [name, await fs.readFile(new URL(name, source), 'utf8')])));
  sourceFiles.set(FUTURE, '-- synthetic future migration\nSELECT 1;\n');
  output = jest.spyOn(console, 'log').mockImplementation(() => {});
  warnings = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
beforeEach(async () => {
  await Promise.all([...sourceFiles].map(([name, bytes]) => fs.writeFile(path.join(directory, name), bytes)));
  state = { snapshotsMissing: true, ledger: [] }; transaction = null; failAfter = null; queries.length = 0;
  client.connect.mockClear(); client.end.mockClear(); client.query.mockClear();
  process.env.DATABASE_URL = 'postgres://fixture:synthetic@localhost/fixture';
});
afterAll(async () => {
  if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
  output.mockRestore(); warnings.mockRestore();
  await fs.rm(directory, { recursive: true, force: true });
});

test('fresh schema, approved airport seed and every covered ledger row commit together; repeat is inert', async () => {
  const first = await run();
  const begin = queries.findIndex(entry => entry.query === 'BEGIN');
  const baseline = queries.findIndex(entry => entry.query === sourceFiles.get(BASELINE));
  const airports = queries.findIndex(entry => entry.query === sourceFiles.get(AIRPORTS));
  const commit = queries.findIndex(entry => entry.query === 'COMMIT');
  expect(begin).toBeLessThan(baseline); expect(baseline).toBeLessThan(airports); expect(airports).toBeLessThan(commit);
  const covered = [...sourceFiles.keys()].filter(name => name <= '20260913_schema_repair.sql');
  const committedLedger = queries.slice(begin, commit).filter(entry => entry.query.includes('INSERT INTO schema_migrations'));
  expect(committedLedger.map(entry => entry.params[0])).toEqual(covered.sort());
  expect(state.ledger.find(entry => entry.filename === AIRPORTS).baseline).toBe(false);
  expect(queries.some(entry => entry.query === sourceFiles.get('20260706_app_rules_table.sql'))).toBe(false);
  expect(queries.some(entry => entry.query === sourceFiles.get('20260706_daypart_taxonomy_rename.sql'))).toBe(false);
  expect(first.applied).toContain(AIRPORTS);
  const before = structuredClone(state); queries.length = 0;
  expect(await run()).toEqual({ applied: [], baselined: [], skipped: sourceFiles.size });
  expect(state).toEqual(before);
  expect(queries.some(entry => [...sourceFiles.values()].includes(entry.query))).toBe(false);
});

test.each([BASELINE, AIRPORTS])('changed reviewed source %s fails before bootstrap writes', async filename => {
  await fs.appendFile(path.join(directory, filename), '\n-- changed source\n');
  await expect(run()).rejects.toThrow('source checksum changed');
  expect(state).toEqual({ snapshotsMissing: true, ledger: [] });
  expect(queries.some(entry => entry.query === 'BEGIN')).toBe(false);
});

test('missing approved seed fails rather than marking an absent reference source as covered', async () => {
  await fs.unlink(path.join(directory, AIRPORTS));
  await expect(run()).rejects.toThrow('requires the reviewed covered source');
  expect(state.ledger).toEqual([]);
});

test('failure after the first baseline ledger insert rolls back schema and ledger; restart safely initializes', async () => {
  failAfter = (query, params) => query.includes('INSERT INTO schema_migrations') && params[0] === BASELINE;
  await expect(run()).rejects.toThrow('fresh bootstrap failed');
  expect(state).toEqual({ snapshotsMissing: true, ledger: [] });
  expect(queries.some(entry => entry.query === 'ROLLBACK')).toBe(true);
  await run();
  expect(state.snapshotsMissing).toBe(false); expect(state.ledger).toHaveLength(sourceFiles.size);
});

test('a lost commit acknowledgment leaves a complete covered ledger and never replays bootstrap', async () => {
  failAfter = query => query === 'COMMIT';
  await expect(run()).rejects.toThrow('fresh bootstrap failed');
  expect(state.snapshotsMissing).toBe(false);
  expect(state.ledger).toHaveLength([...sourceFiles.keys()].filter(name => name <= '20260913_schema_repair.sql').length);
  queries.length = 0;
  const next = await run();
  expect(next.applied).toContain(FUTURE);
  expect(queries.some(entry => entry.query === sourceFiles.get(BASELINE) || entry.query === sourceFiles.get(AIRPORTS))).toBe(false);
});

test('old interrupted executed-baseline ledger fails before historical cleanup or obsolete rules can run', async () => {
  state = { snapshotsMissing: false, ledger: [ledger(BASELINE, false)] };
  await expect(run()).rejects.toThrow('incomplete executed baseline ledger');
  expect(queries.some(entry => [...sourceFiles.values()].includes(entry.query))).toBe(false);
  expect(state.ledger).toHaveLength(1);
});

test('a dump merely marked baselined on a preexisting database is not mistaken for an interrupted fresh boot', async () => {
  state = { snapshotsMissing: false, ledger: [ledger(BASELINE, true)] };
  const result = await run();
  expect(result.applied).toContain(FUTURE);
});

test('ordinary complete ledgers permit later migrations without reseeding existing reference data', async () => {
  state = { snapshotsMissing: false, ledger: [...sourceFiles.keys()].filter(name => name !== FUTURE).map(name => ledger(name, name === BASELINE)) };
  expect(await run()).toEqual({ applied: [FUTURE], baselined: [], skipped: sourceFiles.size - 1 });
  expect(queries.some(entry => entry.query === sourceFiles.get(AIRPORTS))).toBe(false);
});

test('an existing unledgered schema is not guessed to be a safe legacy migration target', async () => {
  state = { snapshotsMissing: false, ledger: [] };
  await expect(run()).rejects.toThrow('cannot distinguish a legacy database from interrupted initialization');
  expect(queries.some(entry => [...sourceFiles.values()].includes(entry.query))).toBe(false);
});

test('a ledger with its core schema missing fails instead of baselining an absent schema', async () => {
  state.ledger = [ledger(BASELINE, false)];
  await expect(run()).rejects.toThrow('public.snapshots is missing');
  expect(queries.some(entry => [...sourceFiles.values()].includes(entry.query))).toBe(false);
});


test('a newer dump marker cannot make a complete older baseline look interrupted', async () => {
  state = { snapshotsMissing: false, ledger: [...sourceFiles.keys()].filter(name => name !== FUTURE).map(name => ledger(name)) };
  await fs.writeFile(path.join(directory, BASELINE), sourceFiles.get(BASELINE)
    .replace('BASELINE_THROUGH: 20260913_schema_repair.sql', `BASELINE_THROUGH: ${FUTURE}`));
  expect(await run()).toEqual({ applied: [FUTURE], baselined: [], skipped: sourceFiles.size - 1 });
  expect(queries.some(entry => entry.query === sourceFiles.get(AIRPORTS))).toBe(false);
});
