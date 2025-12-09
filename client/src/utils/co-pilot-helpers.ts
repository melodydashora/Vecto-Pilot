// client/src/utils/co-pilot-helpers.ts
// Utility functions for Co-Pilot page

import type { SmartBlock } from '@/types/co-pilot';

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
 * Generate a unique block ID from block data
 */
export function getBlockId(block: SmartBlock): string {
  return `${block.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${block.coordinates.lat}_${block.coordinates.lng}`;
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
 */
export function subscribeStrategyReady(callback: (snapshotId: string) => void): () => void {
  const eventSource = new EventSource('/api/events');

  eventSource.addEventListener('strategy_ready', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.snapshot_id) {
        callback(data.snapshot_id);
      }
    } catch (e) {
      console.warn('[SSE] Failed to parse strategy_ready event:', e);
    }
  });

  eventSource.onerror = () => {
    console.warn('[SSE] Connection error, will reconnect automatically');
  };

  return () => eventSource.close();
}

/**
 * Open Google Maps navigation to coordinates
 */
export function openGoogleMaps(lat: number, lng: number): void {
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
}

/**
 * Open Apple Maps navigation to coordinates
 */
export function openAppleMaps(lat: number, lng: number): void {
  window.open(`https://maps.apple.com/?daddr=${lat},${lng}`, '_blank');
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

/**
 * Transform raw API block data to SmartBlock format
 */
export function transformBlockData(v: any): SmartBlock {
  return {
    name: v.name,
    address: v.address,
    category: v.category,
    placeId: v.placeId,
    coordinates: {
      lat: v.coordinates?.lat ?? v.lat,
      lng: v.coordinates?.lng ?? v.lng
    },
    estimated_distance_miles: Number(v.estimated_distance_miles ?? v.distance ?? 0),
    driveTimeMinutes: Number(v.driveTimeMinutes ?? v.drive_time ?? 0),
    distanceSource: v.distanceSource ?? "routes_api",
    estimatedEarningsPerRide: v.estimated_earnings ?? v.estimatedEarningsPerRide ?? null,
    value_per_min: v.value_per_min ?? null,
    value_grade: v.value_grade ?? null,
    not_worth: !!v.not_worth,
    surge: v.surge ?? null,
    estimatedWaitTime: v.estimatedWaitTime,
    demandLevel: v.demandLevel,
    businessHours: v.businessHours,
    isOpen: v.isOpen,
    businessStatus: v.businessStatus,
    closed_venue_reasoning: v.closed_venue_reasoning,
    stagingArea: v.stagingArea,
    proTips: v.proTips || v.pro_tips || []
  };
}
