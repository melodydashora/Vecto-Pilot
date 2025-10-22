// client/src/lib/once.ts
// Prevents duplicate in-flight requests for the same key

const inFlight = new Map<string, Promise<any>>();

export function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = inFlight.get(key);
  if (hit) return hit as Promise<T>;
  
  const p = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}
