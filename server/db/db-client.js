import pg from 'pg';
import { dbLog, OP } from '../logger/workflow.js';

let pgClient = null;
let reconnectTimer = null;
let isReconnecting = false;
let keepaliveInterval = null;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function reconnectWithBackoff(connectionString, maxRetries = 5) {
  if (isReconnecting) {
    return;
  }

  isReconnecting = true;
  let retries = 0;

  while (retries < maxRetries) {
    const backoffMs = Math.min(1000 * Math.pow(2, retries), 10000);
    
    await sleep(backoffMs);

    try {
      // Clean up old client
      if (pgClient) {
        try {
          if (keepaliveInterval) {
            clearInterval(keepaliveInterval);
            keepaliveInterval = null;
          }
          pgClient.removeAllListeners();
          await pgClient.end();
        } catch (cleanupErr) {
          // Ignore cleanup errors
        }
        pgClient = null;
      }

      pgClient = new pg.Client({
        connectionString,
        application_name: 'triad-listener',
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000
      });

      setupErrorHandlers(connectionString);

      await pgClient.connect();
      
      // Send keepalive queries every 4 minutes (before 5-min timeout)
      keepaliveInterval = setInterval(() => {
        if (pgClient && !isReconnecting) {
          pgClient.query('SELECT 1').catch(() => {});
        }
      }, 240000); // 4 minutes
      
      dbLog.done(1, `LISTEN client reconnected`, OP.DB);
      isReconnecting = false;
      return pgClient;
    } catch (err) {
      retries++;
    }
  }

  isReconnecting = false;
  throw new Error('Failed to reconnect after maximum retries');
}

function setupErrorHandlers(connectionString) {
  pgClient.on('error', async (err) => {
    if (!isReconnecting) {
      reconnectWithBackoff(connectionString).catch(() => {
        if (pgClient) {
          pgClient.removeAllListeners();
          pgClient = null;
        }
      });
    }
  });

  pgClient.on('end', async () => {
    if (!isReconnecting) {
      reconnectWithBackoff(connectionString).catch(() => {
        if (pgClient) {
          pgClient.removeAllListeners();
          pgClient = null;
        }
      });
    }
  });
}

export async function getListenClient() {
  if (pgClient && pgClient._connected) {
    return pgClient;
  }

  if (isReconnecting) {
    dbLog.info(`Waiting for ongoing reconnection...`, OP.DB);
    let waitCount = 0;
    while (isReconnecting && waitCount < 30) {
      await sleep(1000);
      waitCount++;
    }
    if (pgClient && pgClient._connected) {
      return pgClient;
    }
  }

  // PostgreSQL via Replit MANAGED DATABASE ONLY
  // Replit automatically injects DATABASE_URL for all environments (dev + production)
  // No external databases (Neon, Vercel, Railway) are used
  const connectionString = process.env.DATABASE_URL;
  
  dbLog.phase(1, `LISTEN client connecting to Replit PostgreSQL`, OP.DB);
  
  if (!connectionString) {
    throw new Error('[db-client] No DATABASE_URL found');
  }

  pgClient = new pg.Client({
    connectionString,
    application_name: 'triad-listener',
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000
  });

  setupErrorHandlers(connectionString);

  try {
    await pgClient.connect();
    
    // Send keepalive queries every 4 minutes
    keepaliveInterval = setInterval(() => {
      if (pgClient && !isReconnecting) {
        pgClient.query('SELECT 1').catch(() => {});
      }
    }, 240000);
    
    dbLog.done(1, `LISTEN client connected`, OP.DB);
    return pgClient;
  } catch (err) {
    if (pgClient) {
      pgClient.removeAllListeners();
      pgClient = null;
    }
    throw err;
  }
}

export async function closeListenClient() {
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
  }
  if (pgClient) {
    pgClient.removeAllListeners();
    await pgClient.end();
    pgClient = null;
    dbLog.info(`LISTEN client closed`, OP.DB);
  }
}
