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

// ============================================================================
// Event Filtering Utilities
// ============================================================================

export interface FilterableEvent {
  title?: string;
  event_date?: string;
  event_end_date?: string;  // For multi-day events (e.g., Dec 1 - Jan 4)
  event_time?: string;
  event_end_time?: string;
  [key: string]: unknown;
}

/**
 * Check if an event is happening today
 * For single-day events: checks event_date === today
 * For multi-day events: checks if today falls within event_date to event_end_date range
 */
export function isEventToday(event: FilterableEvent): boolean {
  if (!event.event_date) return false;

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // Multi-day event: check if today falls within the date range
  if (event.event_end_date) {
    const inRange = event.event_date <= today && today <= event.event_end_date;
    if (inRange) {
      console.log(`[EventFilter] ✅ Multi-day event "${event.title}" - today ${today} is within range ${event.event_date} to ${event.event_end_date}`);
    }
    return inRange;
  }

  // Single-day event: exact date match
  return event.event_date === today;
}

/**
 * Check if an event has valid timing information
 * Events MUST have at least a start time to be considered valid
 */
export function hasValidEventTime(event: FilterableEvent): boolean {
  // Must have event_time (start time) - reject if missing
  if (!event.event_time) return false;

  // Reject TBD or placeholder times
  const time = event.event_time.toLowerCase();
  if (time.includes('tbd') || time.includes('unknown') || time === '') return false;

  return true;
}

/**
 * Filter events to only show today's events with valid times
 * Use this for map display where we only want actionable events
 */
export function filterTodayEvents<T extends FilterableEvent>(events: T[]): T[] {
  return events.filter(event => {
    const isToday = isEventToday(event);
    const hasTime = hasValidEventTime(event);

    if (!isToday) {
      console.log(`[EventFilter] Rejected "${event.title}" - not today (date: ${event.event_date})`);
    } else if (!hasTime) {
      console.log(`[EventFilter] Rejected "${event.title}" - no valid time (time: ${event.event_time})`);
    }

    return isToday && hasTime;
  });
}

/**
 * Filter events for briefing display
 * Shows all upcoming events but still requires valid times
 * Returns events grouped by: today (active now), today (upcoming), future
 * Handles multi-day events by checking if today falls within event_date to event_end_date range
 */
export function filterValidEvents<T extends FilterableEvent>(events: T[]): {
  todayEvents: T[];
  upcomingEvents: T[];
  invalidEvents: T[];
} {
  const today = new Date().toISOString().split('T')[0];
  const todayEvents: T[] = [];
  const upcomingEvents: T[] = [];
  const invalidEvents: T[] = [];

  for (const event of events) {
    if (!hasValidEventTime(event)) {
      invalidEvents.push(event);
      console.log(`[EventFilter] Invalid event "${event.title}" - no time (${event.event_time})`);
      continue;
    }

    // Determine the effective end date (use event_end_date for multi-day, event_date for single-day)
    const effectiveEndDate = event.event_end_date || event.event_date;

    // Check if it's a today event (multi-day: today within range, single-day: exact match)
    const isTodayEvent = event.event_end_date
      ? (event.event_date && event.event_date <= today && today <= event.event_end_date)
      : (event.event_date === today);

    if (isTodayEvent) {
      todayEvents.push(event);
    } else if (event.event_date && event.event_date > today) {
      // Event starts in the future
      upcomingEvents.push(event);
    } else if (effectiveEndDate && effectiveEndDate < today) {
      // Event has ended (past)
      invalidEvents.push(event);
    } else {
      // Fallback - shouldn't happen but handle gracefully
      invalidEvents.push(event);
    }
  }

  return { todayEvents, upcomingEvents, invalidEvents };
}

/**
 * Format event date for display
 * Returns "Today", "Tomorrow", day name for this week, or formatted date
 */
export function formatEventDate(eventDate: string | undefined): string {
  if (!eventDate) return '';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const eventDay = new Date(eventDate + 'T00:00:00');
  const diffDays = Math.floor((eventDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays < 7 && diffDays > 0) {
    return eventDay.toLocaleDateString('en-US', { weekday: 'long' });
  }

  return eventDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Format event time range for display
 * Combines start and end time into a readable format
 */
export function formatEventTimeRange(startTime?: string, endTime?: string): string {
  if (!startTime) return '';
  if (!endTime) return startTime;
  return `${startTime} - ${endTime}`;
}

// ============================================================================
// SmartBlock Filtering Utilities
// ============================================================================

export interface FilterableBlock {
  name: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  value_grade?: string;
  not_worth?: boolean;
  [key: string]: unknown;
}

/**
 * Calculate the Haversine distance between two coordinates in miles
 * Uses the great-circle distance formula for accurate Earth surface distance
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3958.8; // Earth's radius in miles
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Check if a SmartBlock is Grade A value (top tier, not flagged as not_worth)
 */
export function isGradeABlock(block: FilterableBlock): boolean {
  // Reject blocks flagged as not worth it
  if (block.not_worth === true) {
    return false;
  }

  // Only accept Grade A (highest value)
  const grade = block.value_grade?.toUpperCase();
  return grade === 'A';
}

/**
 * Check if a SmartBlock is high-value (Grade A or B, not flagged as not_worth)
 */
export function isHighValueBlock(block: FilterableBlock): boolean {
  // Reject blocks flagged as not worth it
  if (block.not_worth === true) {
    return false;
  }

  // Accept Grade A and B (reject Grade C and undefined)
  const grade = block.value_grade?.toUpperCase();
  return grade === 'A' || grade === 'B';
}

/**
 * Filter SmartBlocks to show high-value venues
 * Optimized for "NOW strategy" - shows up to 3 highest-value venues
 *
 * Algorithm:
 * 1. Combine Grade A and Grade B blocks (A first, then B)
 * 2. First pass: add venues that are well-spaced (>= minDistanceMiles apart)
 * 3. Second pass: if not enough, fill with remaining high-value venues (ignore spacing)
 * 4. Always show at least 1 high-value venue if available
 *
 * @param blocks - Array of SmartBlocks to filter
 * @param minDistanceMiles - Preferred distance between venues (default: 1 mile)
 * @param maxVenues - Maximum venues to return (default: 3)
 * @returns Filtered array of high-value blocks (spacing preferred but not required)
 */
export function filterHighValueSpacedBlocks<T extends FilterableBlock>(
  blocks: T[],
  minDistanceMiles: number = 1.0,
  maxVenues: number = 3
): T[] {
  // Helper: Check if block has valid coordinates
  const hasValidCoords = (block: T): boolean => {
    const coords = block.coordinates;
    return coords && typeof coords.lat === 'number' && typeof coords.lng === 'number';
  };

  // Helper: Check if block is well-spaced from kept blocks
  const isWellSpaced = (block: T, keptBlocks: T[]): boolean => {
    if (keptBlocks.length === 0) return true; // First block always passes

    const coords = block.coordinates;
    for (const keptBlock of keptBlocks) {
      const distance = haversineDistance(
        coords.lat,
        coords.lng,
        keptBlock.coordinates.lat,
        keptBlock.coordinates.lng
      );
      if (distance < minDistanceMiles) {
        return false;
      }
    }
    return true;
  };

  // Step 1: Get all high-value blocks (Grade A first, then Grade B)
  const gradeABlocks = blocks.filter(b => isGradeABlock(b) && hasValidCoords(b));
  const gradeBBlocks = blocks.filter(b => {
    if (b.not_worth === true) return false;
    const grade = b.value_grade?.toUpperCase();
    return grade === 'B' && hasValidCoords(b);
  });

  const allHighValue = [...gradeABlocks, ...gradeBBlocks];
  console.log(`[BlockFilter] Available: ${gradeABlocks.length} Grade A, ${gradeBBlocks.length} Grade B (of ${blocks.length} total)`);

  if (allHighValue.length === 0) {
    console.log(`[BlockFilter] No high-value venues found`);
    return [];
  }

  // Step 2: First pass - add well-spaced venues (prefer spacing)
  const result: T[] = [];
  const used = new Set<string>();

  for (const block of allHighValue) {
    if (result.length >= maxVenues) break;

    const key = `${block.name}-${block.coordinates.lat}-${block.coordinates.lng}`;
    if (used.has(key)) continue;

    if (isWellSpaced(block, result)) {
      result.push(block);
      used.add(key);
      const grade = block.value_grade?.toUpperCase();
      console.log(`[BlockFilter] ✅ Kept "${block.name}" (Grade ${grade}, spaced, ${result.length}/${maxVenues})`);
    }
  }

  // Step 3: Second pass - fill remaining slots with any high-value venues (ignore spacing)
  if (result.length < maxVenues) {
    console.log(`[BlockFilter] Only ${result.length} spaced venues, filling with remaining high-value...`);

    for (const block of allHighValue) {
      if (result.length >= maxVenues) break;

      const key = `${block.name}-${block.coordinates.lat}-${block.coordinates.lng}`;
      if (used.has(key)) continue;

      result.push(block);
      used.add(key);
      const grade = block.value_grade?.toUpperCase();
      console.log(`[BlockFilter] ✅ Kept "${block.name}" (Grade ${grade}, close but high-value, ${result.length}/${maxVenues})`);
    }
  }

  const gradeACnt = result.filter(b => b.value_grade?.toUpperCase() === 'A').length;
  const gradeBCnt = result.filter(b => b.value_grade?.toUpperCase() === 'B').length;
  console.log(`[BlockFilter] Final: ${result.length} venues (${gradeACnt} Grade A, ${gradeBCnt} Grade B)`);

  return result;
}

