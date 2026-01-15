// client/src/utils/co-pilot-helpers.ts
// Utility functions for Co-Pilot page
// 2026-01-09: P1-6 FIX - Using centralized constants

import { STORAGE_KEYS } from '@/constants/storageKeys';
import { API_ROUTES } from '@/constants/apiRoutes';

// ============================================================================
// Singleton SSE Connection Manager
// ============================================================================
// LESSON LEARNED: Each EventSource connection creates a separate subscription
// to PostgreSQL NOTIFY. Multiple components mounting/unmounting created many
// connections (18 observed in prod!), causing duplicate event broadcasts.
//
// This singleton ensures ONE connection per endpoint, shared across all
// React components. Multiple subscribers share the same connection.
// ============================================================================

interface SSESubscription {
  eventSource: EventSource;
  subscribers: Set<(data: any) => void>;
  isConnected: boolean;
}

// Global singleton - persists across React renders
const sseConnections: Map<string, SSESubscription> = new Map();

/**
 * Subscribe to an SSE endpoint with singleton connection management.
 * Multiple calls to the same endpoint share one EventSource connection.
 *
 * @param endpoint - The SSE endpoint path (e.g., '/events/briefing')
 * @param eventName - The event type to listen for (e.g., 'briefing_ready')
 * @param callback - Function called when event is received
 * @returns Unsubscribe function that cleans up when last subscriber leaves
 */
function subscribeSSE(
  endpoint: string,
  eventName: string,
  callback: (data: any) => void
): () => void {
  const key = `${endpoint}:${eventName}`;

  let subscription = sseConnections.get(key);

  if (!subscription) {
    // Create new connection - first subscriber for this endpoint
    console.log(`[SSE Manager] 🔌 Creating singleton connection: ${endpoint} (${eventName})`);

    const eventSource = new EventSource(endpoint);
    subscription = {
      eventSource,
      subscribers: new Set(),
      isConnected: false,
    };

    eventSource.onopen = () => {
      console.log(`[SSE Manager] ✅ Connected: ${endpoint}`);
      subscription!.isConnected = true;
    };

    eventSource.addEventListener(eventName, (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log(`[SSE Manager] 📢 Event received: ${eventName}`, data.snapshot_id?.slice(0, 8) || 'no-id');
        // Broadcast to all subscribers
        subscription!.subscribers.forEach(sub => sub(data));
      } catch (e) {
        console.warn(`[SSE Manager] Failed to parse ${eventName} event:`, e);
      }
    });

    eventSource.onerror = (e) => {
      console.warn(`[SSE Manager] ⚠️ Connection error: ${endpoint}`, e);
      subscription!.isConnected = false;
    };

    sseConnections.set(key, subscription);
  } else {
    console.log(`[SSE Manager] ♻️ Reusing existing connection: ${endpoint} (${subscription.subscribers.size} existing subscribers)`);
  }

  // Add this callback to subscribers
  subscription.subscribers.add(callback);
  console.log(`[SSE Manager] 👥 Subscribers for ${key}: ${subscription.subscribers.size}`);

  // Return unsubscribe function
  return () => {
    const sub = sseConnections.get(key);
    if (sub) {
      sub.subscribers.delete(callback);
      console.log(`[SSE Manager] 👤 Unsubscribed from ${key}, ${sub.subscribers.size} remaining`);

      // Close connection when last subscriber leaves
      if (sub.subscribers.size === 0) {
        console.log(`[SSE Manager] 🔌 Closing connection: ${endpoint} (no subscribers left)`);
        sub.eventSource.close();
        sseConnections.delete(key);
      }
    }
  };
}

/**
 * Get auth headers with JWT token from localStorage
 */
export function getAuthHeader(): Record<string, string> {
  // 2026-01-09: P1-6 FIX - Using STORAGE_KEYS constant instead of hardcoded string
  const token = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) : null;
  if (!token) {
    console.warn('[co-pilot] No auth token found in localStorage');
  }
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

/**
 * Log user action to backend with idempotency key
 * 2026-01-09: Updated to use Authorization header for proper user attribution
 * User_id is now derived from JWT on the server (security fix)
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

    // 2026-01-09: SECURITY FIX - Use Authorization header for user attribution
    // Server now derives user_id from JWT (not request body) to prevent spoofing
    await fetch(API_ROUTES.ACTIONS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey,
        ...getAuthHeader(), // Include Authorization: Bearer token
      },
      body: JSON.stringify({
        ranking_id: ranking_id !== 'unknown' ? ranking_id : null,
        action,
        block_id: blockId || null,
        dwell_ms: dwellMs || null,
        from_rank: fromRank || null,
        // 2026-01-09: user_id removed - server derives from JWT for security
      }),
    });
  } catch (err) {
    console.warn('[Co-Pilot] Failed to log action:', err);
  }
}

/**
 * Subscribe to SSE strategy_ready events
 * Uses Postgres LISTEN/NOTIFY via /events/strategy endpoint
 *
 * Uses singleton connection manager - multiple components share one connection
 */
export function subscribeStrategyReady(callback: (snapshotId: string) => void): () => void {
  return subscribeSSE('/events/strategy', 'strategy_ready', (data) => {
    if (data.snapshot_id) {
      callback(data.snapshot_id);
    }
  });
}

/**
 * Subscribe to SSE blocks_ready events
 * Uses Postgres LISTEN/NOTIFY via /events/blocks endpoint
 *
 * Uses singleton connection manager - multiple components share one connection
 */
export function subscribeBlocksReady(callback: (data: { snapshot_id: string; ranking_id?: string }) => void): () => void {
  return subscribeSSE('/events/blocks', 'blocks_ready', (data) => {
    if (data.snapshot_id) {
      callback(data);
    }
  });
}

/**
 * Subscribe to SSE briefing_ready events
 * Uses Postgres LISTEN/NOTIFY via /events/briefing endpoint
 * Fires when briefing data (weather, traffic, events, news) is fully generated
 *
 * Uses singleton connection manager - multiple components share one connection
 */
export function subscribeBriefingReady(callback: (snapshotId: string) => void): () => void {
  return subscribeSSE('/events/briefing', 'briefing_ready', (data) => {
    if (data.snapshot_id) {
      callback(data.snapshot_id);
    }
  });
}

/**
 * Subscribe to SSE phase_change events for real-time progress tracking
 * Uses /events/phase endpoint that emits on every pipeline phase transition
 * Fires with timing metadata for accurate progress bar calculation
 *
 * LESSON LEARNED: Without this, progress bar only updates via 3-second polling,
 * which is too slow to track rapid phase changes (resolving → analyzing → immediate → venues...)
 *
 * Uses singleton connection manager - multiple components share one connection
 */
export function subscribePhaseChange(callback: (data: {
  snapshot_id: string;
  phase: string;
  phase_started_at: string;
  expected_duration_ms: number;
}) => void): () => void {
  // Phase change uses 'message' event type (onmessage), not a named event
  return subscribeSSE('/events/phase', 'message', (data) => {
    if (data.snapshot_id) {
      callback(data);
    }
  });
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

// 2026-01-10: Use symmetric field names (event_start_date, event_start_time)
export interface FilterableEvent {
  title?: string;
  event_start_date?: string;
  event_end_date?: string;  // For multi-day events (e.g., Dec 1 - Jan 4)
  event_start_time?: string;
  event_end_time?: string;
  [key: string]: unknown;
}

/**
 * Check if an event is happening today
 * For single-day events: checks event_start_date === today
 * For multi-day events: checks if today falls within event_start_date to event_end_date range
 */
export function isEventToday(event: FilterableEvent): boolean {
  if (!event.event_start_date) return false;

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // Multi-day event: check if today falls within the date range
  if (event.event_end_date) {
    const inRange = event.event_start_date <= today && today <= event.event_end_date;
    if (inRange) {
      console.log(`[EventFilter] ✅ Multi-day event "${event.title}" - today ${today} is within range ${event.event_start_date} to ${event.event_end_date}`);
    }
    return inRange;
  }

  // Single-day event: exact date match
  return event.event_start_date === today;
}

/**
 * Check if an event has valid timing information
 * Events MUST have at least a start time to be considered valid
 * 2026-01-10: Use event_start_time instead of event_time
 */
export function hasValidEventTime(event: FilterableEvent): boolean {
  // Must have event_start_time (start time) - reject if missing
  if (!event.event_start_time) return false;

  // Reject TBD or placeholder times
  const time = event.event_start_time.toLowerCase();
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
      console.log(`[EventFilter] Rejected "${event.title}" - not today (date: ${event.event_start_date})`);
    } else if (!hasTime) {
      console.log(`[EventFilter] Rejected "${event.title}" - no valid time (time: ${event.event_start_time})`);
    }

    return isToday && hasTime;
  });
}

/**
 * Filter events for briefing display
 * Shows all upcoming events but still requires valid times
 * Returns events grouped by: today (active now), today (upcoming), future
 * Handles multi-day events by checking if today falls within event_start_date to event_end_date range
 * 2026-01-10: Use symmetric field names
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
      console.log(`[EventFilter] Invalid event "${event.title}" - no time (${event.event_start_time})`);
      continue;
    }

    // Determine the effective end date (use event_end_date for multi-day, event_start_date for single-day)
    const effectiveEndDate = event.event_end_date || event.event_start_date;

    // Check if it's a today event (multi-day: today within range, single-day: exact match)
    const isTodayEvent = event.event_end_date
      ? (event.event_start_date && event.event_start_date <= today && today <= event.event_end_date)
      : (event.event_start_date === today);

    if (isTodayEvent) {
      todayEvents.push(event);
    } else if (event.event_start_date && event.event_start_date > today) {
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
 * Convert 24h time string (HH:MM) to 12h AM/PM format
 * Examples: "15:00" → "3:00 PM", "09:30" → "9:30 AM", "00:00" → "12:00 AM"
 * 2026-01-14: FIX - Users expect 12h AM/PM format, not military time
 */
export function formatEventTime(timeStr?: string): string {
  if (!timeStr) return '';

  // Handle already-formatted times (contains AM/PM)
  if (timeStr.toLowerCase().includes('am') || timeStr.toLowerCase().includes('pm')) {
    return timeStr;
  }

  // Parse HH:MM format
  const parts = timeStr.split(':');
  if (parts.length < 2) return timeStr; // Can't parse, return as-is

  const hours = parseInt(parts[0], 10);
  const minutes = parts[1];

  if (isNaN(hours)) return timeStr; // Invalid hour, return as-is

  const suffix = hours >= 12 ? 'PM' : 'AM';
  const standardHour = hours % 12 || 12; // Convert 0 → 12, 13 → 1, etc.

  return `${standardHour}:${minutes} ${suffix}`;
}

/**
 * Format event time range for display
 * Combines start and end time into a readable format
 * 2026-01-14: FIX - Now converts 24h → 12h AM/PM format
 */
export function formatEventTimeRange(startTime?: string, endTime?: string): string {
  if (!startTime) return '';

  const formattedStart = formatEventTime(startTime);
  if (!endTime) return formattedStart;

  const formattedEnd = formatEventTime(endTime);
  return `${formattedStart} - ${formattedEnd}`;
}

// ============================================================================
// SmartBlock Filtering Utilities
// ============================================================================

// 2026-01-09: Updated to camelCase to match SmartBlock type
export interface FilterableBlock {
  name: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  valueGrade?: string;
  notWorth?: boolean;
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
 * Check if a SmartBlock is Grade A value (top tier, not flagged as notWorth)
 */
export function isGradeABlock(block: FilterableBlock): boolean {
  // Reject blocks flagged as not worth it
  if (block.notWorth === true) {
    return false;
  }

  // Only accept Grade A (highest value)
  const grade = block.valueGrade?.toUpperCase();
  return grade === 'A';
}

/**
 * Check if a SmartBlock is high-value (Grade A or B, not flagged as notWorth)
 */
export function isHighValueBlock(block: FilterableBlock): boolean {
  // Reject blocks flagged as not worth it
  if (block.notWorth === true) {
    return false;
  }

  // Accept Grade A and B (reject Grade C and undefined)
  const grade = block.valueGrade?.toUpperCase();
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
    if (b.notWorth === true) return false;
    const grade = b.valueGrade?.toUpperCase();
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
      const grade = block.valueGrade?.toUpperCase();
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
      const grade = block.valueGrade?.toUpperCase();
      console.log(`[BlockFilter] ✅ Kept "${block.name}" (Grade ${grade}, close but high-value, ${result.length}/${maxVenues})`);
    }
  }

  const gradeACnt = result.filter(b => b.valueGrade?.toUpperCase() === 'A').length;
  const gradeBCnt = result.filter(b => b.valueGrade?.toUpperCase() === 'B').length;
  console.log(`[BlockFilter] Final: ${result.length} venues (${gradeACnt} Grade A, ${gradeBCnt} Grade B)`);

  return result;
}

