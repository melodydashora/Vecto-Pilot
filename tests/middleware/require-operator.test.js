// tests/middleware/require-operator.test.js
// 2026-09-10: the operator gate that closes Astra security findings [1] [2] [3] [5].
// Pure middleware — no DB, no network. Env is restored after every test.

import { describe, it, expect, afterEach } from '@jest/globals';
import { requireOperator, isOperator } from '../../server/middleware/require-operator.js';

const ORIGINAL = { admins: process.env.AGENT_ADMIN_USERS, deploy: process.env.REPLIT_DEPLOYMENT };
afterEach(() => {
  if (ORIGINAL.admins === undefined) delete process.env.AGENT_ADMIN_USERS; else process.env.AGENT_ADMIN_USERS = ORIGINAL.admins;
  if (ORIGINAL.deploy === undefined) delete process.env.REPLIT_DEPLOYMENT; else process.env.REPLIT_DEPLOYMENT = ORIGINAL.deploy;
});

function run(auth) {
  const req = { auth, method: 'GET', originalUrl: '/api/memory' };
  const out = { status: null, body: null, nexted: false };
  const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  requireOperator(req, res, () => { out.nexted = true; });
  return out;
}

describe('requireOperator', () => {
  it('rejects a request with no auth (401)', () => {
    delete process.env.AGENT_ADMIN_USERS;
    expect(run(undefined)).toMatchObject({ status: 401, nexted: false });
  });

  it('lets a service account through regardless of the allowlist', () => {
    delete process.env.AGENT_ADMIN_USERS;
    expect(run({ userId: 'system-agent', isAgent: true })).toMatchObject({ nexted: true });
  });

  it('has NO workspace fallback: with no allowlist a driver gets 403 even outside a deployment', () => {
    delete process.env.AGENT_ADMIN_USERS;
    delete process.env.REPLIT_DEPLOYMENT;
    const out = run({ userId: 'driver-1' });
    expect(out.status).toBe(403);
    expect(out.body.error).toBe('OPERATOR_NOT_CONFIGURED');
    expect(out.nexted).toBe(false);
  });

  it('lets an allowlisted user through and denies everyone else', () => {
    process.env.AGENT_ADMIN_USERS = ' op-1 , op-2 ';
    expect(run({ userId: 'op-2' })).toMatchObject({ nexted: true });
    const out = run({ userId: 'driver-1' });
    expect(out).toMatchObject({ status: 403, nexted: false });
    expect(out.body.error).toBe('OPERATOR_REQUIRED');
  });

  it('isOperator mirrors the gate for inline checks', () => {
    process.env.AGENT_ADMIN_USERS = 'op-1';
    expect(isOperator({ userId: 'op-1' })).toBe(true);
    expect(isOperator({ userId: 'driver-1' })).toBe(false);
    expect(isOperator({ userId: 'x', isAgent: true })).toBe(true);
    expect(isOperator(undefined)).toBe(false);
  });
});
