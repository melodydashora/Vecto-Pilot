// server/lib/venue/resolution-coalescer.js
// 2026-08-26 (Melody's #2: prevent repeated Google address lookups while
// recommendations load): stampede control for venue address resolution.
//
// WHY: every GET poll of a READY Smart Blocks snapshot re-enters
// mapCandidatesToBlocks → resolveVenueAddressesBatch → resolveVenueAddress
// (blocks-fast.js). venue_catalog absorbs repeats only when the upsert
// succeeded — a geocoding-fallback result with no venue name is never
// upserted, and a failed upsert is non-blocking — so those venues re-called
// Google Places/Geocoding on EVERY poll, and two concurrent polls both
// called on any cache miss. Total-failure throws (fail-loud, by design)
// cached nothing, so a stampede of polls re-hit both APIs each time.
//
// HOW: one entry per key holding the resolution PROMISE.
//   • in flight  → every caller shares the same promise (one upstream call).
//   • resolved   → served for positiveTtlMs (shields the never-upserted
//                  geocode case between polls; venue_catalog covers beyond).
//   • rejected   → the SAME rejection is served for negativeTtlMs — every
//                  caller still fails loudly, but a poll stampede cannot
//                  multiply upstream calls; after the window the next caller
//                  retries fresh (an API blip recovers in ~a minute).
//
// Per-instance, like the request-dedup memos (Cloud Run autoscale note in
// server/lib/offers/request-dedup.js — the storage-level venue_catalog cache
// covers the cross-instance gap for successes). PURE (no db imports, injected
// clock) — jest-safe; regression coverage in
// tests/venue/resolution-coalescer.test.js.

export const DEFAULT_POSITIVE_TTL_MS = 10 * 60_000;
export const DEFAULT_NEGATIVE_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 500;

/**
 * @param {{positiveTtlMs?: number, negativeTtlMs?: number, maxEntries?: number, now?: () => number}} [opts]
 */
export function createResolutionCoalescer({
  positiveTtlMs = DEFAULT_POSITIVE_TTL_MS,
  negativeTtlMs = DEFAULT_NEGATIVE_TTL_MS,
  maxEntries = DEFAULT_MAX_ENTRIES,
  now = Date.now,
} = {}) {
  const entries = new Map(); // key → { promise, expiresAt }

  function sweep() {
    const t = now();
    for (const [k, e] of entries) {
      if (e.expiresAt <= t) entries.delete(k);
    }
  }

  return {
    /**
     * Run `fn` for `key`, sharing in-flight and recent outcomes.
     * The returned promise rejects exactly as `fn`'s does — failures stay loud.
     * @param {string} key
     * @param {() => Promise<any>} fn
     * @returns {Promise<any>}
     */
    run(key, fn) {
      sweep();
      const existing = entries.get(key);
      if (existing) return existing.promise;

      if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);

      // In-flight expiry = positive TTL: resolution calls settle in seconds,
      // so a pending entry can never realistically outlive its window.
      const entry = { promise: null, expiresAt: now() + positiveTtlMs };
      entry.promise = Promise.resolve().then(fn);
      entries.set(key, entry);

      entry.promise.then(
        () => { entry.expiresAt = now() + positiveTtlMs; },
        () => { entry.expiresAt = now() + negativeTtlMs; } // also marks the rejection handled
      );

      return entry.promise;
    },
    size() { sweep(); return entries.size; },
    clear() { entries.clear(); },
  };
}
