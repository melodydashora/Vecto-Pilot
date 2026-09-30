import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import { EventEmitter } from 'node:events';

let implementation, manager;
class Pool extends EventEmitter {
  constructor(options) {
    super(); this.options = options;
    this.query = jest.fn((...args) => implementation(...args));
  }
}
const savedUrl = process.env.DATABASE_URL;
beforeEach(async () => {
  jest.resetModules(); jest.useFakeTimers();
  process.env.DATABASE_URL = 'postgres://fixture:synthetic@127.0.0.1/fixture?sslmode=disable';
  implementation = async () => ({ rows: [] });
  jest.unstable_mockModule('pg', () => ({ Pool }));
  manager = await import('../../server/db/connection-manager.js');
});
afterEach(() => {
  jest.clearAllTimers(); jest.useRealTimers();
  if (savedUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = savedUrl;
});
test.each([
  'INSERT INTO fixture_counter(value) VALUES(1)',
  'UPDATE fixture_counter SET value = value + 1',
  'WITH changed AS (DELETE FROM fixture_counter RETURNING *) SELECT * FROM changed',
  "SELECT nextval('fixture_sequence')",
  'SELECT * FROM fixture_counter',
])('lost acknowledgment does not transparently replay: %s', async statement => {
  let executions = 0;
  const failure = Object.assign(new Error('fixture response lost after server execution'), { code: '08006' });
  implementation = async () => {
    executions++;
    if (executions === 1) throw failure;
    return { rows: [{ executedAgain: true }] };
  };
  const result = Promise.allSettled([manager.query(statement)]);
  await jest.advanceTimersByTimeAsync(150);
  expect((await result)[0]).toMatchObject({ status: 'rejected', reason: failure });
  expect(executions).toBe(1);
  // A subsequent explicit caller operation still uses the recoverable pool.
  expect(await manager.query('SELECT 1')).toEqual({ rows: [{ executedAgain: true }] });
  expect(executions).toBe(2);
});
test('callback query errors preserve the original pg contract without replay', () => {
  const failure = Object.assign(new Error('fixture admin shutdown'), { code: '57P01' });
  implementation = jest.fn((_text, params, callback) => callback(failure));
  const cb = jest.fn();
  manager.pool.query('UPDATE fixture_counter SET value=1', [], cb);
  expect(implementation).toHaveBeenCalledTimes(1);
  expect(cb).toHaveBeenCalledWith(failure);
});
test('statement timeout is a startup option, without an unobserved duplicate connect query', () => {
  const client = new EventEmitter(); client.query = jest.fn(async () => ({ rows: [] }));
  manager.pool.emit('connect', client);
  expect(manager.pool.options.statement_timeout).toBe(30_000);
  expect(client.query).not.toHaveBeenCalled();
  expect(client.listenerCount('error')).toBe(1);
});
