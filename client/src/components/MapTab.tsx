/**
 * MapTab - Interactive Google Map with live traffic overlay and venue pins
 * Displays SmartBlocks venues as markers with drive time and earnings info
 * Events are filtered to show only TODAY's events with valid start/end times
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Loader } from 'lucide-react';
import { filterTodayEvents, formatEventDate, formatEventTimeRange } from '@/utils/co-pilot-helpers';

// Google Maps type declarations (loaded dynamically via script)
declare global {
  interface Window {
    google: typeof google;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace google.maps {
  class Map {
    constructor(element: HTMLElement, options: MapOptions);
    fitBounds(bounds: LatLngBounds, padding?: number | { top?: number; right?: number; bottom?: number; left?: number; padding?: number }): void;
  }
  class Marker {
    constructor(options: MarkerOptions);
    setMap(map: Map | null): void;
    getPosition(): LatLng | null;
    addListener(event: string, handler: () => void): void;
  }
  class InfoWindow {
    constructor();
    setContent(content: string): void;
    open(map: Map, marker: Marker): void;
    close(): void;
  }
  class LatLngBounds {
    constructor();
    extend(point: LatLng): void;
  }
  class LatLng {
    constructor(lat: number, lng: number);
    lat(): number;
    lng(): number;
  }
  class TrafficLayer {
    constructor();
    setMap(map: Map): void;
  }
  interface MapOptions {
    center: { lat: number; lng: number };
    zoom: number;
    mapTypeControl?: boolean;
    fullscreenControl?: boolean;
    zoomControl?: boolean;
    streetViewControl?: boolean;
    minZoom?: number;
    maxZoom?: number;
  }
  interface MarkerOptions {
    position: { lat: number; lng: number };
    map: Map;
    title?: string;
    icon?: string;
    zIndex?: number;
  }
}

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

// Bar type for map markers (green=open, red=closing soon)
// Only shows $$ and above (expenseRank >= 2)
// 2026-01-10: Updated to camelCase to match useBarsQuery API response
interface MapBar {
  name: string;
  type: string;
  address: string;
  expenseLevel: string;
  expenseRank: number;
  isOpen: boolean;
  closingSoon: boolean;
  minutesUntilClose: number | null;
  lat: number;
  lng: number;
  placeId?: string;
  rating?: number | null;
}

interface MapTabProps {
  driverLat: number;
  driverLng: number;
  venues: Venue[];
  bars?: MapBar[];  // Premium bars ($$+) with open/closing status
  events?: MapEvent[];
  snapshotId?: string;
  isLoading?: boolean;
}

const MapTab: React.FC<MapTabProps> = ({
  driverLat,
  driverLng,
  venues,
  bars = [],
  events = [],
  snapshotId: _snapshotId,
  isLoading = false
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const barMarkersRef = useRef<google.maps.Marker[]>([]);  // Bar markers (green/red)
  const eventMarkersRef = useRef<google.maps.Marker[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Filter events to only show TODAY's events with valid start/end times
  const todayEvents = useMemo(() => {
    const filtered = filterTodayEvents(events);
    console.log(`[MapTab] Showing ${filtered.length} of ${events.length} events (today only with valid times)`);
    return filtered;
  }, [events]);

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

        // Get grade badge color
        const getGradeBadgeStyle = (grade?: string) => {
          switch (grade?.toUpperCase()) {
            case 'A': return 'background: #dcfce7; color: #166534; border: 1px solid #86efac;';
            case 'B': return 'background: #fef3c7; color: #92400e; border: 1px solid #fcd34d;';
            default: return 'background: #f3f4f6; color: #6b7280; border: 1px solid #d1d5db;';
          }
        };

        const content = `
          <div style="padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 260px;">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 10px;">
              <div style="font-weight: 600; font-size: 14px; color: #1f2937; line-height: 1.3;">
                ${venue.name}
              </div>
              ${venue.value_grade ? `
                <span style="padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; ${getGradeBadgeStyle(venue.value_grade)}">
                  Grade ${venue.value_grade}
                </span>
              ` : ''}
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; padding: 10px; background: #f8fafc; border-radius: 6px;">
              <div>
                <span style="color: #6b7280; display: block; font-size: 10px; text-transform: uppercase; margin-bottom: 2px;">Distance</span>
                <span style="font-weight: 600; color: #1f2937; font-size: 14px;">${venue.distance_miles?.toFixed(1) || 'N/A'} mi</span>
              </div>
              <div>
                <span style="color: #6b7280; display: block; font-size: 10px; text-transform: uppercase; margin-bottom: 2px;">Drive Time</span>
                <span style="font-weight: 600; color: #1f2937; font-size: 14px;">${venue.drive_time_min || 'N/A'} min</span>
              </div>
            </div>

            ${venue.est_earnings_per_ride ? `
              <div style="background: linear-gradient(135deg, #ecfdf5, #d1fae5); padding: 10px; border-radius: 6px; margin-bottom: 10px; border: 1px solid #a7f3d0;">
                <span style="color: #047857; font-size: 11px; display: block; margin-bottom: 2px;">Est. Earnings</span>
                <span style="font-size: 16px; font-weight: 700; color: #059669;">$${venue.est_earnings_per_ride.toFixed(2)}/ride</span>
              </div>
            ` : ''}

            <div style="font-size: 11px; color: #9ca3af; margin-bottom: 10px;">
              Rank: #${venue.rank || index + 1}
            </div>

            <div style="display: flex; gap: 8px;">
              <a href="https://maps.google.com/maps?daddr=${venue.lat},${venue.lng}&directionsmode=driving"
                 target="_blank"
                 style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px; background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; border-radius: 6px; text-decoration: none; font-size: 12px; font-weight: 500; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.3);">
                🧭 Navigate
              </a>
              <a href="https://maps.apple.com/?daddr=${venue.lat},${venue.lng}&dirflg=d"
                 target="_blank"
                 style="display: flex; align-items: center; justify-content: center; gap: 4px; padding: 10px 12px; background: #f1f5f9; color: #475569; border-radius: 6px; text-decoration: none; font-size: 12px; font-weight: 500; border: 1px solid #e2e8f0;">
                🍎
              </a>
            </div>
          </div>
        `;

        infoWindowRef.current?.setContent(content);
        infoWindowRef.current?.open(mapInstanceRef.current, marker);
      });

      markersRef.current.push(marker);
    });

    // Fit bounds to show all markers (venues + events)
    if ((markersRef.current.length > 0 || eventMarkersRef.current.length > 0) && window.google) {
      const bounds = new window.google.maps.LatLngBounds();
      markersRef.current.forEach(marker => {
        bounds.extend(marker.getPosition()!);
      });
      eventMarkersRef.current.forEach(marker => {
        bounds.extend(marker.getPosition()!);
      });
      mapInstanceRef.current?.fitBounds(bounds, { padding: 60 });
    }
  }, [mapReady, venues, driverLat, driverLng]);

  // Add event markers with flag icons (TODAY'S EVENTS ONLY)
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !window.google) return;

    // Clear existing event markers
    eventMarkersRef.current.forEach(marker => marker.setMap(null));
    eventMarkersRef.current = [];

    // Use filtered today events with valid coordinates
    const eventsWithCoords = todayEvents.filter(e => e.latitude && e.longitude);

    eventsWithCoords.forEach((event) => {
      // Use purple marker for events (distinct from venue colors)
      const icon = 'http://maps.google.com/mapfiles/ms/icons/purple-dot.png';

      const marker = new window.google.maps.Marker({
        position: { lat: event.latitude!, lng: event.longitude! },
        map: mapInstanceRef.current,
        title: event.title,
        icon: icon,
        zIndex: 800, // Below top venues but visible
      });

      // Build date and time display
      // 2026-01-10: Use symmetric field names (event_start_date, event_start_time)
      const dateDisplay = formatEventDate(event.event_start_date);
      const timeDisplay = formatEventTimeRange(event.event_start_time, event.event_end_time);

      // Get event category icon
      const getCategoryIcon = (subtype?: string) => {
        if (!subtype) return '📍';
        const sub = subtype.toLowerCase();
        if (sub.includes('concert') || sub.includes('music')) return '🎵';
        if (sub.includes('sport') || sub.includes('game')) return '🏀';
        if (sub.includes('festival') || sub.includes('fair')) return '🎉';
        if (sub.includes('convention') || sub.includes('expo')) return '🎪';
        if (sub.includes('theater') || sub.includes('comedy')) return '🎭';
        if (sub.includes('nightlife') || sub.includes('club')) return '🍸';
        return '📍';
      };

      // Impact badge color
      const getImpactStyle = (impact?: string) => {
        switch (impact) {
          case 'high': return 'background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5;';
          case 'medium': return 'background: #fef3c7; color: #92400e; border: 1px solid #fcd34d;';
          default: return 'background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7;';
        }
      };

      // Info window on click
      marker.addListener('click', () => {
        if (infoWindowRef.current) {
          infoWindowRef.current.close();
        }

        const content = `
          <div style="padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 280px;">
            <div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
              <span style="font-size: 20px;">${getCategoryIcon(event.subtype)}</span>
              <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 14px; color: #1f2937; line-height: 1.3;">
                  ${event.title}
                </div>
                ${event.venue ? `<div style="font-size: 12px; color: #6b7280; margin-top: 2px;">@ ${event.venue}</div>` : ''}
              </div>
            </div>

            <!-- Date & Time Section (Required for all displayed events) -->
            <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; padding: 10px; background: linear-gradient(135deg, #f3e8ff, #e0f2fe); border-radius: 8px;">
              <div style="display: flex; align-items: center; gap: 4px;">
                <span style="font-size: 14px;">📅</span>
                <span style="font-weight: 600; color: ${dateDisplay === 'Today' ? '#059669' : '#7c3aed'}; font-size: 13px;">${dateDisplay}</span>
              </div>
              ${timeDisplay ? `
                <div style="display: flex; align-items: center; gap: 4px;">
                  <span style="font-size: 14px;">🕐</span>
                  <span style="font-weight: 600; color: #7c3aed; font-size: 13px;">${timeDisplay}</span>
                </div>
              ` : ''}
            </div>

            ${event.address ? `
              <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">
                📍 ${event.address}
              </div>
            ` : ''}

            ${event.impact ? `
              <div style="display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; ${getImpactStyle(event.impact)}">
                ${event.impact.toUpperCase()} IMPACT
              </div>
            ` : ''}

            <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #e5e7eb; display: flex; gap: 8px;">
              <a href="https://maps.google.com/maps?daddr=${event.latitude},${event.longitude}&directionsmode=driving"
                 target="_blank"
                 style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; background: #8b5cf6; color: white; border-radius: 6px; text-decoration: none; font-size: 12px; font-weight: 500;">
                🧭 Navigate
              </a>
              <a href="https://maps.apple.com/?daddr=${event.latitude},${event.longitude}&dirflg=d"
                 target="_blank"
                 style="display: flex; align-items: center; justify-content: center; padding: 8px 12px; background: #f3e8ff; color: #7c3aed; border-radius: 6px; text-decoration: none; font-size: 12px; font-weight: 500; border: 1px solid #ddd6fe;">
                🍎
              </a>
            </div>
          </div>
        `;

        infoWindowRef.current?.setContent(content);
        infoWindowRef.current?.open(mapInstanceRef.current, marker);
      });

      eventMarkersRef.current.push(marker);
    });

    console.log(`✅ Added ${eventsWithCoords.length} TODAY's event markers to map (filtered from ${events.length} total)`);
  }, [mapReady, todayEvents, events.length]);

  // Add bar markers with color coding (green=open, red=closing soon)
  // Bars are $$+ venues separate from strategy blocks
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !window.google) return;

    // Clear existing bar markers
    barMarkersRef.current.forEach(marker => marker.setMap(null));
    barMarkersRef.current = [];

    bars.forEach((bar) => {
      // Color coding: green = open, red = closing soon (only open bars are passed)
      // 2026-01-10: Updated to use camelCase property names
      const isClosingSoon = bar.closingSoon;
      const color = isClosingSoon ? 'red' : 'green';
      const statusLabel = isClosingSoon
        ? (bar.minutesUntilClose ? `Closing in ${bar.minutesUntilClose}min` : 'Closing soon')
        : 'Open';

      const icon = `http://maps.google.com/mapfiles/ms/icons/${color}-dot.png`;

      const marker = new window.google.maps.Marker({
        position: { lat: bar.lat, lng: bar.lng },
        map: mapInstanceRef.current,
        title: `${bar.name} (${bar.expenseLevel})`,
        icon: icon,
        zIndex: 600, // Below venues and events
      });

      // Get venue type icon
      const getTypeIcon = (type: string) => {
        switch (type) {
          case 'nightclub': return '🎉';
          case 'wine_bar': return '🍷';
          case 'lounge': return '🍸';
          default: return '🍺';
        }
      };

      // Info window on click
      marker.addListener('click', () => {
        if (infoWindowRef.current) {
          infoWindowRef.current.close();
        }

        // Status style: green for open, red for closing soon
        const statusStyle = isClosingSoon
          ? 'background: #fef2f2; color: #991b1b; border: 1px solid #fca5a5;'
          : 'background: #dcfce7; color: #166534; border: 1px solid #86efac;';

        const content = `
          <div style="padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 260px;">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 8px;">
              <div style="font-weight: 600; font-size: 14px; color: #1f2937; line-height: 1.3;">
                ${getTypeIcon(bar.type)} ${bar.name}
              </div>
              <span style="padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; ${statusStyle}">
                ${statusLabel}
              </span>
            </div>

            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
              <span style="padding: 2px 8px; background: #fef3c7; color: #92400e; border-radius: 4px; font-size: 11px; font-weight: 600;">
                ${bar.expenseLevel}
              </span>
              ${bar.rating ? `
                <span style="padding: 2px 8px; background: #e0f2fe; color: #0369a1; border-radius: 4px; font-size: 11px;">
                  ⭐ ${bar.rating.toFixed(1)}
                </span>
              ` : ''}
            </div>

            <div style="font-size: 12px; color: #6b7280; margin-bottom: 10px;">
              📍 ${bar.address}
            </div>

            <div style="display: flex; gap: 8px;">
              <a href="https://maps.google.com/maps?daddr=${bar.lat},${bar.lng}&directionsmode=driving"
                 target="_blank"
                 style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; background: linear-gradient(135deg, #10b981, #059669); color: white; border-radius: 6px; text-decoration: none; font-size: 12px; font-weight: 500;">
                🧭 Navigate
              </a>
              <a href="https://maps.apple.com/?daddr=${bar.lat},${bar.lng}&dirflg=d"
                 target="_blank"
                 style="display: flex; align-items: center; justify-content: center; padding: 8px 12px; background: #f1f5f9; color: #475569; border-radius: 6px; text-decoration: none; font-size: 12px; font-weight: 500; border: 1px solid #e2e8f0;">
                🍎
              </a>
            </div>
          </div>
        `;

        infoWindowRef.current?.setContent(content);
        infoWindowRef.current?.open(mapInstanceRef.current, marker);
      });

      barMarkersRef.current.push(marker);
    });

    console.log(`✅ Added ${bars.length} open bar markers ($$+): ${bars.filter(b => !b.closing_soon).length} open (green), ${bars.filter(b => b.closing_soon).length} closing soon (red)`);
  }, [mapReady, bars]);

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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          {/* Strategy Venues Column */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Strategy Venues</div>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-blue-400 border border-blue-500" />
              <span className="text-gray-700">Your location</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-red-400 border border-red-500" />
              <span className="text-gray-700">Top venue (Grade A)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-orange-400 border border-orange-500" />
              <span className="text-gray-700">Good venue (Grade B)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-yellow-400 border border-yellow-500" />
              <span className="text-gray-700">Standard venue (Grade C+)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-purple-400 border border-purple-500" />
              <span className="text-gray-700">Event (today only)</span>
            </div>
          </div>

          {/* Bars Column */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Bars & Lounges ($$+)</div>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-green-500 border border-green-600" />
              <span className="text-gray-700">Open bar</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-red-500 border border-red-600" />
              <span className="text-gray-700">Closing soon (last call!)</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Only shows open $$ and above venues
            </div>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500 flex items-start gap-2">
          <span className="mt-0.5">🚦</span>
          <span>Traffic overlay shows real-time road conditions (green=flowing, yellow=slow, red=congested)</span>
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
