// client/src/pages/co-pilot/MapPage.tsx
// Wrapper page for the Map tab showing venues and events on a map
// Includes: strategy blocks, bar markers (green=open, red=closing soon), and events
// Events are filtered to "active only" (currently happening) via useActiveEventsQuery

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import MapTab from '@/components/MapTab';
import { useCoPilot } from '@/contexts/co-pilot-context';
import { getAuthHeader } from '@/utils/co-pilot-helpers';
import { useActiveEventsQuery } from '@/hooks/useBriefingQueries';

// Event type for MapTab
interface MapEvent {
  title: string;
  venue?: string;
  address?: string;
  event_date?: string;
  event_end_date?: string;  // For multi-day events (e.g., Dec 1 - Jan 4)
  event_time?: string;
  event_end_time?: string;
  latitude?: number;
  longitude?: number;
  impact?: 'high' | 'medium' | 'low';
  subtype?: string;
}

// Briefing event type (from API)
interface BriefingEvent {
  event_date?: string;
  event_type?: string;
  subtype?: string;
  title?: string;
  venue?: string;
  location?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  impact?: 'high' | 'medium' | 'low';
  event_time?: string;
  event_end_time?: string;
  [key: string]: unknown;
}

// Bar type for map markers (from /api/venues/nearby)
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

// API response for bars
interface BarsApiResponse {
  data: {
    venues: MapBar[];
    last_call_venues: MapBar[];
  };
}

export default function MapPage() {
  const { coords, lastSnapshotId, blocks, isBlocksLoading, timezone } = useCoPilot();

  // Fetch only currently active events (happening now) for the map
  // This uses the ?filter=active endpoint which returns events during their duration
  const { data: activeEventsData } = useActiveEventsQuery(lastSnapshotId);

  // Fetch bars for map markers (separate from strategy blocks)
  // Only shows $$ and above (expense_rank >= 2) with open/closing soon status
  const { data: barsData } = useQuery<BarsApiResponse>({
    queryKey: ['map-bars', coords?.latitude, coords?.longitude, timezone],
    queryFn: async () => {
      if (!coords?.latitude || !coords?.longitude) {
        throw new Error('No coordinates');
      }

      const params = new URLSearchParams({
        lat: coords.latitude.toString(),
        lng: coords.longitude.toString(),
        city: 'Unknown',
        state: '',
        radius: '15',  // 15 mile radius for bar coverage on map
        timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
      });

      const response = await fetch(`/api/venues/nearby?${params}`, {
        headers: getAuthHeader()
      });

      if (!response.ok) {
        throw new Error('Failed to fetch bars');
      }

      return response.json();
    },
    enabled: !!(coords?.latitude && coords?.longitude),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: false,
  });

  // Filter bars: only $$ and above (expense_rank >= 2), only OPEN bars
  const filteredBars = React.useMemo(() => {
    const allBars = [...(barsData?.data?.venues || []), ...(barsData?.data?.last_call_venues || [])];

    // Remove duplicates by place_id or name+lat+lng
    const seen = new Set<string>();
    const uniqueBars = allBars.filter(bar => {
      const key = bar.place_id || `${bar.name}-${bar.lat}-${bar.lng}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Filter: $$ and above (expense_rank >= 2) AND open only (no closed bars)
    const openPremiumBars = uniqueBars.filter(bar => bar.expense_rank >= 2 && bar.is_open);

    const openCount = openPremiumBars.filter(b => !b.closing_soon).length;
    const closingSoonCount = openPremiumBars.filter(b => b.closing_soon).length;
    console.log(`[MapPage] Bars: ${openPremiumBars.length} open $$+ bars (${openCount} open, ${closingSoonCount} closing soon)`);
    return openPremiumBars;
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
  const venues = blocks.map((block, idx) => ({
    id: `${idx}`,
    name: block.name,
    lat: block.coordinates.lat,
    lng: block.coordinates.lng,
    distance_miles: block.estimated_distance_miles,
    drive_time_min: block.driveTimeMinutes || block.estimatedWaitTime,
    est_earnings_per_ride: block.estimated_earnings,
    rank: idx + 1,
    value_grade: block.value_grade,
  }));

  // Transform ACTIVE events to map format (only events happening NOW)
  // Uses useActiveEventsQuery which fetches ?filter=active from the API
  // This ensures the map shows real-time events, not all upcoming events
  const mapEvents: MapEvent[] = (activeEventsData?.events || []).map((e: BriefingEvent): MapEvent => ({
    title: e.title as string,
    venue: e.venue as string | undefined,
    address: e.address as string | undefined,
    event_date: e.event_date as string | undefined,
    event_end_date: (e as BriefingEvent & { event_end_date?: string }).event_end_date,
    event_time: e.event_time as string | undefined,
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
