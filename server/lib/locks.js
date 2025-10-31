import { db } from '../db/drizzle.js';
import { sql } from 'drizzle-orm';

export async function acquireLock(key, ttlMs = 120000) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  
  try {
    const result = await db.execute(sql`
      INSERT INTO worker_locks (lock_key, expires_at)
      VALUES (${key}, ${expiresAt})
      ON CONFLICT (lock_key)
      DO UPDATE SET expires_at = CASE
        WHEN worker_locks.expires_at < NOW() THEN EXCLUDED.expires_at
        ELSE worker_locks.expires_at
      END
      RETURNING (worker_locks.expires_at < NOW()) AS acquired
    `);
    
    return Boolean(result.rows?.[0]?.acquired);
  } catch (err) {
    console.error(`[locks] Failed to acquire lock ${key}:`, err.message);
    return false;
  }
}

export async function releaseLock(key) {
  try {
    await db.execute(sql`DELETE FROM worker_locks WHERE lock_key = ${key}`);
  } catch (err) {
    console.error(`[locks] Failed to release lock ${key}:`, err.message);
  }
}
