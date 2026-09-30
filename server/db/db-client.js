import pg from 'pg';
import { databaseConnectionConfig } from './connection-config.js';
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

// One physical LISTEN connection, one dispatcher, and desired subscriptions
// retained across outages. A connection is published only after every desired
// channel has been restored. Each token owns its queue and abort signal, so an
// old attempt can neither publish nor unsubscribe a replacement connection.
let current = null;
let connectPromise = null;
let reconnectTimer = null;
let keepaliveInterval = null;
let closed = false;
let retryAttempt = 0;
const channelSubscribers = new Map();
// Direct getListenClient callers own the physical connection until explicit
// close. Subscription acquisition is separate so it does not create that lease.
let explicitOwner = false;
const explicitAcquisitions = new Set();
const SLOW_RETRY_MS = 30_000;

function clearTimers() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (keepaliveInterval) clearInterval(keepaliveInterval);
  reconnectTimer = null;
  keepaliveInterval = null;
}

function requireCurrent(token) {
  if (closed || current !== token || token.controller.signal.aborted) {
    throw token.controller.signal.reason || new Error('LISTEN connection closed');
  }
}

function endClient(token) {
  if (token.ending) return token.ending;
  token.client.removeAllListeners();
  // pg can emit a late socket error after close. Never leave it unhandled.
  token.client.on('error', () => {});
  token.ending = Promise.resolve().then(() => token.client.end()).catch(() => {});
  return token.ending;
}

async function releaseIdleConnection() {
  if (channelSubscribers.size > 0 || explicitOwner || explicitAcquisitions.size > 0) return;
  // Detach before awaiting end: a new subscriber can open a replacement, and
  // the old attempt/finalizer cannot publish or clear that replacement's state.
  const token = current;
  current = null;
  connectPromise = null;
  clearTimers();
  retryAttempt = 0;
  if (token) {
    token.controller.abort(new Error('LISTEN connection idle'));
    await endClient(token);
    dbLog.info('Idle LISTEN client closed', OP.DB);
  }
}

function scheduleRetry() {
  if (closed || reconnectTimer || channelSubscribers.size === 0) return;
  const delay = retryAttempt < 5 ? Math.min(1000 * 2 ** retryAttempt, 10_000) : SLOW_RETRY_MS;
  retryAttempt++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (closed || channelSubscribers.size === 0) return;
    if (connectPromise) { scheduleRetry(); return; }
    // Automatic recovery never changes the explicit shutdown state.
    Promise.resolve().then(() => {
      // The last release or a new successful connection can win while this
      // callback is queued. Automatic retry never recreates idle ownership.
      if (closed || channelSubscribers.size === 0 || current?.ready) return;
      return startConnection();
    }).catch(() => scheduleRetry());
  }, delay);
  reconnectTimer.unref?.();
}

function failConnection(token, error) {
  if (current !== token) return;
  current = null;
  if (keepaliveInterval) clearInterval(keepaliveInterval);
  keepaliveInterval = null;
  token.controller.abort(error);
  void endClient(token);
  scheduleRetry();
}

function duringConnection(token, operation) {
  requireCurrent(token);
  return Promise.race([operation, token.aborted]);
}

// Serialize LISTEN/UNLISTEN against the *latest* desired subscriber set, not the
// set captured before an await. A new subscriber arriving during UNLISTEN is
// re-LISTENed before either reconciliation reports completion.
function reconcileChannels(token) {
  const work = token.queue.then(async () => {
    requireCurrent(token);
    if (!token.connected) return;
    while (true) {
      const channels = new Set([...channelSubscribers.keys(), ...token.listening]);
      let changed = false;
      for (const channel of channels) {
        requireCurrent(token);
        const wanted = (channelSubscribers.get(channel)?.size || 0) > 0;
        if (wanted === token.listening.has(channel)) continue;
        await duringConnection(token, token.client.query(`${wanted ? 'LISTEN' : 'UNLISTEN'} "${channel}"`));
        requireCurrent(token);
        if (wanted) token.listening.add(channel); else token.listening.delete(channel);
        _emitChannel(channel, wanted ? 'subscribers ready - LISTEN' : 'no subscribers - UNLISTEN');
        changed = true;
      }
      // Re-read after every asynchronous command; no await between this final
      // check and returning, so a subsequently arriving caller queues its turn.
      if (!changed) return;
    }
  });
  const result = work.catch(error => { failConnection(token, error); throw error; });
  token.queue = result.catch(() => {});
  return result;
}

function attachDispatcher(token) {
  token.client.on('notification', msg => {
    if (closed || current !== token || !token.connected) return;
    const subscribers = channelSubscribers.get(msg.channel);
    if (!subscribers?.size) return;
    _emitChannel(msg.channel, `NOTIFY → ${subscribers.size} subscriber(s)`);
    for (const callback of [...subscribers]) {
      try {
        Promise.resolve(callback(msg.payload)).catch(err => console.error('[NOTIFY] Subscriber error:', err));
      } catch (err) {
        console.error('[NOTIFY] Subscriber error:', err);
      }
    }
  });
}

function startConnection() {
  if (connectPromise) return connectPromise;
  if (closed) return Promise.reject(new Error('LISTEN connection closed'));
  const client = new pg.Client({
    ...databaseConnectionConfig(),
    application_name: 'triad-listener',
    connectionTimeoutMillis: 15_000,
    query_timeout: 15_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });
  const controller = new AbortController();
  const token = { client, controller, connected: false, ready: false, listening: new Set(), queue: Promise.resolve() };
  token.aborted = new Promise((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  });
  token.aborted.catch(() => {});
  current = token;
  client.on('error', error => failConnection(token, error));
  client.on('end', () => failConnection(token, new Error('LISTEN connection ended')));
  attachDispatcher(token);
  dbLog.phase(1, 'LISTEN client connecting', OP.DB);
  const attempt = (async () => {
    try {
      await duringConnection(token, client.connect());
      requireCurrent(token);
      token.connected = true;
      await reconcileChannels(token);
      requireCurrent(token);
      token.ready = true;
      // LISTEN has no durable replay. Existing HTTP streams need a saved-state
      // wake-up after a database-only reconnect even when their sockets stayed up.
      for (const subscribers of channelSubscribers.values()) {
        for (const subscriber of subscribers) {
          const restored = subscriber.connection && subscriber.connection !== token;
          subscriber.connection = token;
          if (restored && typeof subscriber.onReconnect === 'function') {
            Promise.resolve().then(() => {
              if (!closed && current === token && subscribers.has(subscriber)) return subscriber.onReconnect();
            }).catch(() => console.error('[NOTIFY] Recovery callback failed'));
          }
        }
      }
      retryAttempt = 0;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      keepaliveInterval = setInterval(() => {
        if (current !== token || closed) return;
        token.client.query('SELECT 1').catch(error => failConnection(token, error));
      }, 240_000);
      keepaliveInterval.unref?.();
      dbLog.done(1, 'LISTEN client connected and subscriptions restored', OP.DB);
      return client;
    } catch (error) {
      failConnection(token, error);
      void endClient(token);
      throw error;
    } finally {
      if (connectPromise === attempt) connectPromise = null;
    }
  })();
  connectPromise = attempt;
  return attempt;
}

async function acquireListenClient() {
  // Only an explicit caller can reopen after closeListenClient(). A late
  // timer, old socket error, or unsubscribe cannot undo shutdown.
  closed = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (current?.ready) return current.client;
  return startConnection();
}

export async function getListenClient() {
  const acquisition = {};
  explicitAcquisitions.add(acquisition);
  try {
    const client = await acquireListenClient();
    if (!explicitAcquisitions.has(acquisition) || current?.client !== client) {
      throw new Error('LISTEN connection replaced during explicit acquisition');
    }
    explicitOwner = true;
    return client;
  } finally {
    explicitAcquisitions.delete(acquisition);
    if (!explicitOwner) await releaseIdleConnection();
  }
}

export async function closeListenClient() {
  closed = true;
  explicitOwner = false;
  explicitAcquisitions.clear();
  clearTimers();
  retryAttempt = 0;
  const token = current;
  current = null;
  connectPromise = null;
  if (token) {
    token.controller.abort(new Error('LISTEN connection closed'));
    await endClient(token);
    dbLog.info('LISTEN client closed', OP.DB);
  }
}

/** Register one independently releasable subscription to the shared dispatcher. */
export async function subscribeToChannel(channel, callback, { onReconnect } = {}) {
  if (typeof channel !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(channel)) {
    throw new Error('Invalid PostgreSQL notification channel');
  }
  if (typeof callback !== 'function') throw new TypeError('Notification callback must be a function');
  // Unique wrapper: two streams may legitimately supply the same function.
  const subscriber = payload => callback(payload);
  subscriber.onReconnect = onReconnect;
  subscriber.connection = null;
  let subscribers = channelSubscribers.get(channel);
  if (!subscribers) { subscribers = new Set(); channelSubscribers.set(channel, subscribers); }
  subscribers.add(subscriber);
  const remove = () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0 && channelSubscribers.get(channel) === subscribers) channelSubscribers.delete(channel);
  };
  try {
    const client = await acquireListenClient();
    const token = current;
    if (!token || token.client !== client) throw new Error('LISTEN connection replaced during subscription');
    await reconcileChannels(token);
    subscriber.connection = token;
  } catch (error) {
    remove();
    await releaseIdleConnection();
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    remove();
    // Cleanup must not establish a new connection. A connecting replacement
    // reads this updated desired set before it can be returned as ready.
    const token = current;
    if (token?.connected && !closed) {
      try { await reconcileChannels(token); } catch { /* Recovery restores surviving subscriptions. */ }
    }
    await releaseIdleConnection();
  };
}
