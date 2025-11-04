import pg from 'pg';

let pgClient = null;

export async function getListenClient() {
  if (pgClient && pgClient._connected) {
    return pgClient;
  }

  // CRITICAL: Use unpooled connection for LISTEN/NOTIFY
  // Neon's pooler (pgBouncer) does not support LISTEN/NOTIFY
  let connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  
  if (!connectionString) {
    throw new Error('[db-client] No DATABASE_URL or DATABASE_URL_UNPOOLED found');
  }
  
  // AUTO-DERIVE UNPOOLED URL: If we have a pooled Neon URL and no explicit unpooled URL,
  // automatically derive it by removing the -pooler suffix from the subdomain
  if (connectionString.includes('-pooler.') && !process.env.DATABASE_URL_UNPOOLED) {
    // Convert pooled URL to unpooled by removing -pooler from subdomain
    // Example: postgres://user:pass@ep-xxx-pooler.region.aws.neon.tech/db
    // Becomes: postgres://user:pass@ep-xxx.region.aws.neon.tech/db
    connectionString = connectionString.replace('-pooler.', '.');
    console.log('[db-client] 🔧 Auto-derived unpooled URL from pooled DATABASE_URL');
    console.log('[db-client] 🔧 Removed -pooler suffix for LISTEN/NOTIFY support');
  }
  
  // Warn if still using pooled connection (won't work with LISTEN)
  if (connectionString.includes('pooler')) {
    console.warn('[db-client] ⚠️  WARNING: Still using pooled connection for LISTEN - this will not work!');
    console.warn('[db-client] ⚠️  LISTEN/NOTIFY requires an unpooled connection');
  }

  pgClient = new pg.Client({
    connectionString,
    application_name: 'triad-listener',
  });

  // CRITICAL: Attach error handlers BEFORE connecting to prevent unhandled errors
  pgClient.on('error', (err) => {
    console.error('[db-client] ❌ PostgreSQL client error:', err.message);
    console.error('[db-client] Connection will be reset on next request');
    // Don't null out immediately - let cleanup happen gracefully
    if (pgClient) {
      pgClient.removeAllListeners();
      pgClient = null;
    }
  });

  pgClient.on('end', () => {
    console.warn('[db-client] ⚠️  PostgreSQL client connection ended');
    if (pgClient) {
      pgClient.removeAllListeners();
      pgClient = null;
    }
  });

  try {
    await pgClient.connect();
    console.log('[db-client] ✅ LISTEN client connected');
    return pgClient;
  } catch (err) {
    console.error('[db-client] ❌ Failed to connect LISTEN client:', err.message);
    if (pgClient) {
      pgClient.removeAllListeners();
      pgClient = null;
    }
    throw err;
  }
}

export async function closeListenClient() {
  if (pgClient) {
    await pgClient.end();
    pgClient = null;
    console.log('[db-client] LISTEN client closed');
  }
}
