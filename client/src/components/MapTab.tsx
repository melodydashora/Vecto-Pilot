/**
 * MapTab - Interactive Google Map with live traffic overlay and venue pins
 * Displays SmartBlocks venues as markers with drive time and earnings info
 */

import React, { useEffect, useRef, useState } from 'react';
import { Loader } from 'lucide-react';

interface Venue {
  id: string;
  name: string;
  lat: number;
  lng: number;
  distance_miles?: number;
  drive_time_min?: number;
  est_earnings_per_ride?: number;
  rank?: number;
  value_grade?: string;
}

interface MapTabProps {
  driverLat: number;
  driverLng: number;
  venues: Venue[];
  snapshotId?: string;
  isLoading?: boolean;
}

const MapTab: React.FC<MapTabProps> = ({ 
  driverLat,
  driverLng,
  venues,
  snapshotId: _snapshotId,
  isLoading = false
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Initialize Google Map
  useEffect(() => {
    if (!mapRef.current || mapReady) return;

    const script = document.createElement('script');
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    
    if (!apiKey) {
      console.error('❌ VITE_GOOGLE_MAPS_API_KEY not configured');
      return;
    }

    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=maps`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      if (mapRef.current && window.google) {
        const map = new window.google.maps.Map(mapRef.current, {
          center: { lat: driverLat, lng: driverLng },
          zoom: 12,
          mapTypeControl: true,
          fullscreenControl: true,
          zoomControl: false,
          streetViewControl: false,
          minZoom: 10,
          maxZoom: 18,
        });

        // Enable traffic layer
        const trafficLayer = new window.google.maps.TrafficLayer();
        trafficLayer.setMap(map);

        mapInstanceRef.current = map;
        infoWindowRef.current = new window.google.maps.InfoWindow();
        setMapReady(true);

        console.log('✅ Google Map initialized with traffic layer');
      }
    };

    document.head.appendChild(script);

    return () => {
      if (document.head.contains(script)) {
        document.head.removeChild(script);
      }
    };
  }, [driverLat, driverLng, mapReady]);

  // Add driver location marker
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !window.google) return;

    // Clear existing markers
    markersRef.current.forEach(marker => marker.setMap(null));
    markersRef.current = [];

    // Add driver marker (blue)
    const driverMarker = new window.google.maps.Marker({
      position: { lat: driverLat, lng: driverLng },
      map: mapInstanceRef.current,
      title: 'Your Location',
      icon: 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png',
      zIndex: 1000,
    });

    markersRef.current.push(driverMarker);

    // Add venue markers
    venues.forEach((venue, index) => {
      const isTopVenue = (venue.rank || 999) <= 3;
      const color = venue.value_grade === 'A' 
        ? 'red' 
        : venue.value_grade === 'B' 
        ? 'orange' 
        : 'yellow';

      const icon = `http://maps.google.com/mapfiles/ms/icons/${color}-dot.png`;

      const marker = new window.google.maps.Marker({
        position: { lat: venue.lat, lng: venue.lng },
        map: mapInstanceRef.current,
        title: venue.name,
        icon: icon,
        zIndex: isTopVenue ? 999 : 500,
      });

      // Info window on click
      marker.addListener('click', () => {
        if (infoWindowRef.current) {
          infoWindowRef.current.close();
        }

        const content = `
          <div style="padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 220px;">
            <div style="font-weight: 600; margin-bottom: 8px; font-size: 14px; color: #1f2937;">
              ${venue.name}
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; font-size: 13px;">
              <div>
                <span style="color: #6b7280; display: block; font-size: 11px; text-transform: uppercase; margin-bottom: 2px;">Distance</span>
                <span style="font-weight: 500; color: #1f2937;">${venue.distance_miles?.toFixed(1) || 'N/A'} mi</span>
              </div>
              <div>
                <span style="color: #6b7280; display: block; font-size: 11px; text-transform: uppercase; margin-bottom: 2px;">Drive Time</span>
                <span style="font-weight: 500; color: #1f2937;">${venue.drive_time_min || 'N/A'} min</span>
              </div>
            </div>
            ${venue.est_earnings_per_ride ? `
              <div style="background: #f3f4f6; padding: 8px; border-radius: 4px; font-size: 13px; color: #059669; font-weight: 500;">
                Est. Earnings: $${venue.est_earnings_per_ride.toFixed(2)}/ride
              </div>
            ` : ''}
            <div style="margin-top: 10px; font-size: 12px; color: #6b7280;">
              Rank: #${venue.rank || index + 1} | Grade: ${venue.value_grade || 'N/A'}
            </div>
          </div>
        `;

        infoWindowRef.current?.setContent(content);
        infoWindowRef.current?.open(mapInstanceRef.current, marker);
      });

      markersRef.current.push(marker);
    });

    // Fit bounds to show all markers
    if (markersRef.current.length > 0 && window.google) {
      const bounds = new window.google.maps.LatLngBounds();
      markersRef.current.forEach(marker => {
        bounds.extend(marker.getPosition()!);
      });
      mapInstanceRef.current?.fitBounds(bounds, { padding: 60 });
    }
  }, [mapReady, venues, driverLat, driverLng]);

  return (
    <div className="mb-24" data-testid="map-tab">
      {isLoading && (
        <div className="flex items-center justify-center py-12 text-gray-500">
          <Loader className="w-5 h-5 animate-spin mr-2" />
          Loading map...
        </div>
      )}

      <div
        ref={mapRef}
        style={{
          width: '100%',
          height: '600px',
          borderRadius: '8px',
          overflow: 'hidden',
          border: '1px solid #e5e7eb',
        }}
        className="shadow-md"
        data-testid="google-map-container"
      />

      {/* Legend */}
      <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <h3 className="font-semibold text-gray-800 mb-3">Map Legend</h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-blue-400 border border-blue-500" />
            <span className="text-gray-700">Your location</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-red-400 border border-red-500" />
            <span className="text-gray-700">Top venue (Grade A)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-orange-400 border border-orange-500" />
            <span className="text-gray-700">Good venue (Grade B)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-yellow-400 border border-yellow-500" />
            <span className="text-gray-700">Standard venue (Grade C+)</span>
          </div>
          <div className="mt-3 text-xs text-gray-500 flex items-start gap-2">
            <span className="mt-0.5">🚦</span>
            <span>Traffic overlay shows real-time road conditions (green=flowing, yellow=slow, red=congested)</span>
          </div>
        </div>
      </div>

      {venues.length === 0 && !isLoading && (
        <div className="text-center py-12 text-gray-500">
          <p>No venues to display. Generate recommendations to see them on the map.</p>
        </div>
      )}
    </div>
  );
};

export default MapTab;
