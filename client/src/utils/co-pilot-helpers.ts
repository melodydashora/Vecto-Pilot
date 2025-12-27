// client/src/utils/co-pilot-helpers.ts
// Utility functions for Co-Pilot page

/**
 * Get auth headers with JWT token from localStorage
 */
export function getAuthHeader(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('vecto_auth_token') : null;
  if (!token) {
    console.warn('[co-pilot] No auth token found in localStorage');
  }
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

/**
 * Log user action to backend with idempotency key
 */
export async function logAction(
  rankingId: string | undefined,
  action: string,
  blockId?: string,
  dwellMs?: number,
  fromRank?: number
): Promise<void> {
  try {
    const ranking_id = rankingId || 'unknown';
    const timestamp = new Date().toISOString();
    const idempotencyKey = `${ranking_id}:${action}:${blockId || 'na'}:${timestamp}`;

    await fetch('/api/actions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        ranking_id: ranking_id !== 'unknown' ? ranking_id : null,
        action,
        block_id: blockId || null,
        dwell_ms: dwellMs || null,
        from_rank: fromRank || null,
        user_id: localStorage.getItem('vecto_user_id') || 'default',
      }),
    });
  } catch (err) {
    console.warn('[Co-Pilot] Failed to log action:', err);
  }
}

/**
 * Subscribe to SSE strategy_ready events
 * Uses Postgres LISTEN/NOTIFY via /events/strategy endpoint
 */
export function subscribeStrategyReady(callback: (snapshotId: string) => void): () => void {
  const eventSource = new EventSource('/events/strategy');

  eventSource.addEventListener('strategy_ready', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.snapshot_id) {
        console.log('[SSE] Received strategy_ready for:', data.snapshot_id);
        callback(data.snapshot_id);
      }
    } catch (e) {
      console.warn('[SSE] Failed to parse strategy_ready event:', e);
    }
  });

  eventSource.onerror = () => {
    console.warn('[SSE] Strategy connection error, will reconnect automatically');
  };

  return () => eventSource.close();
}

/**
 * Subscribe to SSE blocks_ready events
 * Uses Postgres LISTEN/NOTIFY via /events/blocks endpoint
 */
export function subscribeBlocksReady(callback: (data: { snapshot_id: string; ranking_id?: string }) => void): () => void {
  const eventSource = new EventSource('/events/blocks');

  eventSource.addEventListener('blocks_ready', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.snapshot_id) {
        console.log('[SSE] Received blocks_ready for:', data.snapshot_id);
        callback(data);
      }
    } catch (e) {
      console.warn('[SSE] Failed to parse blocks_ready event:', e);
    }
  });

  eventSource.onerror = () => {
    console.warn('[SSE] Blocks connection error, will reconnect automatically');
  };

  return () => eventSource.close();
}

/**
 * Open Google Maps navigation with smart destination resolution
 * Prefers placeId for accuracy, falls back to coordinates, then address
 */
export function openGoogleMaps(options: {
  lat?: number;
  lng?: number;
  placeId?: string;
  name?: string;
  address?: string;
}): void {
  const { lat, lng, placeId, name, address } = options;

  // Best: Use place_id for most accurate navigation
  if (placeId && name) {
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${placeId}`, '_blank');
    return;
  }

  // Good: Use coordinates for directions
  if (lat && lng) {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
    return;
  }

  // Fallback: Search by address or name
  const searchQuery = address || name;
  if (searchQuery) {
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery)}`, '_blank');
  }
}

/**
 * Open Apple Maps navigation with smart destination resolution
 */
export function openAppleMaps(options: {
  lat?: number;
  lng?: number;
  name?: string;
  address?: string;
}): void {
  const { lat, lng, name, address } = options;

  // Best: Use coordinates
  if (lat && lng) {
    const query = name ? `&q=${encodeURIComponent(name)}` : '';
    window.open(`https://maps.apple.com/?daddr=${lat},${lng}${query}`, '_blank');
    return;
  }

  // Fallback: Search by address or name
  const searchQuery = address || name;
  if (searchQuery) {
    window.open(`https://maps.apple.com/?q=${encodeURIComponent(searchQuery)}`, '_blank');
  }
}

/**
 * Detect if user is on iOS/macOS for Apple Maps preference
 */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod|Mac/.test(navigator.userAgent);
}

/**
 * Open navigation using the best available map app
 * Uses Apple Maps on iOS/macOS, Google Maps elsewhere
 */
export function openNavigation(options: {
  lat?: number;
  lng?: number;
  placeId?: string;
  name?: string;
  address?: string;
}): void {
  if (isApplePlatform()) {
    openAppleMaps(options);
  } else {
    openGoogleMaps(options);
  }
}

/**
 * Get time-based greeting message
 */
export function getGreeting(): { text: string; icon: string; period: 'morning' | 'afternoon' | 'evening' } {
  const hour = new Date().getHours();
  if (hour < 12) {
    return { text: 'Good morning', icon: '☀️', period: 'morning' };
  } else if (hour < 18) {
    return { text: 'Good afternoon', icon: '🌅', period: 'afternoon' };
  } else {
    return { text: 'Good evening', icon: '🌙', period: 'evening' };
  }
}

