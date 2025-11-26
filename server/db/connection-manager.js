import { Pool } from 'pg';

// SIMPLIFIED: Replit automatically injects the correct DATABASE_URL 
// for both Development (local) and Production (Deployments).
// We do not need manual switching logic or external Neon checks.

if (!process.env.DATABASE_URL) {
  console.error("❌ Fatal: DATABASE_URL is missing. Ensure Replit Postgres is enabled.");
  process.exit(1);
}

// Create a standard Postgres pool using the environment provided URL
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Standard pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  // Don't exit process immediately in serverless/replit envs, just log
});

export const query = (text, params) => pool.query(text, params);

export function getPool() {
  return pool;
}

export default pool;
