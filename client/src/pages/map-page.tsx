/**
 * MapPage - Standalone interactive map page showing venue recommendations with traffic overlay
 */

import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation as useWouterLocation } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { MapPin, AlertCircle } from 'lucide-react';
import MapTab from '@/components/MapTab';
import { useLocation } from '@/contexts/location-context-clean';

interface SmartBlock {
  name: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  estimated_distance_miles?: number;
  driveTimeMinutes?: number;
  estimatedWaitTime?: number;
  estimated_earnings?: number;
  value_grade?: string;
}

interface BlocksResponse {
  blocks: SmartBlock[];
}

const MapPage: React.FC = () => {
  const locationContext = useLocation();
  const [lastSnapshotId, setLastSnapshotId] = useState<string | null>(() => {
    return localStorage.getItem('vecto_strategy_snapshot_id');
  });

  const coords = locationContext?.currentCoords;

  // Fetch blocks for current snapshot
  const { data: blocksData, isLoading: blocksLoading } = useQuery({
    queryKey: ['/api/blocks/snapshot', lastSnapshotId],
    queryFn: async () => {
      if (!lastSnapshotId) return null;
      
      const response = await fetch(`/api/blocks/snapshot/${lastSnapshotId}`);
      if (!response.ok) return null;
      
      return response.json() as Promise<BlocksResponse>;
    },
    enabled: !!lastSnapshotId,
    staleTime: 30 * 1000, // Cache for 30 seconds
  });

  // Listen for new snapshots
  useEffect(() => {
    const handleSnapshotSaved = (e: any) => {
      const snapshotId = e.detail?.snapshotId;
      if (snapshotId) {
        setLastSnapshotId(snapshotId);
      }
    };

    window.addEventListener("vecto-snapshot-saved", handleSnapshotSaved as EventListener);
    return () => window.removeEventListener("vecto-snapshot-saved", handleSnapshotSaved as EventListener);
  }, []);

  const blocks = blocksData?.blocks || [];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 pb-24" data-testid="map-page">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <MapPin className="w-6 h-6 text-green-600" />
          <h1 className="text-2xl font-bold text-gray-900">Venue Map</h1>
        </div>
        <p className="text-gray-600">
          Interactive map showing AI-recommended venues with live traffic overlay
        </p>
      </div>

      {/* No Location State */}
      {!coords && (
        <Card className="p-8 mb-6" data-testid="no-gps-map-state">
          <div className="flex flex-col items-center justify-center text-center">
            <AlertCircle className="w-8 h-8 text-gray-400 mb-4" />
            <p className="text-gray-800 font-semibold mb-2">Location Required</p>
            <p className="text-gray-600 text-sm">
              Enable location services to view venues on the map
            </p>
          </div>
        </Card>
      )}

      {/* No Snapshot State */}
      {coords && !lastSnapshotId && (
        <Card className="p-8 mb-6" data-testid="no-snapshot-map-state">
          <div className="flex flex-col items-center justify-center text-center">
            <MapPin className="w-8 h-8 text-gray-400 mb-4" />
            <p className="text-gray-800 font-semibold mb-2">Generate Recommendations First</p>
            <p className="text-gray-600 text-sm">
              Go to Co-Pilot to generate venue recommendations, then view them here on the map
            </p>
          </div>
        </Card>
      )}

      {/* Map Display */}
      {coords && lastSnapshotId && (
        <>
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>Showing {blocks.length} venue{blocks.length !== 1 ? 's' : ''}</strong> from your latest recommendations
            </p>
          </div>

          <MapTab
            driverLat={coords.latitude}
            driverLng={coords.longitude}
            venues={blocks.map((block, idx) => ({
              id: `${idx}`,
              name: block.name,
              lat: block.coordinates.lat,
              lng: block.coordinates.lng,
              distance_miles: block.estimated_distance_miles,
              drive_time_min: block.driveTimeMinutes || block.estimatedWaitTime,
              est_earnings_per_ride: block.estimated_earnings,
              rank: idx + 1,
              value_grade: block.value_grade,
            }))}
            snapshotId={lastSnapshotId}
            isLoading={blocksLoading}
          />
        </>
      )}
    </div>
  );
};

export default MapPage;
