import pkg from 'pg';
import crypto from 'crypto';
import { ndjson } from '../logger/ndjson.js';

const { Pool } = pkg;

// Replit DATABASE_URL automatically switches between dev and prod
// No need for manual environment detection - Replit handles this
const dbUrl = process.env.DATABASE_URL;

// DEBUG: Show which database URL is being used (masked password)
const maskedUrl = dbUrl ? dbUrl.replace(/:[^:@]*@/, ':***@') : 'NOT_SET';
const isProduction = process.env.REPLIT_DEPLOYMENT === '1' || process.env.DEPLOY_MODE === 'webservice';
console.log(`[connection-manager] 🔍 Environment Detection:`);
console.log(`  - REPLIT_DEPLOYMENT: ${process.env.REPLIT_DEPLOYMENT || 'not set'}`);
console.log(`  - DEPLOY_MODE: ${process.env.DEPLOY_MODE || 'not set'}`);
console.log(`  - NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
console.log(`  - Using: ${isProduction ? '🚀 PRODUCTION' : '🔧 DEV'} database (Replit auto-switches)`);
console.log(`[connection-manager] Database URL: ${maskedUrl}`);

const cfg = {
  connectionString: dbUrl,
  max: Number(process.env.PG_MAX || process.env.DB__POOL_MAX || 10),
  min: Number(process.env.PG_MIN || 2),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 10000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 5000),
  keepAlive: process.env.PG_KEEPALIVE !== 'false',
  keepAliveInitialDelayMillis: Number(process.env.PG_KEEPALIVE_DELAY_MS || 5000),
  maxUses: Number(process.env.PG_MAX_USES || 7500),
  ssl: { rejectUnauthorized: false },
  allowExitOnIdle: false,
  statement_timeout: 5000, // Postgres server-side timeout (5s)
  query_timeout: 5000, // pg client-side timeout (5s)
};

let pool = new Pool(cfg);
let degraded = false;
let lastEvent = null;
let reconnecting = false; // CRITICAL: Prevent race conditions
let poolAlive = true; // CRITICAL: Prevent "Called end on pool more than once"

// No pool wrappers - they cause queries to hang
// Degradation checks are done at middleware level instead

// CRITICAL: Catch errors on idle connections (Neon admin terminations)
pool.on('error', (err, client) => {
  const isTermination = isAdminTermination(err);
  
  ndjson('db.pool.error', {
    is_termination: isTermination,
    code: err.code,
    message: err.message,
    deploy_mode: process.env.DEPLOY_MODE
  });
  
  // If this is an admin termination, trigger degradation and reconnect
  // CRITICAL: Only one reconnection at a time to prevent "end on pool more than once"
  if (isTermination && !reconnecting) {
    reconnecting = true;
    degraded = true;
    lastEvent = 'db.terminated';
    
    ndjson('db.terminated', {
      reason: 'administrator_command_idle',
      err_code: err.code,
      err_message: err.message,
      deploy_mode: process.env.DEPLOY_MODE,
    });
    
    // Don't await - let it run in background
    drainPool()
      .then(() => reconnectWithBackoff())
      .catch(e => ndjson('db.reconnect.loop.error', { error: String(e.message || e) }))
      .finally(() => { reconnecting = false; }); // Reset flag after reconnect completes
  }
});

function isAdminTermination(err) {
  return err?.message?.includes('terminating connection due to administrator command')
      || err?.code === '57P01';
}

async function getBackendPid(client) {
  try {
    const { rows } = await client.query('SELECT pg_backend_pid() AS pid');
    return rows?.[0]?.pid ?? null;
  } catch {
    return null;
  }
}

async function initPool() {
  try {
    const client = await pool.connect();
    const pid = await getBackendPid(client);
    ndjson('db.start', { 
      deploy_mode: process.env.DEPLOY_MODE, 
      pool_max: cfg.max, 
      backend_pid: pid 
    });
    client.release();
  } catch (e) {
    ndjson('db.start.error', { error: String(e.message || e) });
  }
}

async function drainPool() {
  // CRITICAL: Only drain if pool is alive - prevents "Called end on pool more than once"
  if (!poolAlive || !pool) {
    ndjson('db.drain.skip', { reason: 'pool_already_drained' });
    return;
  }
  
  poolAlive = false; // Mark pool as dead BEFORE draining
  ndjson('db.drain.begin', {});
  try { 
    await pool.end(); 
  } catch (e) {
    ndjson('db.drain.error', { error: String(e.message || e) });
  }
  ndjson('db.drain.end', {});
}

async function reconnectWithBackoff() {
  const maxAttempts = Number(process.env.DB__RETRY_MAX || 8);
  const base = Number(process.env.DB__RETRY_BASE_MS || 250);
  const cap = Number(process.env.DB__RETRY_MAX_MS || 5000);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    currentAttempt = attempt;
    const jitter = Math.floor(Math.random() * base);
    const delay = Math.min(base * (2 ** (attempt - 1)) + jitter, cap);
    currentBackoffDelay = delay;
    ndjson('db.reconnect.attempt', { attempt, delay_ms: delay });
    await new Promise(r => setTimeout(r, delay));
    try {
      pool = new Pool(cfg);
      poolAlive = true; // Mark new pool as alive
      
      // Re-attach error handler to new pool instance
      pool.on('error', (err, client) => {
        const isTermination = isAdminTermination(err);
        
        ndjson('db.pool.error', {
          is_termination: isTermination,
          code: err.code,
          message: err.message,
          deploy_mode: process.env.DEPLOY_MODE
        });
        
        // CRITICAL: Only one reconnection at a time
        if (isTermination && !reconnecting) {
          reconnecting = true;
          degraded = true;
          lastEvent = 'db.terminated';
          
          ndjson('db.terminated', {
            reason: 'administrator_command_idle',
            err_code: err.code,
            err_message: err.message,
            deploy_mode: process.env.DEPLOY_MODE,
          });
          
          drainPool()
            .then(() => reconnectWithBackoff())
            .catch(e => ndjson('db.reconnect.loop.error', { error: String(e.message || e) }))
            .finally(() => { reconnecting = false; });
        }
      });
      
      const client = await pool.connect();
      const pid = await getBackendPid(client);
      await client.query('SELECT 1');
      client.release();
      degraded = false;
      lastEvent = 'db.reconnect.success';
      ndjson('db.reconnect.success', { attempt, backend_pid: pid });
      if (process.env.AUDIT__ENABLED === 'true') {
        await insertAudit('db.reconnect.success', pid, 'pg-client', 'administrator_command', process.env.DEPLOY_MODE, { attempt });
      }
      return;
    } catch (e) {
      ndjson('db.reconnect.error', { attempt, error: String(e.message || e) });
      try { await pool.end(); } catch {}
    }
  }
  lastEvent = 'db.reconnect.exhausted';
  ndjson('db.reconnect.exhausted', {});
  if (process.env.AUDIT__ENABLED === 'true') {
    await insertAudit('db.reconnect.exhausted', null, null, 'administrator_command', process.env.DEPLOY_MODE, {});
  }
}

export async function safeQuery(text, params) {
  // CRITICAL: Fast-fail if degraded OR pool is dead
  if (degraded || !poolAlive) {
    ndjson('query.rejected', {
      reason: degraded ? 'degraded' : 'pool_dead',
      sql_hash: crypto.createHash('sha1').update(text).digest('hex'),
    });
    const err = new Error('db_degraded');
    err.status = 503;
    throw err;
  }
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } catch (err) {
    const isTermination = isAdminTermination(err);
    const isExhaustion = isPoolExhaustion(err);
    
    if (isTermination || isExhaustion) {
      const pid = isTermination ? await getBackendPid(client) : null;
      degraded = true;
      lastEvent = isTermination ? 'db.terminated' : 'db.pool.exhausted';
      
      ndjson(lastEvent, {
        reason: isTermination ? 'administrator_command' : 'pool_exhausted',
        err_code: err.code,
        err_message: err.message,
        backend_pid: pid,
        deploy_mode: process.env.DEPLOY_MODE,
      });
      
      if (process.env.AUDIT__ENABLED === 'true') {
        await insertAudit(
          lastEvent, 
          pid, 
          'pg-client', 
          isTermination ? 'administrator_command' : 'pool_exhausted',
          process.env.DEPLOY_MODE, 
          { code: err.code, message: err.message }
        );
      }
      await drainPool();
      reconnectWithBackoff().catch(e => ndjson('db.reconnect.loop.error', { error: String(e.message || e) }));
    }
    throw err;
  } finally {
    client.release();
  }
}

export function getPool() {
  // CRITICAL: Return the actual pool instance for Drizzle ORM
  // Drizzle needs the real pool, not a wrapper object
  // Fast-fail timeouts are configured in pool config (statement_timeout, query_timeout)
  return pool;
}

export function getPoolWrapper() {
  // Legacy wrapper for manual queries - use safeQuery() instead
  return {
    query: (text, params) => safeQuery(text, params),
    connect: async () => {
      // CRITICAL: Check degradation BEFORE attempting to connect
      // This prevents manual queries from hanging when database is down
      if (degraded) {
        ndjson('pool.connect.rejected', {
          reason: 'degraded',
          backoff_delay: currentBackoffDelay
        });
        const err = new Error('db_degraded');
        err.status = 503;
        throw err;
      }
      return pool.connect();
    },
    end: () => pool.end(),
  };
}

let currentAttempt = 0;
let currentBackoffDelay = 0;

export function getAgentState() {
  return { degraded, poolAlive, lastEvent, currentBackoffDelay, reconnecting };
}

function isPoolExhaustion(err) {
  return err?.message?.includes('Client has encountered a connection error')
      || err?.message?.includes('timeout')
      || err?.message?.includes('Connection terminated unexpectedly');
}

async function insertAudit(event, backend_pid, application_name, reason, deploy_mode, details) {
  // OPTIONAL: Audit table may not exist yet - fail silently (just observability)
  if (process.env.AUDIT__ENABLED !== 'true') return;
  
  try {
    await pool.query(
      `INSERT INTO connection_audit (event, backend_pid, application_name, reason, deploy_mode, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [event, backend_pid, application_name, reason, deploy_mode, details ? JSON.stringify(details) : null]
    );
  } catch (e) {
    // Fail silently - audit is nice-to-have, not critical
    // Only log if it's NOT the "table doesn't exist" error
    if (!e.message?.includes('does not exist')) {
      ndjson('audit.insert.error', { error: String(e.message || e), event });
    }
  }
}

initPool().catch(e => ndjson('db.start.error', { error: String(e.message || e) }));
