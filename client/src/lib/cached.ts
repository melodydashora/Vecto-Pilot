// client/src/lib/cached.ts
// Simple client-side cache with TTL

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<any>>();

export async function cached<T>(
  key: string, 
  ttlMs: number, 
  load: () => Promise<T>
): Promise<T> {
  const hit = cache.get(key);
  
  if (hit && (Date.now() - hit.timestamp) < ttlMs) {
    return hit.value as T;
  }
  
  const value = await load();
  cache.set(key, { value, timestamp: Date.now() });
  return value;
}
