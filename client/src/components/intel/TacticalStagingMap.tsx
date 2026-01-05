/**
 * TacticalStagingMap - Interactive Google Map for mission-based tactical staging
 *
 * Displays:
 * - Driver location (blue marker)
 * - Selected mission target (purple marker)
 * - Staging zones (green markers) - where to wait
 * - Avoid zones (red markers) - areas to stay away from
 * - Traffic layer overlay
 *
 * Features:
 * - Mission selector dropdown (events + airports)
 * - AI Tactical Plan button for enhanced recommendations
 * - InfoWindows with zone details
 * - Navigation buttons (Google Maps / Apple Maps)
 *
 * Pattern follows: MapTab.tsx (direct Google Maps API loading)
 */

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  MapPin,
  Navigation,
  Loader2,
  AlertTriangle,
  Sparkles,
  Target,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import type {
  TacticalStagingMapProps,
  Mission,
  EventMission,
  AirportMission,
  TacticalZone,
  ActiveMission,
  TacticalPlanResponse,
  StagingAreasResponse,
} from '@/types/tactical-map';
import { MARKER_CONFIGS } from '@/types/tactical-map';

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
    fitBounds(bounds: LatLngBounds, padding?: number | { top?: number; right?: number; bottom?: number; left?: number }): void;
    setCenter(latlng: LatLng | { lat: number; lng: number }): void;
    setZoom(zoom: number): void;
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
    extend(point: LatLng | { lat: number; lng: number }): void;
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
    icon?: string | { url: string; scaledSize?: Size };
    zIndex?: number;
    label?: string | { text: string; color: string };
  }
  class Size {
    constructor(width: number, height: number);
  }
}

// Marker color configuration
const MARKER_COLORS = {
  driver: '#3B82F6',   // blue
  mission: '#8B5CF6',  // purple
  staging: '#10B981',  // green
  avoid: '#EF4444',    // red
};

// Create colored marker icon URL using Google Charts API
const createMarkerIcon = (color: string) =>
  `https://chart.googleapis.com/chart?chst=d_map_pin_letter&chld=%E2%80%A2|${color.replace('#', '')}`;

export default function TacticalStagingMap({
  snapshotId,
  driverLat,
  driverLng,
  timezone,
  events = [],
  airports = [],
  trafficContext,
}: TacticalStagingMapProps) {
  // Refs
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  // State
  const [mapReady, setMapReady] = useState(false);
  const [activeMission, setActiveMission] = useState<ActiveMission | null>(null);
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [isLoadingStagingAreas, setIsLoadingStagingAreas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  // Convert events and airports to missions
  // Note: events and airports come pre-mapped from RideshareIntelTab with name/lat/lng
  const missions = useMemo(() => {
    const eventMissions: Mission[] = events
      .filter(e => e.lat && e.lng) // Only events with coordinates
      .map(e => ({
        id: e.id || `event-${e.name}`,
        type: 'event' as const,
        name: e.name,
        lat: e.lat,
        lng: e.lng,
        subtitle: e.subtitle || (e.eventTime ? `${e.name} - ${e.eventTime}` : e.name),
        ...e,
      }));

    const airportMissions: Mission[] = airports
      .filter(a => a.lat && a.lng) // Only airports with coordinates
      .map(a => ({
        id: a.id || `airport-${a.code}`,
        type: 'airport' as const,
        name: a.name || a.code,
        lat: a.lat,
        lng: a.lng,
        subtitle: a.subtitle || (a.status === 'delays' ? `${a.code} - Delays` : a.code),
        code: a.code,
        ...a,
      }));

    return [...eventMissions, ...airportMissions];
  }, [events, airports]);

  // Initialize Google Map - only load script once
  useEffect(() => {
    if (!mapRef.current || mapReady) return;

    // Check if Google Maps is already loaded
    if (window.google?.maps) {
      const map = new window.google.maps.Map(mapRef.current, {
        center: { lat: driverLat, lng: driverLng },
        zoom: 12,
        mapTypeControl: true,
        fullscreenControl: true,
        zoomControl: true,
        streetViewControl: false,
        minZoom: 10,
        maxZoom: 18,
      });
      const trafficLayer = new window.google.maps.TrafficLayer();
      trafficLayer.setMap(map);
      mapInstanceRef.current = map;
      infoWindowRef.current = new window.google.maps.InfoWindow();
      setMapReady(true);
      return;
    }

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      setError('Google Maps API key not configured');
      console.error('[TacticalMap] VITE_GOOGLE_MAPS_API_KEY not configured');
      return;
    }

    // Check if script is already loading/loaded
    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existingScript) {
      // Wait for existing script to load
      existingScript.addEventListener('load', () => {
        if (mapRef.current && window.google?.maps) {
          const map = new window.google.maps.Map(mapRef.current, {
            center: { lat: driverLat, lng: driverLng },
            zoom: 12,
            mapTypeControl: true,
            fullscreenControl: true,
            zoomControl: true,
            streetViewControl: false,
            minZoom: 10,
            maxZoom: 18,
          });
          const trafficLayer = new window.google.maps.TrafficLayer();
          trafficLayer.setMap(map);
          mapInstanceRef.current = map;
          infoWindowRef.current = new window.google.maps.InfoWindow();
          setMapReady(true);
        }
      });
      return;
    }

    const script = document.createElement('script');
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
          zoomControl: true,
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

        console.log('[TacticalMap] Google Map initialized with traffic layer');
      }
    };

    script.onerror = () => {
      setError('Failed to load Google Maps');
    };

    document.head.appendChild(script);

    // Don't remove the script on cleanup - it should persist
  }, [driverLat, driverLng, mapReady]);

  // Clear all markers
  const clearMarkers = useCallback(() => {
    markersRef.current.forEach(marker => marker.setMap(null));
    markersRef.current = [];
  }, []);

  // Add markers to map
  const updateMarkers = useCallback(() => {
    if (!mapReady || !mapInstanceRef.current || !window.google) return;

    clearMarkers();
    const bounds = new window.google.maps.LatLngBounds();
    const markers: google.maps.Marker[] = [];

    // Driver marker (blue)
    const driverMarker = new window.google.maps.Marker({
      position: { lat: driverLat, lng: driverLng },
      map: mapInstanceRef.current,
      title: 'Your Location',
      icon: createMarkerIcon(MARKER_COLORS.driver),
      zIndex: 100,
    });
    driverMarker.addListener('click', () => {
      if (infoWindowRef.current) {
        infoWindowRef.current.setContent(`
          <div style="padding: 8px; min-width: 150px;">
            <strong style="color: ${MARKER_COLORS.driver};">Your Location</strong>
            <p style="margin: 4px 0 0; font-size: 12px; color: #666;">Current position</p>
          </div>
        `);
        infoWindowRef.current.open(mapInstanceRef.current!, driverMarker);
      }
    });
    markers.push(driverMarker);
    bounds.extend({ lat: driverLat, lng: driverLng });

    // If we have an active mission, add mission and zone markers
    if (activeMission) {
      const { mission, stagingZones, avoidZones } = activeMission;

      // Mission target marker (purple)
      const missionMarker = new window.google.maps.Marker({
        position: { lat: mission.lat, lng: mission.lng },
        map: mapInstanceRef.current,
        title: mission.name,
        icon: createMarkerIcon(MARKER_COLORS.mission),
        zIndex: 90,
      });
      missionMarker.addListener('click', () => {
        if (infoWindowRef.current) {
          infoWindowRef.current.setContent(`
            <div style="padding: 8px; min-width: 200px;">
              <strong style="color: ${MARKER_COLORS.mission};">${mission.name}</strong>
              ${mission.subtitle ? `<p style="margin: 4px 0; font-size: 12px; color: #666;">${mission.subtitle}</p>` : ''}
              <div style="margin-top: 8px;">
                <a href="https://www.google.com/maps/dir/?api=1&destination=${mission.lat},${mission.lng}"
                   target="_blank" rel="noopener"
                   style="color: #3B82F6; font-size: 12px; text-decoration: none;">
                  Navigate with Google Maps
                </a>
              </div>
            </div>
          `);
          infoWindowRef.current.open(mapInstanceRef.current!, missionMarker);
        }
      });
      markers.push(missionMarker);
      bounds.extend({ lat: mission.lat, lng: mission.lng });

      // Staging zone markers (green)
      stagingZones.forEach((zone, idx) => {
        const stagingMarker = new window.google.maps.Marker({
          position: { lat: zone.lat, lng: zone.lng },
          map: mapInstanceRef.current!,
          title: zone.name,
          icon: createMarkerIcon(MARKER_COLORS.staging),
          zIndex: 80 - idx,
        });
        stagingMarker.addListener('click', () => {
          if (infoWindowRef.current) {
            infoWindowRef.current.setContent(`
              <div style="padding: 8px; min-width: 200px;">
                <strong style="color: ${MARKER_COLORS.staging};">STAGE HERE</strong>
                <p style="margin: 4px 0; font-weight: 600;">${zone.name}</p>
                ${zone.notes ? `<p style="margin: 4px 0; font-size: 12px; color: #666;">${zone.notes}</p>` : ''}
                <p style="margin: 4px 0; font-size: 10px; color: #999;">Source: ${zone.source}</p>
                <div style="margin-top: 8px;">
                  <a href="https://www.google.com/maps/dir/?api=1&destination=${zone.lat},${zone.lng}"
                     target="_blank" rel="noopener"
                     style="color: #10B981; font-size: 12px; text-decoration: none;">
                    Navigate here
                  </a>
                </div>
              </div>
            `);
            infoWindowRef.current.open(mapInstanceRef.current!, stagingMarker);
          }
        });
        markers.push(stagingMarker);
        bounds.extend({ lat: zone.lat, lng: zone.lng });
      });

      // Avoid zone markers (red)
      avoidZones.forEach((zone, idx) => {
        const avoidMarker = new window.google.maps.Marker({
          position: { lat: zone.lat, lng: zone.lng },
          map: mapInstanceRef.current!,
          title: zone.name,
          icon: createMarkerIcon(MARKER_COLORS.avoid),
          zIndex: 70 - idx,
        });
        avoidMarker.addListener('click', () => {
          if (infoWindowRef.current) {
            infoWindowRef.current.setContent(`
              <div style="padding: 8px; min-width: 200px;">
                <strong style="color: ${MARKER_COLORS.avoid};">AVOID THIS AREA</strong>
                <p style="margin: 4px 0; font-weight: 600;">${zone.name}</p>
                ${zone.reason ? `<p style="margin: 4px 0; font-size: 12px; color: #666;">${zone.reason}</p>` : ''}
                <p style="margin: 4px 0; font-size: 10px; color: #999;">Source: ${zone.source}</p>
              </div>
            `);
            infoWindowRef.current.open(mapInstanceRef.current!, avoidMarker);
          }
        });
        markers.push(avoidMarker);
        bounds.extend({ lat: zone.lat, lng: zone.lng });
      });

      // Fit map to show all markers
      if (markers.length > 1) {
        mapInstanceRef.current.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
      }
    }

    markersRef.current = markers;
  }, [mapReady, driverLat, driverLng, activeMission, clearMarkers]);

  // Update markers when active mission changes
  useEffect(() => {
    updateMarkers();
  }, [updateMarkers]);

  // Handle mission selection
  const handleMissionSelect = async (missionId: string) => {
    if (!missionId) {
      setActiveMission(null);
      return;
    }

    const selectedMission = missions.find(m => m.id === missionId);
    if (!selectedMission) return;

    setError(null);
    setIsLoadingStagingAreas(true);

    try {
      // Fetch pre-computed staging areas from ranking_candidates
      const response = await fetch(`/api/intelligence/staging-areas?snapshotId=${snapshotId}`);
      const data: StagingAreasResponse = await response.json();

      // Filter staging zones that are near this mission (within ~1km)
      const nearbyStaging = data.stagingZones?.filter(zone => {
        const distance = Math.sqrt(
          Math.pow(zone.lat - selectedMission.lat, 2) +
          Math.pow(zone.lng - selectedMission.lng, 2)
        );
        return distance < 0.01; // ~1km
      }) || [];

      // If no pre-computed staging areas, generate mathematical fallback
      const stagingZones: TacticalZone[] = nearbyStaging.length > 0
        ? nearbyStaging
        : generateFallbackZones(selectedMission).stagingZones;

      setActiveMission({
        mission: selectedMission,
        stagingZones,
        avoidZones: [], // Avoid zones come from AI analysis
        strategy: nearbyStaging.length > 0
          ? `${nearbyStaging.length} staging area(s) available from venue recommendations.`
          : 'No pre-computed staging data. Click "AI Tactical Plan" for smart recommendations.',
        isAiEnhanced: false,
      });

      // Center map on mission
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setCenter({ lat: selectedMission.lat, lng: selectedMission.lng });
        mapInstanceRef.current.setZoom(15);
      }
    } catch (err) {
      console.error('[TacticalMap] Error loading staging areas:', err);
      // Use fallback zones
      setActiveMission({
        mission: selectedMission,
        stagingZones: generateFallbackZones(selectedMission).stagingZones,
        avoidZones: [],
        strategy: 'Unable to load staging data. Using calculated positions.',
        isAiEnhanced: false,
      });
    } finally {
      setIsLoadingStagingAreas(false);
    }
  };

  // Handle AI Tactical Plan request
  const handleAiTacticalPlan = async () => {
    if (!activeMission) return;

    setIsAiAnalyzing(true);
    setError(null);

    try {
      const response = await fetch('/api/strategy/tactical-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshotId,
          mission: {
            type: activeMission.mission.type,
            name: activeMission.mission.name,
            lat: activeMission.mission.lat,
            lng: activeMission.mission.lng,
            venue: (activeMission.mission as EventMission).venue,
            eventTime: (activeMission.mission as EventMission).eventTime,
            airportCode: (activeMission.mission as AirportMission).code,
          },
          driverLat,
          driverLng,
          trafficContext,
        }),
      });

      const data: TacticalPlanResponse = await response.json();

      if (data.success) {
        setActiveMission(prev => prev ? {
          ...prev,
          stagingZones: data.stagingZones,
          avoidZones: data.avoidZones,
          strategy: data.strategy,
          isAiEnhanced: true,
        } : null);
      } else {
        setError('AI analysis failed. Using fallback recommendations.');
      }
    } catch (err) {
      console.error('[TacticalMap] AI tactical plan error:', err);
      setError('Unable to get AI tactical plan. Check your connection.');
    } finally {
      setIsAiAnalyzing(false);
    }
  };

  // Generate fallback zones when no data available
  const generateFallbackZones = (mission: Mission) => {
    const offset = 0.002; // ~200m
    return {
      stagingZones: [
        {
          id: `fallback-south-${mission.id}`,
          type: 'staging' as const,
          name: `${mission.name} - South`,
          lat: mission.lat - offset,
          lng: mission.lng,
          notes: 'Calculated staging position (200m south). Verify locally.',
          source: 'fallback' as const,
        },
        {
          id: `fallback-east-${mission.id}`,
          type: 'staging' as const,
          name: `${mission.name} - East`,
          lat: mission.lat,
          lng: mission.lng + offset,
          notes: 'Alternative position (200m east). Verify locally.',
          source: 'fallback' as const,
        },
      ],
      avoidZones: [] as TacticalZone[],
    };
  };

  // Navigation helper
  const openNavigation = (lat: number, lng: number, platform: 'google' | 'apple') => {
    const url = platform === 'apple'
      ? `maps://maps.apple.com/?daddr=${lat},${lng}`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, '_blank');
  };

  // No missions available
  if (missions.length === 0) {
    return (
      <Card className="shadow-lg border-gray-200">
        <CardContent className="p-6 text-center text-gray-500">
          <MapPin className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">No missions available</p>
          <p className="text-sm mt-1">Events and airports will appear here when available.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-lg border-gray-200 overflow-hidden">
      <CardHeader
        className="bg-gradient-to-r from-slate-50 to-gray-50 border-b border-gray-200 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-slate-600" />
            <div>
              <CardTitle className="text-lg">Tactical Staging Map</CardTitle>
              <span className="text-xs text-gray-500 font-normal">
                Events & Airports • {missions.length} targets available
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
              LIVE
            </Badge>
            {expanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-0">
          {/* Mission Selector */}
          <div className="p-4 bg-gray-50 border-b border-gray-200">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Select Mission Target
            </label>
            <select
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              onChange={(e) => handleMissionSelect(e.target.value)}
              disabled={isLoadingStagingAreas}
            >
              <option value="">-- Select Event or Airport --</option>
              {airports.length > 0 && (
                <optgroup label="Airports">
                  {airports.map((a) => (
                    <option key={`airport-${a.code}`} value={`airport-${a.code}`}>
                      {a.status === 'delays' ? '! ' : ''}{a.code} - {a.name || 'Airport'}
                    </option>
                  ))}
                </optgroup>
              )}
              {events.length > 0 && (
                <optgroup label="Events (Today)">
                  {events.map((e, idx) => (
                    <option key={`event-${e.name}-${idx}`} value={e.id}>
                      {e.impact === 'high' ? '! ' : ''}{e.venue || e.name}
                      {e.eventTime ? ` - ${e.eventTime}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Map Container */}
          <div className="relative">
            {/* Loading overlay */}
            {isLoadingStagingAreas && (
              <div className="absolute inset-0 bg-white/80 z-10 flex items-center justify-center">
                <div className="flex items-center gap-2 text-gray-600">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Loading staging areas...</span>
                </div>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="absolute top-4 left-4 right-4 z-10 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                <span className="text-sm text-red-700">{error}</span>
              </div>
            )}

            {/* Google Map */}
            <div
              ref={mapRef}
              className="w-full h-[400px] bg-gray-100"
              style={{ minHeight: '400px' }}
            >
              {!mapReady && (
                <div className="w-full h-full flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                </div>
              )}
            </div>

            {/* Bottom HUD - Strategy & Actions */}
            {activeMission && (
              <div className="absolute bottom-4 left-4 right-4">
                <div className="bg-white/95 backdrop-blur border border-gray-200 rounded-lg shadow-lg p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="font-bold text-gray-900">{activeMission.mission.name}</h3>
                      {activeMission.mission.subtitle && (
                        <p className="text-xs text-gray-500">{activeMission.mission.subtitle}</p>
                      )}
                    </div>

                    <div className="flex gap-2">
                      {/* AI Tactical Plan Button */}
                      <Button
                        size="sm"
                        variant="outline"
                        className={`h-8 text-xs ${activeMission.isAiEnhanced
                          ? 'bg-purple-50 border-purple-300 text-purple-700'
                          : 'border-gray-300'
                        }`}
                        onClick={handleAiTacticalPlan}
                        disabled={isAiAnalyzing}
                      >
                        {isAiAnalyzing ? (
                          <>
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            Analyzing...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3 h-3 mr-1" />
                            {activeMission.isAiEnhanced ? 'AI Enhanced' : 'AI Tactical Plan'}
                          </>
                        )}
                      </Button>

                      {/* Navigate Button */}
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 h-8 text-xs text-white"
                        onClick={() => openNavigation(activeMission.mission.lat, activeMission.mission.lng, 'google')}
                      >
                        <Navigation className="w-3 h-3 mr-1" />
                        GO
                      </Button>
                    </div>
                  </div>

                  {/* Strategy Text */}
                  {activeMission.strategy && (
                    <div className={`text-xs p-2 rounded border ${
                      activeMission.isAiEnhanced
                        ? 'bg-purple-50 border-purple-200 text-purple-800'
                        : 'bg-gray-50 border-gray-200 text-gray-700'
                    }`}>
                      <strong className="block mb-1 opacity-75">
                        {activeMission.isAiEnhanced ? 'AI TACTICAL ANALYSIS:' : 'STAGING INFO:'}
                      </strong>
                      {activeMission.strategy}
                    </div>
                  )}

                  {/* Zone Summary */}
                  <div className="flex gap-4 mt-3 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      {activeMission.stagingZones.length} staging zone(s)
                    </span>
                    {activeMission.avoidZones.length > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-red-500"></span>
                        {activeMission.avoidZones.length} avoid zone(s)
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Map Legend */}
          <div className="p-3 bg-gray-50 border-t border-gray-200 flex flex-wrap gap-4 text-xs text-gray-600">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: MARKER_COLORS.driver }}></span>
              You
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: MARKER_COLORS.mission }}></span>
              Target
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: MARKER_COLORS.staging }}></span>
              Stage Here
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: MARKER_COLORS.avoid }}></span>
              Avoid
            </span>
            <span className="flex items-center gap-1 ml-auto">
              <span className="text-gray-400">Traffic layer enabled</span>
            </span>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
