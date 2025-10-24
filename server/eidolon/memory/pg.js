// server/eidolon/memory/pg.js
// Postgres-backed persistent memory for assistant override and Eidolon.

import { Pool } from "pg";
import { getSharedPool } from "../../db/pool.js";

const dsn = process.env.DATABASE_URL;
if (!dsn) throw new Error("DATABASE_URL not set");

// Try to use shared pool first (feature-flagged), fall back to local pool
let pool = getSharedPool();

if (!pool) {
  // Fallback: Create local pool with minimal settings
  console.log('[memory] Using local pool (shared pool disabled)');
  pool = new Pool({ connectionString: dsn });
}

export async function memoryPut({ table, scope, key, userId, content, ttlDays = 365 }) {
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  const q = `
    INSERT INTO ${table} (scope, key, user_id, content, created_at, updated_at, expires_at)
    VALUES ($1,$2,$3,$4, now(), now(), $5)
    ON CONFLICT (scope, key, user_id)
    DO UPDATE SET content=$4, updated_at=now(), expires_at=$5
    RETURNING id
  `;
  const v = [scope, key, userId || null, content, expiresAt];
  const { rows } = await pool.query(q, v);
  return rows[0]?.id || null;
}

export async function memoryGet({ table, scope, key, userId }) {
  const q = `
    SELECT content FROM ${table}
    WHERE scope=$1 AND key=$2 AND (user_id IS NOT DISTINCT FROM $3)
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  const v = [scope, key, userId || null];
  const { rows } = await pool.query(q, v);
  return rows[0]?.content ?? null;
}

export async function memoryQuery({ table, scope, userId, limit = 50 }) {
  const q = `
    SELECT key, content, updated_at
    FROM ${table}
    WHERE scope=$1 AND (user_id IS NOT DISTINCT FROM $2)
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY updated_at DESC
    LIMIT $3
  `;
  const v = [scope, userId || null, Math.max(1, Math.min(200, limit))];
  const { rows } = await pool.query(q, v);
  return rows;
}

export async function memoryCompact({ table }) {
  await pool.query(`DELETE FROM ${table} WHERE expires_at IS NOT NULL AND expires_at <= now()`);
}
