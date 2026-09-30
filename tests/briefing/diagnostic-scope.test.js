import { jest, test, expect, beforeEach } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
const reads = [];
let rows;
const writeFile = jest.fn(), rename = jest.fn(), unlink = jest.fn();
jest.unstable_mockModule('node:fs/promises', () => ({ writeFile, rename, unlink }));
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: { select: () => {
  let table;
  const chain = { from: t => { table = getTableName(t); return chain; }, where: clause => { reads.push(clause); return chain; }, limit: async () => rows[table] || [] };
  return chain;
} } }));
const { dumpLastBriefingRow } = await import('../../server/lib/briefing/dump-last-briefing.js');
beforeEach(() => {
  reads.length = 0; jest.clearAllMocks();
  rows = { briefings: [{ snapshot_id: 'own' }], snapshots: [{ snapshot_id: 'own', lat: 0 }], strategies: [{ snapshot_id: 'own' }] };
  writeFile.mockResolvedValue(); rename.mockResolvedValue(); unlink.mockResolvedValue();
});
test('requires caller snapshot and writes a complete private artifact with truthful scope', async () => {
  expect(await dumpLastBriefingRow()).toBe(false); expect(reads).toHaveLength(0);
  expect(await dumpLastBriefingRow('own')).toBe(true); expect(reads).toHaveLength(3);
  const [path, content, options] = writeFile.mock.calls[0];
  expect(path).toMatch(/sent-to-strategist\.txt\..+\.tmp$/);
  expect(options).toMatchObject({ mode: 0o600, flag: 'wx' });
  const artifact = JSON.parse(content);
  expect(artifact.description).toContain('not the exact Strategist prompt');
  expect(artifact.snapshot.lat).toBe(0);
  expect(rename).toHaveBeenCalledWith(path, expect.stringMatching(/sent-to-strategist\.txt$/));
});
test('does not publish mismatched database evidence', async () => {
  rows.strategies = [{ snapshot_id: 'foreign' }];
  expect(await dumpLastBriefingRow('own')).toBe(false); expect(writeFile).not.toHaveBeenCalled();
});
test('serializes concurrent writes and a failed rename does not poison later diagnostics', async () => {
  let release;
  writeFile.mockImplementationOnce(() => new Promise(r => { release = r; }));
  const first = dumpLastBriefingRow('own'), second = dumpLastBriefingRow('own');
  await new Promise(r => setImmediate(r)); expect(writeFile).toHaveBeenCalledTimes(1);
  release(); await Promise.all([first, second]); expect(rename).toHaveBeenCalledTimes(2);
  rename.mockRejectedValueOnce(new Error('disk failure'));
  expect(await dumpLastBriefingRow('own')).toBe(false);
  expect(await dumpLastBriefingRow('own')).toBe(true);
  expect(unlink).toHaveBeenCalledTimes(4);
});
