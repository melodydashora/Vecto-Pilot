import { validateGpsFix } from '@shared/coordinates.js';

type Fix = { lat: number; lng: number; accuracy: number; timestamp: number };
export function freshPosition(signal: AbortSignal): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('This browser does not support precise location.')); return; }
    let settled = false;
    const finish = (error?: Error, fix?: Fix) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve(fix!);
    };
    const aborted = () => finish(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Precise location timed out. Retry when safely parked.')), 17000);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    navigator.geolocation.getCurrentPosition(position => {
      const fix = validateGpsFix({ latitude: position.coords.latitude, longitude: position.coords.longitude,
        accuracy: position.coords.accuracy, timestamp: position.timestamp });
      if (fix.ok === false) { finish(new Error(fix.error)); return; }
      finish(undefined, { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, timestamp: position.timestamp });
    }, error => finish(new Error(error.code === 1 ? 'Location permission was denied. Enable precise location, then continue again.'
      : error.code === 3 ? 'Precise location timed out. Retry when safely parked.' : 'A fresh precise location is unavailable. Retry when safely parked.')),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}
// Bound snapshot transport separately from the longer progressive Briefing.
// Include the response body, and settle even if a transport ignores cancellation.
export async function withSnapshotDeadline<T>(signal: AbortSignal, request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let rejectPending!: (reason: Error) => void;
  const pending = new Promise<never>((_resolve, reject) => { rejectPending = reject; });
  const stop = (error: Error) => { rejectPending(error); controller.abort(); };
  const aborted = () => stop(new DOMException('Aborted', 'AbortError'));
  const timer = setTimeout(() => stop(new Error('Saving your location timed out. Use Refresh when you’re ready to try again.')), 30_000);
  signal.addEventListener('abort', aborted, { once: true });
  try {
    if (signal.aborted) { aborted(); return await pending; }
    return await Promise.race([request(controller.signal), pending]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', aborted);
  }
}
