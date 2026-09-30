import { beforeEach, afterAll, expect, jest, test } from '@jest/globals';

const originalAdmins = process.env.AGENT_ADMIN_USERS;
const reads = jest.fn();
let patch;
const db = {
  select: () => { reads(); return { from() { return this; }, where() { return this; }, orderBy() { return this; }, limit: async () => [] }; },
  update: () => ({ set(value) { patch = value; return { where: () => ({ returning: async () => [{ id: 1, ...value }] }) }; } }),
};
const ownership = jest.fn(async () => ({ ok: false, status: 404, body: { error: 'snapshot_not_found' } }));
const requireAuth = (req, _res, next) => { req.auth ??= { userId: 'ordinary-driver' }; next(); };
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth }));
jest.unstable_mockModule('../../server/middleware/require-snapshot-ownership.js', () => ({ verifySnapshotOwnership: ownership }));
const { default: intel } = await import('../../server/api/intelligence/index.js');
const { default: memory } = await import('../../server/api/memory/index.js');
const { requireOperator } = await import('../../server/middleware/require-operator.js');
const response = () => ({ statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } });
beforeEach(() => { process.env.AGENT_ADMIN_USERS = 'operator'; reads.mockClear(); ownership.mockClear(); patch = null; });
afterAll(() => { if (originalAdmins === undefined) delete process.env.AGENT_ADMIN_USERS; else process.env.AGENT_ADMIN_USERS = originalAdmins; });
test.each(['/types', '/lookup', '/staging-areas', '/demand-patterns'])('GET %s reaches its fixed route', path => {
  const first = intel.stack.find(layer => layer.route?.methods.get && layer.match(path));
  expect(first.route.path).toBe(path);
});
test('memory gate rejects ordinary drivers before persistence', () => {
  expect(memory.stack.filter(layer => !layer.route).map(layer => layer.handle)).toEqual([requireAuth, requireOperator]);
  const res = response(); const next = jest.fn();
  requireOperator({ auth: { userId: 'ordinary-driver' }, method: 'GET', originalUrl: '/api/memory' }, res, next);
  expect(res.statusCode).toBe(403);
  expect(next).not.toHaveBeenCalled();
  expect(reads).not.toHaveBeenCalled();
});
test('memory updates retain server-owned identifiers and timestamps', async () => {
  const handler = memory.stack.find(layer => layer.route?.methods.patch).route.stack.at(-1).handle;
  const res = response();
  await handler({ params: { id: '1' }, body: { id: 9, content: 'changed', created_at: 'spoofed', updated_at: 'spoofed' } }, res);
  expect(res.statusCode).toBe(200);
  expect(patch).not.toHaveProperty('id');
  expect(patch).not.toHaveProperty('created_at');
  expect(patch.updated_at).toBeInstanceOf(Date);
  expect(patch.content).toBe('changed');
});
test.each([['post', '/'], ['put', '/:id'], ['delete', '/:id']])('%s %s requires operator role', (method, path) => {
  const route = intel.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
  expect(route.stack[0].handle).toBe(requireOperator);
});
test('staging read rejects an unowned snapshot before querying candidates', async () => {
  const route = intel.stack.find(layer => layer.route?.path === '/staging-areas').route;
  const res = response();
  await route.stack.at(-1).handle({ auth: { userId: 'ordinary-driver' }, query: { snapshotId: 'other-snapshot' } }, res);
  expect(res.statusCode).toBe(404);
  expect(ownership).toHaveBeenCalledWith('other-snapshot', 'ordinary-driver');
  expect(reads).not.toHaveBeenCalled();
});
