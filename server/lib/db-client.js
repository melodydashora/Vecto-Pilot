import pg from 'pg';

let pgClient = null;

export async function getListenClient() {
  if (pgClient && pgClient._connected) {
    return pgClient;
  }

  // CRITICAL: Use unpooled connection for LISTEN/NOTIFY
  // Neon's pooler (pgBouncer) does not support LISTEN/NOTIFY
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  
  if (!connectionString) {
    throw new Error('[db-client] No DATABASE_URL or DATABASE_URL_UNPOOLED found');
  }
  
  // Warn if using pooled connection (won't work with LISTEN)
  if (connectionString.includes('pooler') && !process.env.DATABASE_URL_UNPOOLED) {
    console.warn('[db-client] ⚠️  WARNING: Using pooled connection for LISTEN - this may not work!');
    console.warn('[db-client] ⚠️  Set DATABASE_URL_UNPOOLED for reliable LISTEN/NOTIFY support');
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
