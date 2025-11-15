import pg from 'pg';

let pgClient = null;
let reconnectTimer = null;
let isReconnecting = false;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function reconnectWithBackoff(connectionString, maxRetries = 5) {
  if (isReconnecting) {
    console.log('[db-client] 🔄 Reconnection already in progress, skipping...');
    return;
  }

  isReconnecting = true;
  let retries = 0;

  while (retries < maxRetries) {
    const backoffMs = Math.min(1000 * Math.pow(2, retries), 30000);
    console.log(`[db-client] 🔄 Reconnection attempt ${retries + 1}/${maxRetries} in ${backoffMs}ms...`);
    
    await sleep(backoffMs);

    try {
      if (pgClient) {
        try {
          pgClient.removeAllListeners();
          await pgClient.end();
        } catch (cleanupErr) {
          console.warn('[db-client] Cleanup error (ignored):', cleanupErr.message);
        }
        pgClient = null;
      }

      pgClient = new pg.Client({
        connectionString,
        application_name: 'triad-listener',
      });

      setupErrorHandlers(connectionString);

      await pgClient.connect();
      console.log('[db-client] ✅ LISTEN client reconnected successfully');
      isReconnecting = false;
      return pgClient;
    } catch (err) {
      console.error(`[db-client] ❌ Reconnection attempt ${retries + 1} failed:`, err.message);
      retries++;
    }
  }

  isReconnecting = false;
  console.error('[db-client] ❌ Max reconnection attempts reached, giving up');
  throw new Error('Failed to reconnect after maximum retries');
}

function setupErrorHandlers(connectionString) {
  pgClient.on('error', async (err) => {
    console.error('[db-client] ❌ PostgreSQL client error:', err.message);
    console.log('[db-client] 🔄 Initiating automatic reconnection...');
    
    try {
      await reconnectWithBackoff(connectionString);
    } catch (reconnectErr) {
      console.error('[db-client] ❌ Auto-reconnect failed:', reconnectErr.message);
      if (pgClient) {
        pgClient.removeAllListeners();
        pgClient = null;
      }
    }
  });

  pgClient.on('end', async () => {
    console.warn('[db-client] ⚠️  PostgreSQL client connection ended');
    console.log('[db-client] 🔄 Initiating automatic reconnection...');
    
    try {
      await reconnectWithBackoff(connectionString);
    } catch (reconnectErr) {
      console.error('[db-client] ❌ Auto-reconnect failed:', reconnectErr.message);
      if (pgClient) {
        pgClient.removeAllListeners();
        pgClient = null;
      }
    }
  });
}

export async function getListenClient() {
  if (pgClient && pgClient._connected) {
    return pgClient;
  }

  if (isReconnecting) {
    console.log('[db-client] ⏳ Waiting for ongoing reconnection...');
    let waitCount = 0;
    while (isReconnecting && waitCount < 30) {
      await sleep(1000);
      waitCount++;
    }
    if (pgClient && pgClient._connected) {
      return pgClient;
    }
  }

  // CRITICAL: Use unpooled connection for LISTEN/NOTIFY
  // Neon's pooler (pgBouncer) does not support LISTEN/NOTIFY
  
  // CRITICAL: Respect dev/prod database routing (same logic as connection-manager.js)
  const isProduction = process.env.REPLIT_DEPLOYMENT === '1' || process.env.REPLIT_DEPLOYMENT === 'true';
  const baseDbUrl = isProduction ? process.env.DATABASE_URL : (process.env.DEV_DATABASE_URL || process.env.DATABASE_URL);
  let connectionString = process.env.DATABASE_URL_UNPOOLED || baseDbUrl;
  
  console.log(`[db-client] LISTEN client using ${isProduction ? 'PRODUCTION' : 'DEV'} database`);
  
  if (!connectionString) {
    throw new Error('[db-client] No DATABASE_URL or DEV_DATABASE_URL found');
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

  setupErrorHandlers(connectionString);

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
