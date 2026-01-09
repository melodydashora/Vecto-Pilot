import pg from 'pg';
import { dbLog, OP } from '../logger/workflow.js';

let pgClient = null;
let reconnectTimer = null;
let isReconnecting = false;
let keepaliveInterval = null;
// 2026-01-09: Add connection promise to prevent race condition on initial connect
// Multiple concurrent getListenClient() calls could each see pgClient=null
// and create multiple clients. This promise ensures only one connection attempt.
let connectPromise = null;

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
  // Return existing connected client
  if (pgClient && pgClient._connected) {
    return pgClient;
  }

  // Wait for ongoing reconnection
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

  // 2026-01-09: Use connection promise to prevent race condition
  // Multiple concurrent calls see pgClient=null and try to connect simultaneously
  // This ensures only one connection attempt occurs
  if (connectPromise) {
    dbLog.info(`Waiting for ongoing connection...`, OP.DB);
    return connectPromise;
  }

  // PostgreSQL via Replit MANAGED DATABASE ONLY
  // Replit automatically injects DATABASE_URL for all environments (dev + production)
  // No external databases (Neon, Vercel, Railway) are used
  const connectionString = process.env.DATABASE_URL;

  dbLog.phase(1, `LISTEN client connecting to Replit PostgreSQL`, OP.DB);

  if (!connectionString) {
    throw new Error('[db-client] No DATABASE_URL found');
  }

  // Create and store the connection promise
  connectPromise = (async () => {
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
    } finally {
      // Clear promise after attempt completes (success or failure)
      connectPromise = null;
    }
  })();

  return connectPromise;
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

// ============================================================================
// NOTIFICATION DISPATCHER - Singleton pattern for PostgreSQL LISTEN/NOTIFY
// ============================================================================
// PROBLEM: Each SSE connection was adding its own 'notification' handler to
// the shared pgClient. With 23 connections, one NOTIFY triggered 23 handlers.
//
// SOLUTION: One handler on pgClient, dispatches to subscribers per channel.
// Each SSE connection subscribes to the dispatcher, not directly to pgClient.
// ============================================================================

const channelSubscribers = new Map(); // channel -> Set of callbacks
let notificationHandlerAttached = false;

/**
 * Subscribe to PostgreSQL NOTIFY events for a specific channel.
 * Uses shared dispatcher - only one handler on pgClient, many subscribers.
 *
 * @param {string} channel - The PostgreSQL channel name (e.g., 'briefing_ready')
 * @param {Function} callback - Called with (payload) when notification received
 * @returns {Function} Unsubscribe function
 */
export async function subscribeToChannel(channel, callback) {
  const client = await getListenClient();

  // First subscriber for this channel? Set up LISTEN
  if (!channelSubscribers.has(channel)) {
    channelSubscribers.set(channel, new Set());
    await client.query(`LISTEN ${channel}`);
    dbLog.phase(1, `LISTEN ${channel} (first subscriber)`, OP.DB);
  }

  // Add callback to subscribers
  channelSubscribers.get(channel).add(callback);
  const subscriberCount = channelSubscribers.get(channel).size;
  dbLog.info(`Channel ${channel}: ${subscriberCount} subscriber(s)`, OP.DB);

  // Attach single notification handler if not already attached
  if (!notificationHandlerAttached) {
    client.on('notification', (msg) => {
      const subscribers = channelSubscribers.get(msg.channel);
      if (subscribers && subscribers.size > 0) {
        // Parse payload once, dispatch to all subscribers
        dbLog.done(1, `NOTIFY ${msg.channel} → ${subscribers.size} subscriber(s)`, OP.SSE);
        subscribers.forEach(cb => {
          try {
            cb(msg.payload);
          } catch (err) {
            console.error(`[NotificationDispatcher] Subscriber error:`, err);
          }
        });
      }
    });
    notificationHandlerAttached = true;
    dbLog.info(`Notification dispatcher attached`, OP.DB);
  }

  // Return unsubscribe function
  return async () => {
    const subs = channelSubscribers.get(channel);
    if (subs) {
      subs.delete(callback);
      dbLog.info(`Channel ${channel}: ${subs.size} subscriber(s) remaining`, OP.DB);

      // Last subscriber? UNLISTEN
      if (subs.size === 0) {
        channelSubscribers.delete(channel);
        try {
          const cl = await getListenClient();
          await cl.query(`UNLISTEN ${channel}`);
          dbLog.phase(1, `UNLISTEN ${channel} (no subscribers)`, OP.DB);
        } catch (err) {
          // Connection may be closed
        }
      }
    }
  };
}
