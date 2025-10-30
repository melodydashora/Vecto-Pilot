/**
 * RUNTIME-FRESH PLANNER PROMPT
 * 
 * Verbatim from spec - enforces coordinate-first, catalog-as-backup normalization
 */

export const RUNTIME_FRESH_PLANNER_PROMPT = `You generate a driver strategy that must be fresh, deterministic, and valid for no more than 60 minutes.

Rules:
- Use snapshot {active_snapshot_id} only.
- Anchor all decisions to the precise user location (lat, lng, street-level address) provided in input.
- Output JSON only, conforming exactly to the Strategy output schema.
- Do not reference prior runs, histories, or narratives.
- Select zones/targets from runtime signals. If a catalog match exists, attach catalog_id, display_name, and business_hours with sources; otherwise provide zone-only guidance with uncataloged_zone=true. Never invent names.
- If an events payload is provided, include only events within proximity and overlapping the strategy window, and adjust actions accordingly. If not provided, set events_resolution="none".

Requirements:
- Set strategy_timestamp=now; valid_window.start=now; valid_window.end ≤ now+60min.
- Include zones with runtime-resolved venues; add catalog normalization when available.
- Include actions with clear bailout_after_minutes and accept_rules.
- Set flags: freshness=true, uses_current_context=true, no_historical_bleed=true, catalog_resolution=none|partial|full.
- Include audit.user="undefined", audit.request_id, and audit.active_snapshot_id.

Reject generation if input lacks lat/lng/address or the resolved address is older than 2 minutes.`;

/**
 * Build planner context with runtime-fresh constraints
 */
export function buildRuntimeFreshContext({
  snapshot,
  strategy,
  requestId,
  activeSnapshotId
}) {
  const now = new Date();
  const windowStart = now.toISOString();
  const windowEnd = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

  return {
    request_id: requestId,
    request_time: now.toISOString(),
    context: {
      user: "undefined", // Global, user-agnostic
      user_location: {
        lat: snapshot.lat,
        lng: snapshot.lng,
        address: snapshot.formatted_address || `${snapshot.city}, ${snapshot.state}`
      },
      day_of_week: getDayOfWeek(snapshot.dow),
      time_band: getTimeBand(snapshot.hour),
      density_class: getDensityClass(snapshot),
      driver_posture: "idle" // Default, can be enhanced with telemetry
    },
    telemetry: {
      idle_minutes: 0,
      surge_hint: false,
      event_flags: []
    },
    snapshot: {
      active_snapshot_id: activeSnapshotId
    },
    valid_window: {
      start: windowStart,
      end: windowEnd
    },
    anchor: {
      lat: snapshot.lat,
      lng: snapshot.lng,
      address: snapshot.formatted_address || `${snapshot.city}, ${snapshot.state}`
    }
  };
}

/**
 * Get day of week name
 */
function getDayOfWeek(dow) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[dow] || 'unknown';
}

/**
 * Get time band (simplified - can be enhanced)
 */
function getTimeBand(hour) {
  if (hour === null || hour === undefined) return '00:00-23:59';
  const nextHour = (hour + 1) % 24;
  return `${hour.toString().padStart(2, '0')}:00-${nextHour.toString().padStart(2, '0')}:00`;
}

/**
 * Infer density class from snapshot context
 */
function getDensityClass(snapshot) {
  // This is a simplified heuristic - enhance with actual polygon/census data
  const address = (snapshot.formatted_address || '').toLowerCase();
  
  if (address.includes('downtown') || address.includes('center city')) {
    return 'downtown';
  }
  
  if (address.includes('commercial') || address.includes('business district')) {
    return 'commercial';
  }
  
  if (address.includes('plaza') || address.includes('shopping') || address.includes('mall')) {
    return 'mixed_use';
  }
  
  return 'residential'; // Default
}
