// 2026-04-26 PHASE F: TomTom traffic-incident selector for the Strategy map.
// 2026-04-29 PLAN G: refactored to fetch from /api/traffic/incidents (the
// discovered_traffic cache table) as the canonical source. The Phase F path
// (briefingData.traffic.incidents) remains as a graceful-fallback if the API
// call fails or returns empty for the current snapshot — gives us defense in
// depth while the cache table populates.
//
// Architecture:
//   tomtom.js → briefing-service.js → discovered_traffic table  (write side)
//                                  ↘ briefings.traffic.incidents (Phase F path)
//
//   Client → /api/traffic/incidents?snapshot_id=X (canonical)
//          ↘ briefingData.traffic.incidents (fallback)
//          → StrategyMap renders triangle markers
//
// The new path is a circuit breaker: a briefing-layer regression that strips
// coords cannot silently disable the map, because the API reads directly from
// discovered_traffic where lat/lng NOT NULL is enforced at the schema level.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCoPilot } from '@/contexts/co-pilot-context';
import { STORAGE_KEYS } from '@/constants/storageKeys';

export type TrafficIncidentSeverity = 'high' | 'medium' | 'low';

export interface TrafficIncident {
  description: string;
  severity: TrafficIncidentSeverity;
  category: string;            // 'Accident' | 'Jam' | 'Road Closed' | 'Lane Closed' | 'Road Works' | 'Flooding' | etc.
  road: string;
  location: string;
  isHighway: boolean;
  priority: number;            // 0-100; sorted desc by tomtom.js
  delayMinutes: number;
  lengthMiles: number | null;
  distanceFromDriver: number | null;
  incidentLat: number | null;  // present from PHASE F onward
  incidentLon: number | null;
}

export interface PlottableTrafficIncident extends TrafficIncident {
  incidentLat: number;
  incidentLon: number;
}

function hasCoords(inc: TrafficIncident): inc is PlottableTrafficIncident {
  return inc.incidentLat != null && inc.incidentLon != null;
}

interface TrafficIncidentsApiResponse {
  success: boolean;
  incidents?: TrafficIncident[];
  count?: number;
  error?: string;
}

async function fetchTrafficIncidents(snapshotId: string): Promise<PlottableTrafficIncident[]> {
  const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
  const res = await fetch(`/api/traffic/incidents?snapshot_id=${encodeURIComponent(snapshotId)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error(`traffic incidents API ${res.status}`);
  }
  const json: TrafficIncidentsApiResponse = await res.json();
  if (!json.success || !Array.isArray(json.incidents)) {
    throw new Error(json.error || 'API returned no incidents array');
  }
  return json.incidents.filter(hasCoords);
}

export function useTrafficIncidents(): PlottableTrafficIncident[] {
  const { briefingData, lastSnapshotId } = useCoPilot();

  // Canonical source: the discovered_traffic cache via /api/traffic/incidents.
  // Refetched whenever snapshot rotates. 60s stale time keeps reasonable freshness
  // while avoiding storm-of-fetches if components re-render.
  const { data: apiIncidents } = useQuery({
    queryKey: ['traffic-incidents', lastSnapshotId],
    queryFn: () => fetchTrafficIncidents(lastSnapshotId!),
    enabled: !!lastSnapshotId,
    staleTime: 60_000,
    retry: 1,
  });

  // Fallback: briefingData.traffic.incidents (Phase F path). Used only when the
  // API returns nothing (cache hasn't been written for this snapshot yet, or the
  // request failed). Keeping this fallback gives defense in depth — a briefing
  // regression won't silently disable the map, AND a discovered_traffic-write
  // regression won't either, as long as either path is healthy.
  const trafficObj = briefingData?.traffic as { incidents?: TrafficIncident[] } | null | undefined;
  const fallbackIncidents = useMemo(() => {
    return (trafficObj?.incidents ?? []).filter(hasCoords);
  }, [trafficObj?.incidents]);

  return useMemo(() => {
    if (apiIncidents !== undefined) return apiIncidents;
    return fallbackIncidents;
  }, [apiIncidents, fallbackIncidents]);
}
