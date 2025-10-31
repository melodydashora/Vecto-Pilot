import { db } from '../db/drizzle.js';
import { sql } from 'drizzle-orm';

export async function acquireLock(key, ttlMs = 120000) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  
  try {
    // Correct acquisition: only succeed if lock is new OR expired
    const result = await db.execute(sql`
      INSERT INTO worker_locks (lock_key, expires_at)
      VALUES (${key}, ${expiresAt})
      ON CONFLICT (lock_key)
      DO UPDATE SET expires_at = 
        CASE 
          WHEN worker_locks.expires_at <= NOW() THEN EXCLUDED.expires_at
          ELSE worker_locks.expires_at
        END
      RETURNING (worker_locks.expires_at <= NOW()) AS acquired
    `);
    
    const acquired = Boolean(result.rows?.[0]?.acquired);
    
    if (!acquired) {
      // Log once with expiry time for diagnosis
      const inspect = await db.execute(sql`
        SELECT expires_at FROM worker_locks WHERE lock_key = ${key}
      `);
      const expiresAt = inspect.rows?.[0]?.expires_at;
      console.warn(`[locks] Lock busy: ${key}, expires_at=${expiresAt}`);
    }
    
    return acquired;
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

export async function sweepExpiredLocks() {
  try {
    const result = await db.execute(sql`
      DELETE FROM worker_locks WHERE expires_at < NOW()
      RETURNING lock_key
    `);
    if (result.rowCount > 0) {
      console.log(`[locks] Swept ${result.rowCount} expired locks`);
    }
  } catch (err) {
    console.error('[locks] Failed to sweep expired locks:', err.message);
  }
}

export async function extendLock(key, ttlMs = 120000) {
  const expiresAt = new Date(Date.now() + ttlMs);
  try {
    await db.execute(sql`
      UPDATE worker_locks 
      SET expires_at = ${expiresAt}
      WHERE lock_key = ${key}
    `);
  } catch (err) {
    console.error(`[locks] Failed to extend lock ${key}:`, err.message);
  }
}
