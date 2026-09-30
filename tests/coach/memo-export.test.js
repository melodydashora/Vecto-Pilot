import { describe, test, expect } from '@jest/globals';
import { exportCoachMemos, main } from '../../scripts/pull-coach-memos.mjs';
const { structuredClone } = globalThis;
function fixture() {
  const rows = [{ id: '11111111-1111-4111-8111-111111111111', type: 'bug', title: 'Synthetic memo', detail: 'Synthetic detail', priority: 'low', created_at: '2026-09-29T10:00:00Z', status: 'new' }];
  let text = '', lockTail = Promise.resolve(), appendCount = 0, failCommit = false, failAppend = false;
  const files = { readFile: async () => text, appendFile: async (_path, data) => { text += data; appendCount++; if (failAppend) { failAppend = false; throw new Error('synthetic append receipt failure'); } } };
  const pool = { connect: async () => {
    let unlock, staged = [];
    return { query: async (sql, params) => {
      if (sql.includes('pg_advisory_xact_lock')) {
        const previous = lockTail; lockTail = new Promise(resolve => { unlock = resolve; }); await previous;
      } else if (sql.startsWith('SELECT id')) return { rows: structuredClone(rows.filter(row => row.status === 'new')) };
      else if (sql.startsWith('UPDATE')) staged = params[0];
      else if (sql === 'COMMIT') {
        if (failCommit) { failCommit = false; throw new Error('synthetic commit failure'); }
        rows.filter(row => staged.includes(row.id)).forEach(row => { row.status = 'exported'; }); unlock?.();
      } else if (sql === 'ROLLBACK') unlock?.();
      return { rows: [] };
    }, release: () => unlock?.() };
  } };
  return { rows, files, pool, text: () => text, count: () => appendCount, failCommit: () => { failCommit = true; }, failAppend: () => { failAppend = true; } };
}
describe('Coach memo export receipts', () => {
  test('concurrent exports append once and serialize DB state changes', async () => {
    const f = fixture(); const results = await Promise.all([exportCoachMemos(f), exportCoachMemos(f)]);
    expect(f.count()).toBe(1); expect(results.map(result => result.selected).sort()).toEqual([0, 1]); expect(f.rows[0].status).toBe('exported');
  });
  test.each(['failCommit', 'failAppend'])('%s retains a completed append and retries without duplication', async failure => {
    const f = fixture(); f[failure]();
    await expect(exportCoachMemos(f)).rejects.toThrow('synthetic');
    expect(f.rows[0].status).toBe('new'); expect(f.count()).toBe(1);
    const retried = await exportCoachMemos(f);
    expect(retried).toMatchObject({ appended: 0, recovered: 1 }); expect(f.count()).toBe(1); expect(f.rows[0].status).toBe('exported');
  });
  test('dry run leaves file and export state unchanged', async () => {
    const f = fixture(); expect(await exportCoachMemos({ ...f, dryRun: true })).toMatchObject({ dryRun: true, pending: 1 });
    expect(f.text()).toBe(''); expect(f.rows[0].status).toBe('new');
  });
  test('an alternate URL or retired --dev flag cannot select a database', async () => {
    await expect(main({ args: [], env: { PROD_DATABASE_URL: 'synthetic-alternate' } })).rejects.toThrow('DATABASE_URL is not supplied');
    await expect(main({ args: ['--dev'], env: { DATABASE_URL: 'synthetic-supplied' } })).rejects.toThrow('--dev is no longer supported');
  });
});
