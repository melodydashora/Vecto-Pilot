// client/src/pages/co-pilot/MapPage.tsx
// Wrapper page for the Map tab showing venues and events on a map

import React from 'react';
import { MapPin } from 'lucide-react';
import MapTab from '@/components/MapTab';
import { useCoPilot } from '@/contexts/co-pilot-context';
import { useBriefingQueries } from '@/hooks/useBriefingQueries';
import type { PipelinePhase } from '@/types/co-pilot';

// Event type for MapTab
interface MapEvent {
  title: string;
  venue?: string;
  address?: string;
  event_date?: string;
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

export default function MapPage() {
  const { coords, lastSnapshotId, blocks, isBlocksLoading, pipelinePhase } = useCoPilot();

  // Get events data for map markers
  const { eventsData } = useBriefingQueries({
    snapshotId: lastSnapshotId,
    pipelinePhase: pipelinePhase as PipelinePhase
  });

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

  // Transform events to map format
  const mapEvents: MapEvent[] = (eventsData?.events || []).map((e: BriefingEvent): MapEvent => ({
    title: e.title as string,
    venue: e.venue as string | undefined,
    address: e.address as string | undefined,
    event_date: e.event_date as string | undefined,
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
        events={mapEvents}
        snapshotId={lastSnapshotId}
        isLoading={isBlocksLoading}
      />
    </div>
  );
}
