import pg from 'pg';
import { dbLog, chainLog, OP } from '../logger/workflow.js';

// 2026-04-28 (memory 208 + 230): derive parent stage + sub from PostgreSQL
// channel name so [DB] [LISTEN/NOTIFY] lines emit under the correct workflow
// stage (e.g. briefing_weather_ready -> [BRIEFING] [WEATHER] [DB] [LISTEN/NOTIFY]
// [briefing_weather_ready]).
function _chainFromChannel(channel) {
  if (!channel) return { parent: 'GATEWAY', sub: null };
  const parts = String(channel).split('_');
  const head = parts[0]?.toLowerCase();
  if (head === 'briefing') {
    if (parts.length >= 3 && parts[parts.length - 1] === 'ready') {
      const subParts = parts.slice(1, -1);
      const sub = subParts.length > 0 ? subParts.join('_').toUpperCase() : null;
      return { parent: 'BRIEFING', sub };
    }
    return { parent: 'BRIEFING', sub: null };
  }
  if (head === 'strategy') return { parent: 'STRATEGY', sub: null };
  if (head === 'venue' || head === 'venuecards') return { parent: 'VENUE', sub: null };
  if (head === 'blocks') return { parent: 'VENUE', sub: null };
  if (head === 'events') return { parent: 'EVENTS', sub: null };
  // 2026-08-06: offer_analyzed brackets under the feature's existing chain
  // (strategy-events.js logs it as [STRATEGY] [OFFERS]). The old fallback
  // 'WORKFLOW' is not a registered main category — every emit for an unmapped
  // channel triggered the chainLog LOGGER WARN. GATEWAY is the registered
  // orphan fail-safe (workflow.js tagLog).
  if (head === 'offer') return { parent: 'STRATEGY', sub: 'OFFERS' };
  return { parent: 'GATEWAY', sub: null };
}

function _emitChannel(channel, message, level = 'info') {
  const { parent, sub } = _chainFromChannel(channel);
  chainLog({ parent, sub, callTypes: ['DB', 'LISTEN/NOTIFY'], table: channel, level }, message);
}

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
          // 2026-08-06: a previously-connected client can emit a late socket
          // 'error' between removeAllListeners() and teardown. With zero
          // listeners, that raises Node's unhandled-'error'-event exception →
          // gateway uncaughtException → process.exit(1). Neon idle disconnects
          // exercise this window on a multi-hour cadence (verified crash
          // candidate for the prod healthcheck bursts).
          pgClient.on('error', () => {});
          await pgClient.end();
        } catch (cleanupErr) {
          // Ignore cleanup errors
        }
        pgClient = null;
      }

      // 2026-02-17 → 2026-08-17: the notification dispatcher is attached PER CLIENT
      // (attachDispatcher, WeakSet-guarded, ignores a client that is no longer the
      // current pgClient) — no module flag to reset, and an orphaned client can never
      // double-deliver to SSE subscribers.

      pgClient = new pg.Client({
        connectionString,
        application_name: 'triad-listener',
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000
      });

      setupErrorHandlers(connectionString);

      await pgClient.connect();

      // 2026-02-17: FIX - Re-subscribe all active channels after reconnect
      // The old client's LISTEN commands are lost on disconnect. Re-issue them
      // on the new client so existing SSE subscribers continue receiving events.
      await resubscribeChannels();

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

// 2026-08-17 (race/SSE review finding #5): when reconnectWithBackoff exhausts its 5
// retries (~25 s of DB unavailability — an autoscale hiccup is enough) the client was
// dropped and NOTHING tried again: every open SSE stream (offers, strategy, briefing,
// blocks) stayed deaf until a NEW subscriber happened to call getListenClient() —
// and even then the fresh-connect path never re-issued LISTEN for the surviving
// channels. Now: (a) the fresh-connect path re-LISTENs + re-attaches the dispatcher
// (see getListenClient), and (b) after exhaustion we keep trying on a slow cadence
// for as long as anyone is subscribed.
const SLOW_RETRY_MS = 30_000;
let slowRetryAnnounced = false; // one error line per outage, not one every 30 s
function _dropClientAndScheduleSlowRetry() {
  if (pgClient) {
    pgClient.removeAllListeners();
    pgClient.on('error', () => {}); // 2026-08-06: never leave a client listener-less (see reconnect cleanup)
    pgClient = null;
  }
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
  }
  if (channelSubscribers.size === 0 || reconnectTimer) return;
  if (!slowRetryAnnounced) {
    dbLog.error(1, `LISTEN client gave up after max retries — ${channelSubscribers.size} channel(s) still subscribed; retrying every ${SLOW_RETRY_MS / 1000}s until it is back`, null, OP.DB);
    slowRetryAnnounced = true;
  }
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (channelSubscribers.size === 0) { slowRetryAnnounced = false; return; } // everyone left — nothing to restore
    try {
      await getListenClient(); // fresh connect → resubscribeChannels() re-LISTENs every surviving channel
      slowRetryAnnounced = false;
      dbLog.done(1, `LISTEN client restored after slow retry`, OP.DB);
    } catch {
      _dropClientAndScheduleSlowRetry();
    }
  }, SLOW_RETRY_MS);
  reconnectTimer.unref?.();
}

function setupErrorHandlers(connectionString) {
  pgClient.on('error', async (err) => {
    if (!isReconnecting) {
      reconnectWithBackoff(connectionString).catch(() => _dropClientAndScheduleSlowRetry());
    }
  });

  pgClient.on('end', async () => {
    if (!isReconnecting) {
      reconnectWithBackoff(connectionString).catch(() => _dropClientAndScheduleSlowRetry());
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

  // DATABASE_URL auto-injected by Replit (Helium PostgreSQL 16)
  const connectionString = process.env.DATABASE_URL;

  dbLog.phase(1, `LISTEN client connecting to Replit PostgreSQL`, OP.DB);

  if (!connectionString) {
    throw new Error('[db-client] No DATABASE_URL found');
  }

  // Create and store the connection promise
  connectPromise = (async () => {
    // 2026-02-26: SSL conditional — Helium (dev) runs locally without SSL
    const isProduction = process.env.REPLIT_DEPLOYMENT === '1' || process.env.NODE_ENV === 'production';
    pgClient = new pg.Client({
      connectionString,
      application_name: 'triad-listener',
      ssl: isProduction ? { rejectUnauthorized: false } : false,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000
    });

    setupErrorHandlers(connectionString);

    try {
      await pgClient.connect();

      // 2026-08-17 (finding #5): a brand-new client has no LISTENs and no dispatcher.
      // If subscribers survived a dropped client (reconnect exhausted → slow retry, or
      // a closeListenClient/reopen), restore them here exactly like the reconnect path
      // does — otherwise those SSE streams stay deaf on a healthy connection.
      await resubscribeChannels();

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
        pgClient.on('error', () => {}); // never leave a client listener-less
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
  if (reconnectTimer) { // a pending slow retry must not reopen a connection during shutdown
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (pgClient) {
    pgClient.removeAllListeners();
    pgClient.on('error', () => {}); // never leave a client listener-less (see reconnect cleanup)
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
// 2026-08-17: the dispatcher is attached once PER CLIENT (was a module-level boolean that
// could go stale on a dead client — every stream deaf — or, if a reconnect loop overlapped
// a fresh connect, let two live clients both deliver → every NOTIFY twice). The handler
// also ignores notifications from a client that is no longer the current pgClient.
const dispatcherAttached = new WeakSet();
function attachDispatcher(client) {
  if (!client || dispatcherAttached.has(client)) return false;
  client.on('notification', (msg) => {
    if (client !== pgClient) return; // orphaned client — the current one delivers
    const subscribers = channelSubscribers.get(msg.channel);
    if (subscribers && subscribers.size > 0) {
      _emitChannel(msg.channel, `NOTIFY → ${subscribers.size} subscriber(s)`);
      subscribers.forEach(cb => {
        try {
          cb(msg.payload);
        } catch (err) {
          console.error(`[NOTIFY] Subscriber error:`, err);
        }
      });
    }
  });
  dispatcherAttached.add(client);
  return true;
}

/**
 * Re-attach LISTEN commands and notification handler after reconnect.
 * 2026-02-17: FIX for SSE "Client has encountered a connection error and is not queryable"
 *
 * When the LISTEN client reconnects, the new pgClient has no LISTEN commands
 * and no 'notification' handler. This function restores both from the surviving
 * channelSubscribers map (SSE connections outlive the DB connection).
 */
async function resubscribeChannels() {
  if (!pgClient || channelSubscribers.size === 0) return;

  // Re-issue LISTEN for all active channels
  for (const [channel, subs] of channelSubscribers.entries()) {
    if (subs.size === 0) {
      channelSubscribers.delete(channel);
      continue;
    }
    try {
      await pgClient.query(`LISTEN ${channel}`);
      _emitChannel(channel, `Re-LISTENed (${subs.size} subscriber(s))`);
    } catch (err) {
      dbLog.error(1, `Failed to re-LISTEN ${channel}: ${err.message}`, err, OP.DB);
    }
  }

  // Re-attach the notification dispatcher on the new client (per-client, idempotent)
  if (attachDispatcher(pgClient)) {
    dbLog.info(`Notification dispatcher re-attached after reconnect`, OP.DB);
  }
}

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
    _emitChannel(channel, 'first subscriber - LISTEN');
  }

  // Add callback to subscribers
  channelSubscribers.get(channel).add(callback);
  const subscriberCount = channelSubscribers.get(channel).size;
  _emitChannel(channel, `${subscriberCount} subscriber(s)`);

  // Attach the single per-client notification dispatcher (idempotent)
  if (attachDispatcher(client)) {
    dbLog.info(`Notification dispatcher attached`, OP.DB);
  }

  // Return unsubscribe function
  return async () => {
    const subs = channelSubscribers.get(channel);
    if (subs) {
      subs.delete(callback);
      _emitChannel(channel, `${subs.size} subscriber(s) remaining`);

      // Last subscriber? UNLISTEN
      if (subs.size === 0) {
        channelSubscribers.delete(channel);
        try {
          const cl = await getListenClient();
          await cl.query(`UNLISTEN ${channel}`);
          _emitChannel(channel, 'no subscribers - UNLISTEN');
        } catch (err) {
          // Connection may be closed
        }
      }
    }
  };
}
