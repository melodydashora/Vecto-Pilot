import { Pool } from "pg";
import { getSharedPool } from "../../db/pool.js";

const dsn = process.env.DATABASE_URL;
if (!dsn) throw new Error("DATABASE_URL not set");

let pool = getSharedPool();

if (!pool) {
  console.log('[memory] Using local pool (shared pool disabled)');
  pool = new Pool({
    connectionString: dsn,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    // optionally: allowExitOnIdle: true for serverless
  });
}

function normalizeUserId(userId) {
  // If schema uses UUID, ensure valid or fallback to null
  if (!userId) return null;
  if (/^[0-9a-fA-F\-]{36}$/.test(userId)) return userId;
  return null;
}

export async function memoryPut({ table, scope, key, userId, content, ttlDays = 365 }) {
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  const user_id_val = normalizeUserId(userId);

  const contentVal = typeof content === "object"
    ? JSON.stringify(content)
    : content;

  const client = await pool.connect();
  try {
    // Set RLS context (NULL for system access) - skip SET for NULL since RLS is disabled in dev
    if (user_id_val) {
      await client.query(`SET LOCAL app.user_id = '${user_id_val}'`);
    }
    // Skip SET for NULL - not needed when RLS is disabled

    // Try upsert first (requires unique constraint on scope, key, user_id)
    // Fall back to simple insert if constraint doesn't exist
    const v = [scope, key, user_id_val, contentVal, expiresAt];

    try {
      const q = `
        INSERT INTO ${table} (scope, key, user_id, content, created_at, updated_at, expires_at)
        VALUES ($1, $2, $3, $4, now(), now(), $5)
        ON CONFLICT (scope, key, user_id)
        DO UPDATE SET content = $4, updated_at = now(), expires_at = $5
        RETURNING id
      `;
      const { rows } = await client.query(q, v);
      return rows[0]?.id || null;
    } catch (conflictErr) {
      // If unique constraint doesn't exist, fall back to simple insert
      if (conflictErr.message?.includes('no unique or exclusion constraint')) {
        const insertQ = `
          INSERT INTO ${table} (scope, key, user_id, content, created_at, updated_at, expires_at)
          VALUES ($1, $2, $3, $4, now(), now(), $5)
          RETURNING id
        `;
        const { rows } = await client.query(insertQ, v);
        return rows[0]?.id || null;
      }
      throw conflictErr;
    }
  } finally {
    client.release();
  }
}

export async function memoryGet({ table, scope, key, userId }) {
  const user_id_val = normalizeUserId(userId);

  const client = await pool.connect();
  try {
    // Set RLS context (NULL for system access) - skip SET for NULL since RLS is disabled in dev
    if (user_id_val) {
      await client.query(`SET LOCAL app.user_id = '${user_id_val}'`);
    }
    // Skip SET for NULL - not needed when RLS is disabled
    
    const q = `
      SELECT content FROM ${table}
      WHERE scope = $1
        AND key = $2
        AND (user_id IS NOT DISTINCT FROM $3)
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    const v = [scope, key, user_id_val];
    const { rows } = await client.query(q, v);
    if (!rows[0]) return null;
    try {
      return JSON.parse(rows[0].content);
    } catch {
      return rows[0].content;
    }
  } finally {
    client.release();
  }
}

export async function memoryQuery({ table, scope, userId, limit = 50 }) {
  const user_id_val = normalizeUserId(userId);
  const lim = Math.max(1, Math.min(200, limit));

  const client = await pool.connect();
  try {
    // Set RLS context (NULL for system access) - skip SET for NULL since RLS is disabled in dev
    if (user_id_val) {
      await client.query(`SET LOCAL app.user_id = '${user_id_val}'`);
    }
    // Skip SET for NULL - not needed when RLS is disabled
    
    const q = `
      SELECT key, content, updated_at
      FROM ${table}
      WHERE scope = $1
        AND (user_id IS NOT DISTINCT FROM $2)
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY updated_at DESC
      LIMIT $3
    `;
    const v = [scope, user_id_val, lim];
    const { rows } = await client.query(q, v);

    return rows.map(r => {
      let c = r.content;
      try { c = JSON.parse(c); } catch {}
      return { key: r.key, content: c, updated_at: r.updated_at };
    });
  } finally {
    client.release();
  }
}

export async function memoryCompact({ table }) {
  const q = `DELETE FROM ${table} WHERE expires_at IS NOT NULL AND expires_at <= now()`;
  await pool.query(q);
}
