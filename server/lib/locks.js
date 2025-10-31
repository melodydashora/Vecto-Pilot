import { db } from '../db/drizzle.js';
import { sql } from 'drizzle-orm';

export async function acquireLock(key, ttlMs = 120000) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const ownerId = process.env.WORKER_ID || `${process.pid}:${Math.random().toString(36).slice(2,7)}`;
  
  try {
    // Acquire only if expired OR owned by me (re-entry during heartbeat)
    const result = await db.execute(sql`
      WITH old_lock AS (
        SELECT expires_at, owner_id FROM worker_locks WHERE lock_key = ${key}
      )
      INSERT INTO worker_locks (lock_key, expires_at, owner_id, last_beat_at)
      VALUES (${key}, ${expiresAt}, ${ownerId}, NOW())
      ON CONFLICT (lock_key)
      DO UPDATE SET
        expires_at =
        CASE 
          WHEN worker_locks.expires_at <= NOW() THEN EXCLUDED.expires_at
          WHEN worker_locks.owner_id = ${ownerId} THEN EXCLUDED.expires_at
          ELSE worker_locks.expires_at
        END
      , owner_id =
        CASE
          WHEN worker_locks.expires_at <= NOW() THEN ${ownerId}
          WHEN worker_locks.owner_id = ${ownerId} THEN ${ownerId}
          ELSE worker_locks.owner_id
        END
      , last_beat_at =
        CASE
          WHEN worker_locks.expires_at <= NOW() THEN NOW()
          WHEN worker_locks.owner_id = ${ownerId} THEN NOW()
          ELSE worker_locks.last_beat_at
        END
      RETURNING (
        SELECT COALESCE(
          (SELECT expires_at FROM old_lock) <= NOW()
          OR (SELECT owner_id FROM old_lock) = ${ownerId}
        , true)
      ) AS acquired
    `);
    
    const acquired = Boolean(result.rows?.[0]?.acquired);
    
    if (!acquired) {
      // Log once with expiry time for diagnosis
      const inspect = await db.execute(sql`
        SELECT expires_at, owner_id FROM worker_locks WHERE lock_key = ${key}
      `);
      const lock = inspect.rows?.[0];
      console.warn(`[locks] Lock busy: ${key}, expires_at=${lock?.expires_at}, owner=${lock?.owner_id}`);
    }
    
    return acquired;
  } catch (err) {
    console.error(`[locks] Failed to acquire lock ${key}:`, err.message);
    return false;
  }
}

export async function releaseLock(key) {
  const ownerId = process.env.WORKER_ID || `${process.pid}`;
  try {
    await db.execute(sql`
      DELETE FROM worker_locks WHERE lock_key = ${key} AND owner_id = ${ownerId}
    `);
  } catch (err) {
    console.error(`[locks] Failed to release lock ${key}:`, err.message);
  }
}

export async function sweepExpiredLocks() {
  try {
    const result = await db.execute(sql`
      DELETE FROM worker_locks 
      WHERE expires_at <= NOW()
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
  const ownerId = process.env.WORKER_ID || `${process.pid}`;
  try {
    const result = await db.execute(sql`
      UPDATE worker_locks 
      SET expires_at = ${expiresAt}, last_beat_at = NOW()
      WHERE lock_key = ${key} AND owner_id = ${ownerId}
      RETURNING 1
    `);
    if (!result.rows?.length) {
      console.warn(`[locks] extendLock ignored: not owner for ${key}`);
    }
  } catch (err) {
    console.error(`[locks] Failed to extend lock ${key}:`, err.message);
  }
}
