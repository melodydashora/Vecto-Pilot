// server/lib/offers/request-dedup.js
// 2026-08-17 (race/duplicate review, finding #1): idempotency for the analyze-offer
// hot path — pure, DB-free, unit-tested with an injected clock.
//
// WHY: nothing deduplicated an identical POST. Every double fire (Back Tap firing
// twice, a share-sheet re-run, a phone that timed out and re-sent while the server
// was still finishing Phase 1, MacroDroid's Screenshot Content trigger polling)
// cost a second Phase-1 model call, a second Phase-2 deep call, up to 5 Google
// calls and a SECOND offer_intelligence row + pg_notify — skewing the dataset and
// the accept/reject stats.
//
// HOW: the route fingerprints (identity + content), then `claim(key)`:
//   • miss  → the caller computes the answer and calls settle(payload) once it has
//             responded (or fail(err) if it could not). The entry lives TTL ms.
//   • hit   → the caller awaits `promise` (already-settled → immediate replay;
//             still in flight → the second request gets the SAME answer the moment
//             the first one has it — this is the phone-timeout-and-resend case) and
//             replays it WITHOUT running Phase 1 or Phase 2 again.
// A failed original is deleted on fail() so the next identical request computes
// fresh — a failure is never replayed. Per-instance (Cloud Run autoscale can land
// duplicates on different instances); the storage-level guard in analyze-offer.js
// (parsed_data_json.request_hash within DUPLICATE_WINDOW) covers that gap.
//
// createTtlMemo(): the same bounded TTL map, exposed generically for the geocode /
// Places / Timezone memos in analyze-offer.js (airport-queue cost — identical
// "Terminal B…" strings re-resolved for every offer).

import crypto from 'node:crypto';

export const DEFAULT_DEDUP_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 500;

/**
 * Deterministic fingerprint of an analyze-offer request: WHO (token > device_id >
 * ip) + WHAT (whitespace-normalized text and/or the image bytes). Coordinates and
 * source are deliberately excluded — a re-send after a phone timeout may carry a
 * slightly different GPS fix and the vision/text lanes carry different content anyway.
 * @param {{identity: string, text?: string|null, image?: string|null}} p
 * @returns {string} 32 hex chars
 */
export function requestFingerprint({ identity, text, image }) {
  const h = crypto.createHash('sha256');
  h.update(String(identity ?? ''));
  h.update('\n');
  if (typeof text === 'string' && text.trim()) {
    h.update('t:');
    h.update(text.replace(/\s+/g, ' ').trim());
  }
  h.update('\n');
  if (typeof image === 'string' && image.length) {
    // The base64 string as sent (data: prefix included) — an identical re-send is
    // byte-identical; hashing avoids holding MBs in the map key.
    h.update('i:');
    h.update(crypto.createHash('sha256').update(image).digest('hex'));
  }
  return h.digest('hex').slice(0, 32);
}

/**
 * @param {{ttlMs?: number, maxEntries?: number, now?: () => number}} [opts]
 */
export function createRequestDedup({ ttlMs = DEFAULT_DEDUP_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES, now = Date.now } = {}) {
  const entries = new Map(); // key → { promise, createdAt, expiresAt, settled, resolve, reject }

  function sweep() {
    const t = now();
    for (const [k, e] of entries) {
      if (e.expiresAt <= t) entries.delete(k);
    }
    while (entries.size >= maxEntries) {
      entries.delete(entries.keys().next().value); // Map preserves insertion order → oldest first
    }
  }

  return {
    /**
     * @param {string} key
     * @returns {{hit: true, promise: Promise<any>, ageMs: number} | {hit: false, settle: (payload:any)=>void, fail: (err:any)=>void}}
     */
    claim(key) {
      sweep();
      const existing = entries.get(key);
      if (existing) {
        return { hit: true, promise: existing.promise, ageMs: now() - existing.createdAt };
      }
      let resolve, reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      promise.catch(() => {}); // a failure with no waiter must not surface as an unhandled rejection
      const entry = { promise, createdAt: now(), expiresAt: now() + ttlMs, settled: false, resolve, reject };
      entries.set(key, entry);
      return {
        hit: false,
        settle(payload) {
          if (entry.settled) return;
          entry.settled = true;
          entry.resolve(payload);
        },
        fail(err) {
          if (entry.settled) return;
          entry.settled = true;
          if (entries.get(key) === entry) entries.delete(key); // never replay a failure
          entry.reject(err instanceof Error ? err : new Error(String(err)));
        },
      };
    },
    size() { sweep(); return entries.size; },
    clear() { entries.clear(); },
  };
}

/**
 * Bounded TTL memo for pure lookups (geocode / Places / Timezone results).
 * Only the caller decides what is worth remembering — never memoize a null/failed answer.
 * @param {{ttlMs: number, maxEntries?: number, now?: () => number}} opts
 */
export function createTtlMemo({ ttlMs, maxEntries = 1000, now = Date.now }) {
  const entries = new Map(); // key → { value, expiresAt }
  return {
    get(key) {
      const e = entries.get(key);
      if (!e) return undefined;
      if (e.expiresAt <= now()) { entries.delete(key); return undefined; }
      return e.value;
    },
    set(key, value) {
      if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
      entries.set(key, { value, expiresAt: now() + ttlMs });
      return value;
    },
    has(key) { return this.get(key) !== undefined; },
    size() { return entries.size; },
    clear() { entries.clear(); },
  };
}
