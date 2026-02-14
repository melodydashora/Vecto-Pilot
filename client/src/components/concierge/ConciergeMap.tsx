// client/src/components/concierge/ConciergeMap.tsx
// 2026-02-13: Lightweight Google Map for the public concierge page
// Shows passenger's location (blue pin) + venue markers (purple) + event markers (amber)
// Loads on-demand when user taps "Show Map" — saves bandwidth for mobile

import { useEffect, useRef, useState } from 'react';
import { MapPin, Loader2 } from 'lucide-react';

// Google Maps is loaded dynamically via script tag.
// Types are declared globally in MapTab.tsx — we use loose typing here to avoid
// re-declaring the global namespace which causes TS2717 conflicts.

interface MapVenue {
  title: string;
  address?: string;
  type?: string;
  lat?: number;
  lng?: number;
}

interface MapEvent {
  title: string;
  venue?: string;
  address?: string;
  type?: string;
  time?: string;
  lat?: number;
  lng?: number;
}

interface ConciergeMapProps {
  lat: number;
  lng: number;
  venues: MapVenue[];
  events: MapEvent[];
}

// Simple SVG marker URLs using data URIs (no external dependencies)
const MARKER_COLORS = {
  passenger: '#3B82F6', // blue
  venue: '#8B5CF6',     // purple
  event: '#F59E0B',     // amber
};

function makeSvgMarker(color: string, label?: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">
    <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.268 21.732 0 14 0z" fill="${color}" stroke="white" stroke-width="2"/>
    <circle cx="14" cy="14" r="6" fill="white"/>
    ${label ? `<text x="14" y="17" text-anchor="middle" font-size="10" font-weight="bold" fill="${color}">${label}</text>` : ''}
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function ConciergeMap({ lat, lng, venues, events }: ConciergeMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const infoWindowRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);

  // Initialize Google Map
  useEffect(() => {
    if (!mapRef.current) return;

    // If Google Maps already loaded (from MapTab or previous instance), reuse it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).google?.maps) {
      initializeMap();
      return;
    }

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      console.error('[ConciergeMap] VITE_GOOGLE_MAPS_API_KEY not configured');
      setMapError(true);
      return;
    }

    // Check if script is already loading (from another component)
    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existingScript) {
      // Wait for existing script to load
      existingScript.addEventListener('load', () => initializeMap());
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=maps`;
    script.async = true;
    script.defer = true;

    script.onload = () => initializeMap();
    script.onerror = () => {
      console.error('[ConciergeMap] Failed to load Google Maps');
      setMapError(true);
    };

    document.head.appendChild(script);
  }, []);

  function initializeMap() {
    if (!mapRef.current || !(window as any).google) return;

    const map = new (window as any).google.maps.Map(mapRef.current, {
      center: { lat, lng },
      zoom: 13,
      mapTypeControl: false,
      fullscreenControl: true,
      zoomControl: true,
      streetViewControl: false,
      minZoom: 10,
      maxZoom: 18,
    });

    mapInstanceRef.current = map;
    infoWindowRef.current = new (window as any).google.maps.InfoWindow();
    setMapReady(true);
  }

  // Add/update markers when map is ready or data changes
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;

    const map = mapInstanceRef.current;
    const infoWindow = infoWindowRef.current!;

    // Clear existing markers
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    const bounds = new (window as any).google.maps.LatLngBounds();

    // Passenger marker (blue — "You are here")
    const passengerMarker = new (window as any).google.maps.Marker({
      position: { lat, lng },
      map,
      title: 'You are here',
      icon: makeSvgMarker(MARKER_COLORS.passenger),
      zIndex: 1000,
    });
    passengerMarker.addListener('click', () => {
      infoWindow.setContent('<div style="font-weight:600;padding:4px">You are here</div>');
      infoWindow.open(map, passengerMarker);
    });
    markersRef.current.push(passengerMarker);
    bounds.extend(new (window as any).google.maps.LatLng(lat, lng));

    // Venue markers (purple)
    venues.forEach((venue, idx) => {
      if (!venue.lat || !venue.lng) return;
      const marker = new (window as any).google.maps.Marker({
        position: { lat: venue.lat, lng: venue.lng },
        map,
        title: venue.title,
        icon: makeSvgMarker(MARKER_COLORS.venue, `${idx + 1}`),
        zIndex: 500,
      });
      marker.addListener('click', () => {
        const nav = venue.address
          ? `<a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(venue.address)}" target="_blank" style="color:#6366F1;text-decoration:none;font-size:12px">Get directions</a>`
          : '';
        infoWindow.setContent(`
          <div style="max-width:200px;padding:4px">
            <div style="font-weight:600;font-size:14px">${venue.title}</div>
            ${venue.type ? `<div style="color:#666;font-size:11px;margin-top:2px">${venue.type}</div>` : ''}
            ${venue.address ? `<div style="color:#888;font-size:11px;margin-top:4px">${venue.address}</div>` : ''}
            ${nav ? `<div style="margin-top:6px">${nav}</div>` : ''}
          </div>
        `);
        infoWindow.open(map, marker);
      });
      markersRef.current.push(marker);
      bounds.extend(new (window as any).google.maps.LatLng(venue.lat, venue.lng));
    });

    // Event markers (amber)
    events.forEach((event, idx) => {
      if (!event.lat || !event.lng) return;
      const marker = new (window as any).google.maps.Marker({
        position: { lat: event.lat, lng: event.lng },
        map,
        title: event.title,
        icon: makeSvgMarker(MARKER_COLORS.event, `${idx + 1}`),
        zIndex: 400,
      });
      marker.addListener('click', () => {
        const nav = event.address
          ? `<a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(event.address)}" target="_blank" style="color:#6366F1;text-decoration:none;font-size:12px">Get directions</a>`
          : '';
        infoWindow.setContent(`
          <div style="max-width:200px;padding:4px">
            <div style="font-weight:600;font-size:14px">${event.title}</div>
            ${event.venue ? `<div style="color:#666;font-size:12px">${event.venue}</div>` : ''}
            ${event.time ? `<div style="color:#888;font-size:11px;margin-top:2px">${event.time}</div>` : ''}
            ${event.address ? `<div style="color:#888;font-size:11px;margin-top:4px">${event.address}</div>` : ''}
            ${nav ? `<div style="margin-top:6px">${nav}</div>` : ''}
          </div>
        `);
        infoWindow.open(map, marker);
      });
      markersRef.current.push(marker);
      bounds.extend(new (window as any).google.maps.LatLng(event.lat, event.lng));
    });

    // Fit bounds to show all markers (only if we have more than just the passenger)
    const totalPins = venues.filter(v => v.lat && v.lng).length + events.filter(e => e.lat && e.lng).length;
    if (totalPins > 0) {
      map.fitBounds(bounds, { top: 40, right: 20, bottom: 20, left: 20 });
    }

  }, [mapReady, lat, lng, venues, events]);

  if (mapError) {
    return (
      <div className="h-[300px] bg-gray-100 rounded-xl flex flex-col items-center justify-center gap-2">
        <MapPin className="h-6 w-6 text-gray-400" />
        <p className="text-sm text-gray-500">Map unavailable</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Map container */}
      <div
        ref={mapRef}
        className="h-[300px] rounded-xl overflow-hidden border border-gray-200 shadow-sm"
      />

      {/* Loading overlay */}
      {!mapReady && (
        <div className="absolute inset-0 bg-gray-100 rounded-xl flex flex-col items-center justify-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-teal-500" />
          <p className="text-sm text-gray-500">Loading map...</p>
        </div>
      )}

      {/* Legend */}
      {mapReady && (
        <div className="flex items-center gap-4 mt-2 px-1 text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: MARKER_COLORS.passenger }} />
            <span>You</span>
          </div>
          {venues.length > 0 && (
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: MARKER_COLORS.venue }} />
              <span>Venues</span>
            </div>
          )}
          {events.length > 0 && (
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: MARKER_COLORS.event }} />
              <span>Events</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
