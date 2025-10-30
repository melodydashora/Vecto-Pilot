import { drizzle } from 'drizzle-orm/node-postgres';
import { getLazyPool } from './pool-lazy.js';
import * as schema from '../../shared/schema.js';

// Lazy drizzle instance - pool created on first query only
let _db;
async function getDB() {
  if (!_db) {
    const pool = await getLazyPool();
    _db = drizzle(pool, { schema });
  }
  return _db;
}

// Export a Proxy that lazily initializes on first query
// NOTE: All query methods return Promises, which is fine for Drizzle
export const db = new Proxy({}, {
  get(target, prop) {
    // For methods that need the DB instance, return an async wrapper
    return new Proxy(function() {}, {
      get(fnTarget, fnProp) {
        return async (...args) => {
          const actualDB = await getDB();
          const value = actualDB[prop];
          if (typeof value === 'function') {
            const result = value.call(actualDB, ...args);
            if (typeof result?.[fnProp] === 'function') {
              return result[fnProp].bind(result);
            }
            return result;
          }
          return value?.[fnProp];
        };
      },
      apply(fnTarget, thisArg, args) {
        return (async () => {
          const actualDB = await getDB();
          const value = actualDB[prop];
          if (typeof value === 'function') {
            return value.apply(actualDB, args);
          }
          return value;
        })();
      }
    });
  }
});
