// client/src/pages/co-pilot/MapPage.tsx
// Wrapper page for the Map tab showing venues and events on a map
// Includes: strategy blocks, bar markers (green=open, red=closing soon), and events
// Events are filtered to "active only" (currently happening) via useActiveEventsQuery
//
// 2026-01-10: D-025 - FIXED duplicate bars fetch
// Now uses shared barsData from CoPilotContext via useBarsQuery cache
// Removed separate useQuery that violated NO FALLBACKS rule (city: 'Unknown')

import React from 'react';
import { MapPin } from 'lucide-react';
import MapTab from '@/components/MapTab';
import { useCoPilot } from '@/contexts/co-pilot-context';
import { useActiveEventsQuery } from '@/hooks/useBriefingQueries';
import type { Venue } from '@/hooks/useBarsQuery';

// Event type for MapTab
// 2026-01-10: Use symmetric field names (event_start_date, event_start_time)
interface MapEvent {
  title: string;
  venue?: string;
  address?: string;
  event_start_date?: string;
  event_end_date?: string;  // For multi-day events (e.g., Dec 1 - Jan 4)
  event_start_time?: string;
  event_end_time?: string;
  latitude?: number;
  longitude?: number;
  impact?: 'high' | 'medium' | 'low';
  subtype?: string;
}

// Briefing event type (from API)
// 2026-01-10: Use symmetric field names (event_start_date, event_start_time)
interface BriefingEvent {
  event_start_date?: string;
  event_type?: string;
  subtype?: string;
  title?: string;
  venue?: string;
  location?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  impact?: 'high' | 'medium' | 'low';
  event_start_time?: string;
  event_end_time?: string;
  [key: string]: unknown;
}

// Bar type for map markers (MapTab expects snake_case)
// 2026-01-10: D-025 - Data comes from useBarsQuery (camelCase) and is mapped here
interface MapBar {
  name: string;
  type: string;
  address: string;
  expense_level: string;
  expense_rank: number;
  is_open: boolean;
  closing_soon: boolean;
  minutes_until_close: number | null;
  lat: number;
  lng: number;
  place_id?: string;
  rating?: number | null;
}

export default function MapPage() {
  // 2026-01-10: D-025 - Get barsData from shared cache (not duplicate useQuery)
  // This eliminates the city: 'Unknown' NO FALLBACKS violation
  const { coords, lastSnapshotId, blocks, isBlocksLoading, barsData } = useCoPilot();

  // Fetch only currently active events (happening now) for the map
  // This uses the ?filter=active endpoint which returns events during their duration
  const { data: activeEventsData } = useActiveEventsQuery(lastSnapshotId);

  // 2026-01-10: D-025 - Filter bars using shared barsData from useBarsQuery
  // Map camelCase (from useBarsQuery) to snake_case (for MapTab)
  const filteredBars = React.useMemo(() => {
    // barsData is from useBarsQuery which returns camelCase Venue[]
    const allBars: Venue[] = [...(barsData?.venues || []), ...(barsData?.lastCallVenues || [])];

    // Remove duplicates by placeId or name+lat+lng
    const seen = new Set<string>();
    const uniqueBars = allBars.filter(bar => {
      const key = bar.placeId || `${bar.name}-${bar.lat}-${bar.lng}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Filter: $$ and above (expenseRank >= 2) AND open only (no closed bars)
    const openPremiumBars = uniqueBars.filter(bar => bar.expenseRank >= 2 && bar.isOpen === true);

    // Map camelCase → snake_case for MapTab compatibility
    const mappedBars: MapBar[] = openPremiumBars.map(bar => ({
      name: bar.name,
      type: bar.type,
      address: bar.address,
      expense_level: bar.expenseLevel,
      expense_rank: bar.expenseRank,
      is_open: bar.isOpen === true,
      closing_soon: bar.closingSoon,
      minutes_until_close: bar.minutesUntilClose,
      lat: bar.lat,
      lng: bar.lng,
      place_id: bar.placeId,
      rating: bar.rating,
    }));

    const openCount = mappedBars.filter(b => !b.closing_soon).length;
    const closingSoonCount = mappedBars.filter(b => b.closing_soon).length;
    console.log(`[MapPage] Bars: ${mappedBars.length} open $$+ bars (${openCount} open, ${closingSoonCount} closing soon)`);
    return mappedBars;
  }, [barsData]);

  // Show placeholder if no location or snapshot
  if (!coords || !lastSnapshotId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <MapPin className="w-12 h-12 text-gray-400 mb-4" />
        <h3 className="text-lg font-semibold text-gray-700">Map & Venues</h3>
        <p className="text-gray-500 mt-2">Generate recommendations to view them on the map</p>
      </div>
    );
  }

  // Transform blocks to map venues format
  // 2026-01-09: Use camelCase property names to match SmartBlock type
  // 2026-01-10: D-026 - Use fallback chain for earnings (types have both fields)
  const venues = blocks.map((block, idx) => ({
    id: `${idx}`,
    name: block.name,
    lat: block.coordinates.lat,
    lng: block.coordinates.lng,
    distance_miles: block.estimatedDistanceMiles,
    drive_time_min: block.driveTimeMinutes || block.estimatedWaitTime,
    est_earnings_per_ride: block.estimatedEarningsPerRide ?? block.estimatedEarnings ?? null,
    rank: idx + 1,
    value_grade: block.valueGrade,
  }));

  // Transform ACTIVE events to map format (only events happening NOW)
  // Uses useActiveEventsQuery which fetches ?filter=active from the API
  // This ensures the map shows real-time events, not all upcoming events
  // 2026-01-10: Use symmetric field names (event_start_date, event_start_time)
  const mapEvents: MapEvent[] = (activeEventsData?.events || []).map((e: BriefingEvent): MapEvent => ({
    title: e.title as string,
    venue: e.venue as string | undefined,
    address: e.address as string | undefined,
    event_start_date: e.event_start_date as string | undefined,
    event_end_date: (e as BriefingEvent & { event_end_date?: string }).event_end_date,
    event_start_time: e.event_start_time as string | undefined,
    event_end_time: e.event_end_time as string | undefined,
    latitude: e.latitude as number | undefined,
    longitude: e.longitude as number | undefined,
    impact: e.impact as 'high' | 'medium' | 'low' | undefined,
    subtype: e.subtype as string | undefined,
  }));

  return (
    <div className="max-w-7xl mx-auto px-4 pt-6 pb-6 mb-24" data-testid="map-page">
      <MapTab
        driverLat={coords.latitude}
        driverLng={coords.longitude}
        venues={venues}
        bars={filteredBars}
        events={mapEvents}
        snapshotId={lastSnapshotId}
        isLoading={isBlocksLoading}
      />
    </div>
  );
}
