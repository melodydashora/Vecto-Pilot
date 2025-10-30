// server/lib/blocks-jobs.js
// DB-backed job store for async /api/blocks/async processing
// Robust across Cloud Run autoscale instances

import crypto from 'crypto';
import { getLazyPool } from '../db/pool-lazy.js';

export function newJobId() {
  return crypto.randomUUID();
}

export async function createJob({ id, body }) {
  const pool = await getLazyPool();
  await pool.query(
    `INSERT INTO block_jobs (id, status, request_body) VALUES ($1, $2, $3)`,
    [id, 'pending', JSON.stringify(body)]
  );
}

export async function startJob(id) {
  const pool = await getLazyPool();
  await pool.query(
    `UPDATE block_jobs SET status = 'running', updated_at = now() WHERE id = $1`,
    [id]
  );
}

export async function finishJob(id, result) {
  const pool = await getLazyPool();
  await pool.query(
    `UPDATE block_jobs SET status = 'succeeded', result = $2, updated_at = now() WHERE id = $1`,
    [id, JSON.stringify(result)]
  );
}

export async function failJob(id, err) {
  const pool = await getLazyPool();
  const errorMsg = String(err).slice(0, 2000); // Limit error message length
  await pool.query(
    `UPDATE block_jobs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
    [id, errorMsg]
  );
}

export async function loadJob(id) {
  const pool = await getLazyPool();
  const { rows } = await pool.query(
    `SELECT * FROM block_jobs WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}
