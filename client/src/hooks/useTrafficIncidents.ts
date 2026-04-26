// 2026-04-26 PHASE F: TomTom traffic-incident selector for the Strategy map.
//
// Incidents flow: tomtom.js parses TomTom GeoJSON → briefing-service.js builds
// `prioritizedIncidents` (top 10 by impact, with coords as of Phase F) →
// briefing.js returns them in `traffic: briefing.traffic_conditions` on the
// briefing response → useBriefingQueries lifts that into briefingData.traffic
// → useCoPilot exposes briefingData → this hook selects + filters → StrategyMap
// renders.
//
// The hook returns ONLY incidents that have coordinates. Briefings generated
// before Phase F shipped have no coords on their incidents and are silently
// dropped by the filter — the map renders nothing for that layer until a fresh
// briefing fires. That's acceptable; old briefings expire fast.

import { useMemo } from 'react';
import { useCoPilot } from '@/contexts/co-pilot-context';

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

export function useTrafficIncidents(): PlottableTrafficIncident[] {
  const { briefingData } = useCoPilot();
  // PHASE F.1: prefer the wider mapIncidents field (all 10mi + highway 10-25mi).
  // Falls back to the legacy 10mi top-10 `incidents` field for briefings
  // generated before this change shipped.
  const trafficObj = briefingData?.traffic as {
    mapIncidents?: TrafficIncident[];
    incidents?: TrafficIncident[];
  } | null | undefined;
  return useMemo(() => {
    const source = trafficObj?.mapIncidents ?? trafficObj?.incidents ?? [];
    return source.filter(hasCoords);
  }, [trafficObj?.mapIncidents, trafficObj?.incidents]);
}
