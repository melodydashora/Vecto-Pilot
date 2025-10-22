// server/lib/cache-routes.js
// Minimal in-memory cache for Google Routes calls
// Key: `${origin_h3}|${dest_h3}|${minute_bucket}`
// TTL: default 300s (5 minutes)
const store = new Map();

export function put(key, value, ttlMs = 300_000) {
  const exp = Date.now() + ttlMs;
  store.set(key, { value, exp });
}
export function get(key) {
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.exp < Date.now()) { store.delete(key); return null; }
  return hit.value;
}
export function keyFor(originH3, destH3, minuteBucket) {
  return `${originH3}|${destH3}|${minuteBucket}`;
}
export function minuteBucket(d = new Date()) {
  return Math.floor(d.getTime() / 60000);
}
export function size(){ return store.size; }
