/**
 * StrategyMap - The single map surface for the app.
 *
 * Renamed from MapTab as of 2026-04-26 PHASE B. Strategy is now the only
 * consumer; the standalone /co-pilot/map route + bottom-nav Map tab were
 * deleted in this phase. Future map-related capabilities (zone overlays,
 * market boundary, TomTom incidents, mission/staging mode) all land here
 * as additional layers in subsequent phases.
 *
 * Renders driver pin, SmartBlocks venue markers (color-coded by Grade A/B/C),
 * premium $$+ bar markers (green/orange/red by open status), today's event
 * markers, and Google's live traffic overlay. InfoWindows expose distance,
 * drive time, earnings, and Google/Apple navigation links.
 *
 * 2026-04-26 PHASE A foundations preserved here:
 *   - Singleton google-maps-loader (never removes the script tag — root-cause
 *     fix for the historical removeChild bug).
 *   - google.maps.marker.AdvancedMarkerElement (SVG teardrop pins in DOM
 *     instead of deprecated google.maps.Marker + CDN PNG icons).
 *   - escapeHtml on every InfoWindow.setContent() interpolation.
 *   - Layer-aware fitBounds (driver, venues, events, bars all participate).
 *
 * 2026-04-26 PHASE B bug fixes:
 *   - tilesTimeoutRef so unmount cleanup actually clears the timer (the
 *     prior version leaked under React StrictMode dev double-invocation).
 *   - tilesloaded diagnostic message rewritten — Melody verified end-to-end
 *     that the Cloud Console map style was published, associated, and
 *     covered all zooms; the "needs zoom-level coverage" message was
 *     biasing diagnosis toward a non-issue. New message lists the actual
 *     candidate causes (zero-dimension container, missing mapId, WebGL
 *     init failure) so future debugging starts in the right place.
 *   - Container dimension check at construct time. Most common React +
 *     Maps JS bug: parent layout hasn't computed when google.maps.Map
 *     fires; viewport is 0×0; zero tile requests; tilesloaded never
 *     fires. We now log the bounding rect on init and warn if either
 *     dimension is zero.
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Loader, AlertTriangle } from 'lucide-react';
import { filterTodayEvents, formatEventDate, formatEventTimeRange } from '@/utils/co-pilot-helpers';
import { loadGoogleMaps, getMapId } from '@/lib/maps/google-maps-loader';
import { escapeHtml } from '@/lib/maps/escape-html';
// 2026-04-27 (Commit 4 of CLEAR_CONSOLE_WORKFLOW spec): gate noisy diagnostic
// console.log lines behind debug flags. Default off.
import { DEBUG_MAP_ENABLED, DEBUG_VENUES_ENABLED } from '@/constants/featureFlags';

// Google Maps type declarations (loaded dynamically; not shipped with @types).
// 2026-04-26 PHASE A: replaced Marker class with AdvancedMarkerElement under
// google.maps.marker namespace. Kept inline declaration approach to avoid
// pulling @types/google.maps into Phase A (separate concern).
declare global {
  interface Window {
    google: typeof google;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace google.maps {
  interface MapsEventListener {
    remove(): void;
  }
  class Map {
    constructor(element: HTMLElement, options: MapOptions);
    fitBounds(
      bounds: LatLngBounds,
      padding?: number | { top?: number; right?: number; bottom?: number; left?: number; padding?: number }
    ): void;
  }
  class InfoWindow {
    constructor();
    setContent(content: string): void;
    open(map: Map, anchor?: unknown): void;
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
    mapId?: string;
    mapTypeControl?: boolean;
    fullscreenControl?: boolean;
    zoomControl?: boolean;
    streetViewControl?: boolean;
    minZoom?: number;
    maxZoom?: number;
  }

  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace marker {
    interface AdvancedMarkerElementOptions {
      position?: { lat: number; lng: number };
      map?: Map | null;
      title?: string;
      content?: HTMLElement;
      zIndex?: number;
      gmpClickable?: boolean;
    }
    class AdvancedMarkerElement {
      constructor(options?: AdvancedMarkerElementOptions);
      position: { lat: number; lng: number } | null;
      map: Map | null;
      title: string;
      content: HTMLElement | null;
      zIndex: number | null;
      gmpClickable: boolean;
      addListener(event: 'gmp-click', handler: (event: { domEvent: Event }) => void): MapsEventListener;
    }
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
  event_end_date?: string;
  event_start_time?: string;
  event_end_time?: string;
  latitude?: number;
  longitude?: number;
  impact?: 'high' | 'medium' | 'low';
  subtype?: string;
}

// Bar type for map markers (green=open, orange=closed but worth it, red=closing soon)
// Only shows $$ and above (expenseRank >= 2)
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
  closedGoAnyway?: boolean;
  closedReason?: string | null;
}

// 2026-04-26 PHASE F: TomTom traffic-incident shape (subset of useTrafficIncidents
// shape — kept inline to avoid a hooks→types coupling in this component file).
interface MapIncident {
  description: string;
  severity: 'high' | 'medium' | 'low';
  category: string;            // 'Accident' | 'Jam' | 'Road Closed' | 'Lane Closed' | 'Road Works' | etc.
  road: string;
  location: string;
  isHighway: boolean;
  delayMinutes: number;
  lengthMiles: number | null;
  distanceFromDriver: number | null;
  incidentLat: number;
  incidentLon: number;
}

interface StrategyMapProps {
  driverLat: number;
  driverLng: number;
  venues: Venue[];
  bars?: MapBar[];
  events?: MapEvent[];
  incidents?: MapIncident[];   // PHASE F: live TomTom incidents
  snapshotId?: string;
  isLoading?: boolean;
}

// Marker palette — Tailwind 600-shade hex codes; matches the legend swatches.
const MARKER_COLORS = {
  driver: '#1d4ed8',     // blue-700 (slightly darker for prominence)
  gradeA: '#dc2626',     // red-600
  gradeB: '#ea580c',     // orange-600
  gradeC: '#eab308',     // yellow-500
  event: '#9333ea',      // purple-600
  barOpen: '#16a34a',    // green-600
  barClosingSoon: '#dc2626', // red-600
  barClosedGoAnyway: '#ea580c', // orange-600
  // 2026-04-30: incidents shifted to rose family (was red-700/amber-600/amber-500).
  // Reason: red-700 was visually adjacent to gradeA red-600 venues and amber-600
  // matched gradeB orange-600 — same warm hues, hard to distinguish on a busy map.
  // Rose hues read as "danger" (close enough to red) while staying clearly distinct
  // from venue grading. Triangle glyph still does the heavy lifting; color is the
  // secondary signal.
  incidentHigh: '#be185d',     // rose-700 (severity high)
  incidentMedium: '#e11d48',   // rose-600 (severity medium)
  incidentLow: '#f43f5e',      // rose-500 (severity low)
} as const;

// PHASE F: Triangle warning glyph for traffic incidents — visually distinct
// from the teardrop venue/event/bar pins so drivers can tell at a glance
// "this is a hazard, not a destination".
function makeIncidentContent(color: string, size: number = 26): HTMLDivElement {
  const div = document.createElement('div');
  div.style.cssText = `width: ${size}px; height: ${size}px; cursor: pointer; transform: translate(-50%, -50%);`;
  div.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
    <path d="M12 2 L22 21 L2 21 Z" fill="${color}" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
    <text x="12" y="17" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-size="13" font-weight="700" fill="white">!</text>
  </svg>`;
  return div;
}

// Build an SVG teardrop pin as an HTMLElement for AdvancedMarkerElement.content.
// Pattern lifted from ConciergeMap so all maps in the app render visually consistent pins.
function makePinContent(color: string, size: number = 32): HTMLDivElement {
  const div = document.createElement('div');
  div.style.cssText = `width: ${size}px; height: ${Math.round(size * 1.4)}px; cursor: pointer; transform: translate(-50%, -100%);`;
  div.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 40" width="100%" height="100%" aria-hidden="true">
    <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.268 21.732 0 14 0z" fill="${color}" stroke="white" stroke-width="2"/>
    <circle cx="14" cy="14" r="6" fill="white"/>
  </svg>`;
  return div;
}

// PHASE F: visibility persistence key for layer toggles (currently just incidents,
// future phases will add zone subtypes). Reads + writes happen inside the toggle
// hook below so consumers don't have to know about localStorage.
const LAYER_VISIBILITY_KEY = 'vecto:map-layers';
type LayerVisibility = { incidents: boolean };
const DEFAULT_LAYER_VISIBILITY: LayerVisibility = { incidents: false }; // off by default to keep map quiet

function readLayerVisibility(): LayerVisibility {
  if (typeof window === 'undefined') return DEFAULT_LAYER_VISIBILITY;
  try {
    const stored = window.localStorage.getItem(LAYER_VISIBILITY_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_LAYER_VISIBILITY, ...parsed };
    }
  } catch { /* ignore */ }
  return DEFAULT_LAYER_VISIBILITY;
}

const StrategyMap: React.FC<StrategyMapProps> = ({
  driverLat,
  driverLng,
  venues,
  bars = [],
  events = [],
  incidents = [],
  snapshotId: _snapshotId,
  isLoading = false
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const barMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const eventMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const incidentMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  // PHASE F: per-layer visibility state, persisted to localStorage so a driver
  // who hides incidents stays hidden across reloads.
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>(readLayerVisibility);
  useEffect(() => {
    try { window.localStorage.setItem(LAYER_VISIBILITY_KEY, JSON.stringify(layerVisibility)); }
    catch { /* ignore */ }
  }, [layerVisibility]);

  // PHASE F: dedup ref for incidents — same pattern as lastEventKeyRef.
  const lastIncidentKeyRef = useRef<string>('');
  // Phase B fix: store the diagnostic warning timeout so unmount cleanup can
  // clear it. Without this, StrictMode dev double-invocation (and any genuine
  // unmount before tiles arrive) leaked the timer, producing duplicate
  // "Tiles still not loaded" warnings that biased diagnosis.
  const tilesTimeoutRef = useRef<number | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // 2026-04-04: Track last processed event data to prevent infinite re-render loop.
  // Previously, any parent re-render created a new events array reference,
  // triggering useMemo → useEffect → marker clear/add cycle every ~500ms.
  const lastEventKeyRef = useRef<string>('');

  // Filter events to only show TODAY's events with valid start/end times
  const todayEvents = useMemo(() => filterTodayEvents(events), [events]);

  // Initialize Google Map via singleton loader (Phase A.1/A.3/A.4).
  useEffect(() => {
    if (!mapRef.current || mapReady) return;

    let cancelled = false;
    loadGoogleMaps({ libraries: ['maps', 'marker', 'geometry'] })
      .then((googleApi) => {
        if (cancelled || !mapRef.current) return;

        // PHASE B: container-dimension check at construct time. Most common
        // React + Maps JS bug: the parent layout hasn't computed its size
        // when google.maps.Map fires; the map gets a 0×0 viewport, makes
        // zero tile requests, and tilesloaded never fires (no tiles to load
        // means nothing to "load"). If we see zero here we know to look at
        // the parent layout, not at Google's services.
        const containerRect = mapRef.current.getBoundingClientRect();
        if (containerRect.width === 0 || containerRect.height === 0) {
          console.warn(
            `[StrategyMap] Map container is ${containerRect.width}×${containerRect.height} at construct time — `
            + 'tiles will likely never load. Parent layout has not computed its size yet. '
            + 'Verify the parent has explicit height (not flex:1 alone).'
          );
        }

        const mapOptions: google.maps.MapOptions = {
          center: { lat: driverLat, lng: driverLng },
          zoom: 11,
          mapTypeControl: true,
          fullscreenControl: true,
          zoomControl: false,
          streetViewControl: false,
          minZoom: 10,
          maxZoom: 18,
        };
        const mapId = getMapId();
        if (mapId) mapOptions.mapId = mapId;

        const map = new googleApi.maps.Map(mapRef.current, mapOptions);

        const trafficLayer = new googleApi.maps.TrafficLayer();
        trafficLayer.setMap(map);

        mapInstanceRef.current = map;
        infoWindowRef.current = new googleApi.maps.InfoWindow();
        setMapReady(true);

        // PHASE B: tilesloaded diagnostic. Stored in a ref so the unmount
        // cleanup can clear it (the prior version leaked under StrictMode
        // dev double-invocation). Diagnostic message rewritten to list the
        // real candidate causes — Cloud Console hypotheses were exonerated
        // end-to-end on 2026-04-26 (style published, mapId associated, all
        // zooms covered, API key authorized). Future "tiles not loaded"
        // signals should be triaged from this list, not the cloud side.
        tilesTimeoutRef.current = window.setTimeout(() => {
          console.warn(
            `[StrategyMap] tilesloaded did not fire within 5s. Container: ${containerRect.width}×${containerRect.height}, mapId: ${mapId || '<none>'}. `
            + 'Likely causes: (a) container has zero dimensions at construct (see container size above; React + Maps JS classic), '
            + '(b) WebGL context creation failed (run `!!document.createElement("canvas").getContext("webgl2")` in console), '
            + '(c) mapId not in mapOptions (raster fallback would still tile-request, so this is least likely if (a)+(b) check out), '
            + '(d) Maps JS bundle blocked by referrer restriction (DevTools Network → look for vt? and AuthenticationService.Authenticate).'
          );
          tilesTimeoutRef.current = null;
        }, 5000);
        (googleApi.maps as unknown as { event: { addListenerOnce: (target: object, event: string, handler: () => void) => void } })
          .event.addListenerOnce(map as unknown as object, 'tilesloaded', () => {
            if (tilesTimeoutRef.current !== null) {
              window.clearTimeout(tilesTimeoutRef.current);
              tilesTimeoutRef.current = null;
            }
            if (DEBUG_MAP_ENABLED) console.log(`[StrategyMap] Tiles loaded successfully (mapId: ${mapId || '<none>'})`);
          });

        if (DEBUG_MAP_ENABLED) console.log(`[StrategyMap] Google Map initialized — container ${containerRect.width}×${containerRect.height}, mapId ${mapId || '<none>'}`);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[StrategyMap] Failed to initialize Google Maps:', err);
      });

    return () => {
      // PHASE B: cancel any in-flight init, clear the tile-load timer so
      // it doesn't fire after unmount, detach all markers from the map.
      // Singleton loader owns the <script> tag — do NOT remove it here.
      // PHASE F: incident markers added to the cleanup sweep.
      cancelled = true;
      if (tilesTimeoutRef.current !== null) {
        window.clearTimeout(tilesTimeoutRef.current);
        tilesTimeoutRef.current = null;
      }
      markersRef.current.forEach((m) => { m.map = null; });
      barMarkersRef.current.forEach((m) => { m.map = null; });
      eventMarkersRef.current.forEach((m) => { m.map = null; });
      incidentMarkersRef.current.forEach((m) => { m.map = null; });
      infoWindowRef.current?.close();
    };
  }, [driverLat, driverLng, mapReady]);

  // Add driver location + venue markers
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !window.google) return;

    const map = mapInstanceRef.current;
    const { AdvancedMarkerElement } = window.google.maps.marker;

    // Clear existing driver/venue markers
    markersRef.current.forEach((m) => { m.map = null; });
    markersRef.current = [];

    // Driver marker (blue, larger)
    const driverMarker = new AdvancedMarkerElement({
      position: { lat: driverLat, lng: driverLng },
      map,
      title: 'Your Location',
      content: makePinContent(MARKER_COLORS.driver, 40),
      zIndex: 1000,
      gmpClickable: false,
    });
    markersRef.current.push(driverMarker);

    // Venue markers (Grade A/B/C colors)
    venues.forEach((venue, index) => {
      const isTopVenue = (venue.rank || 999) <= 3;
      const color =
        venue.value_grade === 'A' ? MARKER_COLORS.gradeA :
        venue.value_grade === 'B' ? MARKER_COLORS.gradeB :
        MARKER_COLORS.gradeC;

      const marker = new AdvancedMarkerElement({
        position: { lat: venue.lat, lng: venue.lng },
        map,
        title: venue.name,
        content: makePinContent(color, 32),
        zIndex: isTopVenue ? 999 : 500,
      });

      marker.addListener('gmp-click', () => {
        infoWindowRef.current?.close();

        const getGradeBadgeStyle = (grade?: string) => {
          switch (grade?.toUpperCase()) {
            case 'A': return 'background: #dcfce7; color: #166534; border: 1px solid #86efac;';
            case 'B': return 'background: #fef3c7; color: #92400e; border: 1px solid #fcd34d;';
            default: return 'background: #f3f4f6; color: #6b7280; border: 1px solid #d1d5db;';
          }
        };

        const safeName = escapeHtml(venue.name);
        const safeGrade = venue.value_grade ? escapeHtml(venue.value_grade) : '';

        const content = `
          <div style="padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 260px;">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 10px;">
              <div style="font-weight: 600; font-size: 14px; color: #1f2937; line-height: 1.3;">
                ${safeName}
              </div>
              ${safeGrade ? `
                <span style="padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; ${getGradeBadgeStyle(venue.value_grade)}">
                  Grade ${safeGrade}
                </span>
              ` : ''}
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; padding: 10px; background: #f8fafc; border-radius: 6px;">
              <div>
                <span style="color: #6b7280; display: block; font-size: 10px; text-transform: uppercase; margin-bottom: 2px;">Distance</span>
                <span style="font-weight: 600; color: #1f2937; font-size: 14px;">${venue.distance_miles?.toFixed(1) ?? 'N/A'} mi</span>
              </div>
              <div>
                <span style="color: #6b7280; display: block; font-size: 10px; text-transform: uppercase; margin-bottom: 2px;">Drive Time</span>
                <span style="font-weight: 600; color: #1f2937; font-size: 14px;">${venue.drive_time_min ?? 'N/A'} min</span>
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
                 target="_blank" rel="noopener noreferrer"
                 style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px; background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; border-radius: 6px; text-decoration: none; font-size: 12px; font-weight: 500; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.3);">
                🧭 Navigate
              </a>
              <a href="https://maps.apple.com/?daddr=${venue.lat},${venue.lng}&dirflg=d"
                 target="_blank" rel="noopener noreferrer"
                 style="display: flex; align-items: center; justify-content: center; gap: 4px; padding: 10px 12px; background: #f1f5f9; color: #475569; border-radius: 6px; text-decoration: none; font-size: 12px; font-weight: 500; border: 1px solid #e2e8f0;">
                🍎
              </a>
            </div>
          </div>
        `;

        infoWindowRef.current?.setContent(content);
        infoWindowRef.current?.open(map, marker);
      });

      markersRef.current.push(marker);
    });

    // Layer-aware fitBounds: include driver, venues, events, AND bars (Phase A.6).
    // Previously bars were excluded, so a bar outside the venue/event envelope
    // wouldn't influence the initial viewport.
    const allMarkers = [
      ...markersRef.current,
      ...eventMarkersRef.current,
      ...barMarkersRef.current,
    ];
    if (allMarkers.length > 0) {
      const bounds = new window.google.maps.LatLngBounds();
      allMarkers.forEach((m) => {
        if (m.position) bounds.extend(m.position);
      });
      map.fitBounds(bounds, { padding: 60 });
    }
  }, [mapReady, venues, driverLat, driverLng]);

  // Add event markers (TODAY'S EVENTS ONLY) — purple pins
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !window.google) return;

    // 2026-04-04: Dedup check — skip if event data hasn't actually changed.
    // Prevents clearing and re-adding identical markers on every parent re-render.
    const eventKey = todayEvents.map((e) => `${e.title}|${e.latitude}|${e.longitude}`).join(';');
    if (eventKey === lastEventKeyRef.current) return;
    lastEventKeyRef.current = eventKey;

    const map = mapInstanceRef.current;
    const { AdvancedMarkerElement } = window.google.maps.marker;

    eventMarkersRef.current.forEach((m) => { m.map = null; });
    eventMarkersRef.current = [];

    const eventsWithCoords = todayEvents.filter((e) => e.latitude && e.longitude);

    eventsWithCoords.forEach((event) => {
      const marker = new AdvancedMarkerElement({
        position: { lat: event.latitude!, lng: event.longitude! },
        map,
        title: event.title,
        content: makePinContent(MARKER_COLORS.event, 28),
        zIndex: 800,
      });

      const dateDisplay = formatEventDate(event.event_start_date);
      const timeDisplay = formatEventTimeRange(event.event_start_time, event.event_end_time);

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

      const getImpactStyle = (impact?: string) => {
        switch (impact) {
          case 'high': return 'background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5;';
          case 'medium': return 'background: #fef3c7; color: #92400e; border: 1px solid #fcd34d;';
          default: return 'background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7;';
        }
      };

      marker.addListener('gmp-click', () => {
        infoWindowRef.current?.close();

        const safeTitle = escapeHtml(event.title);
        const safeVenue = event.venue ? escapeHtml(event.venue) : '';
        const safeAddress = event.address ? escapeHtml(event.address) : '';
        const safeImpact = event.impact ? escapeHtml(event.impact.toUpperCase()) : '';
        const safeDateDisplay = escapeHtml(dateDisplay);
        const safeTimeDisplay = timeDisplay ? escapeHtml(timeDisplay) : '';

        const content = `
          <div style="padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 280px;">
            <div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
              <span style="font-size: 20px;">${getCategoryIcon(event.subtype)}</span>
              <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 14px; color: #1f2937; line-height: 1.3;">
                  ${safeTitle}
                </div>
                ${safeVenue ? `<div style="font-size: 12px; color: #6b7280; margin-top: 2px;">@ ${safeVenue}</div>` : ''}
              </div>
            </div>

            <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; padding: 10px; background: linear-gradient(135deg, #f3e8ff, #e0f2fe); border-radius: 8px;">
              <div style="display: flex; align-items: center; gap: 4px;">
                <span style="font-size: 14px;">📅</span>
                <span style="font-weight: 600; color: ${dateDisplay === 'Today' ? '#059669' : '#7c3aed'}; font-size: 13px;">${safeDateDisplay}</span>
              </div>
              ${safeTimeDisplay ? `
                <div style="display: flex; align-items: center; gap: 4px;">
                  <span style="font-size: 14px;">🕐</span>
                  <span style="font-weight: 600; color: #7c3aed; font-size: 13px;">${safeTimeDisplay}</span>
                </div>
              ` : ''}
            </div>

            ${safeAddress ? `
              <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">
                📍 ${safeAddress}
              </div>
            ` : ''}

            ${safeImpact ? `
              <div style="display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; ${getImpactStyle(event.impact)}">
                ${safeImpact} IMPACT
              </div>
            ` : ''}

            <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #e5e7eb; display: flex; gap: 8px;">
              <a href="https://maps.google.com/maps?daddr=${event.latitude},${event.longitude}&directionsmode=driving"
                 target="_blank" rel="noopener noreferrer"
                 style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; background: #8b5cf6; color: white; border-radius: 6px; text-decoration: none; font-size: 12px; font-weight: 500;">
                🧭 Navigate
              </a>
              <a href="https://maps.apple.com/?daddr=${event.latitude},${event.longitude}&dirflg=d"
                 target="_blank" rel="noopener noreferrer"
                 style="display: flex; align-items: center; justify-content: center; padding: 8px 12px; background: #f3e8ff; color: #7c3aed; border-radius: 6px; text-decoration: none; font-size: 12px; font-weight: 500; border: 1px solid #ddd6fe;">
                🍎
              </a>
            </div>
          </div>
        `;

        infoWindowRef.current?.setContent(content);
        infoWindowRef.current?.open(map, marker);
      });

      eventMarkersRef.current.push(marker);
    });

    if (eventsWithCoords.length > 0) {
      if (DEBUG_VENUES_ENABLED) console.log(`[StrategyMap] Added ${eventsWithCoords.length} event markers to map`);
    }
  }, [mapReady, todayEvents]);

  // Add bar markers ($$+ venues; green=open, orange=closed-go-anyway, red=closing-soon)
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !window.google) return;

    const map = mapInstanceRef.current;
    const { AdvancedMarkerElement } = window.google.maps.marker;

    barMarkersRef.current.forEach((m) => { m.map = null; });
    barMarkersRef.current = [];

    bars.forEach((bar) => {
      const isClosedGoAnyway = bar.closedGoAnyway === true;
      const isClosingSoon = bar.closingSoon;
      const color =
        isClosedGoAnyway ? MARKER_COLORS.barClosedGoAnyway :
        isClosingSoon ? MARKER_COLORS.barClosingSoon :
        MARKER_COLORS.barOpen;
      const statusLabel = isClosedGoAnyway
        ? (bar.closedReason || 'Closed (Worth It)')
        : isClosingSoon
        ? (bar.minutesUntilClose ? `Closing in ${bar.minutesUntilClose}min` : 'Closing soon')
        : 'Open';

      const marker = new AdvancedMarkerElement({
        position: { lat: bar.lat, lng: bar.lng },
        map,
        title: `${bar.name} (${bar.expenseLevel})`,
        content: makePinContent(color, 28),
        zIndex: 600,
      });

      const getTypeIcon = (type: string) => {
        switch (type) {
          case 'nightclub': return '🎉';
          case 'wine_bar': return '🍷';
          case 'lounge': return '🍸';
          default: return '🍺';
        }
      };

      marker.addListener('gmp-click', () => {
        infoWindowRef.current?.close();

        const statusStyle = isClosedGoAnyway
          ? 'background: #fff7ed; color: #c2410c; border: 1px solid #fdba74;'
          : isClosingSoon
          ? 'background: #fef2f2; color: #991b1b; border: 1px solid #fca5a5;'
          : 'background: #dcfce7; color: #166534; border: 1px solid #86efac;';

        const safeName = escapeHtml(bar.name);
        const safeStatusLabel = escapeHtml(statusLabel);
        const safeExpense = escapeHtml(bar.expenseLevel);
        const safeAddress = escapeHtml(bar.address);

        const content = `
          <div style="padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 260px;">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 8px;">
              <div style="font-weight: 600; font-size: 14px; color: #1f2937; line-height: 1.3;">
                ${getTypeIcon(bar.type)} ${safeName}
              </div>
              <span style="padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; ${statusStyle}">
                ${safeStatusLabel}
              </span>
            </div>

            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
              <span style="padding: 2px 8px; background: #fef3c7; color: #92400e; border-radius: 4px; font-size: 11px; font-weight: 600;">
                ${safeExpense}
              </span>
              ${bar.rating ? `
                <span style="padding: 2px 8px; background: #e0f2fe; color: #0369a1; border-radius: 4px; font-size: 11px;">
                  ⭐ ${bar.rating.toFixed(1)}
                </span>
              ` : ''}
            </div>

            <div style="font-size: 12px; color: #6b7280; margin-bottom: 10px;">
              📍 ${safeAddress}
            </div>

            <div style="display: flex; gap: 8px;">
              <a href="https://maps.google.com/maps?daddr=${bar.lat},${bar.lng}&directionsmode=driving"
                 target="_blank" rel="noopener noreferrer"
                 style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; background: linear-gradient(135deg, #10b981, #059669); color: white; border-radius: 6px; text-decoration: none; font-size: 12px; font-weight: 500;">
                🧭 Navigate
              </a>
              <a href="https://maps.apple.com/?daddr=${bar.lat},${bar.lng}&dirflg=d"
                 target="_blank" rel="noopener noreferrer"
                 style="display: flex; align-items: center; justify-content: center; padding: 8px 12px; background: #f1f5f9; color: #475569; border-radius: 6px; text-decoration: none; font-size: 12px; font-weight: 500; border: 1px solid #e2e8f0;">
                🍎
              </a>
            </div>
          </div>
        `;

        infoWindowRef.current?.setContent(content);
        infoWindowRef.current?.open(map, marker);
      });

      barMarkersRef.current.push(marker);
    });

    if (DEBUG_VENUES_ENABLED) console.log(`[StrategyMap] Added ${bars.length} bar markers ($$+): ${bars.filter((b) => !b.closingSoon).length} open, ${bars.filter((b) => b.closingSoon).length} closing soon`);
  }, [mapReady, bars]);

  // PHASE F: Add traffic incident markers (red/amber triangle warning glyphs).
  // Visibility gated by layerVisibility.incidents (defaults OFF; persisted to
  // localStorage). When toggled off, all incident markers are detached and the
  // dedup key is reset so the next toggle-on re-creates them.
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !window.google) return;
    const map = mapInstanceRef.current;
    const { AdvancedMarkerElement } = window.google.maps.marker;

    // If layer toggled off, detach all + reset dedup so next toggle-on rebuilds.
    if (!layerVisibility.incidents) {
      if (incidentMarkersRef.current.length > 0) {
        incidentMarkersRef.current.forEach((m) => { m.map = null; });
        incidentMarkersRef.current = [];
        lastIncidentKeyRef.current = '';
      }
      return;
    }

    // Per-layer dedup — same pattern as lastEventKeyRef. Skip if data unchanged
    // to avoid thrashing markers on every parent re-render.
    const incidentKey = incidents
      .map((i) => `${i.category}|${i.incidentLat}|${i.incidentLon}|${i.severity}|${i.delayMinutes}`)
      .join(';');
    if (incidentKey === lastIncidentKeyRef.current) return;
    lastIncidentKeyRef.current = incidentKey;

    incidentMarkersRef.current.forEach((m) => { m.map = null; });
    incidentMarkersRef.current = [];

    incidents.forEach((inc) => {
      const color =
        inc.severity === 'high' ? MARKER_COLORS.incidentHigh :
        inc.severity === 'medium' ? MARKER_COLORS.incidentMedium :
        MARKER_COLORS.incidentLow;

      const marker = new AdvancedMarkerElement({
        position: { lat: inc.incidentLat, lng: inc.incidentLon },
        map,
        title: `${inc.category}${inc.road ? ` on ${inc.road}` : ''}`,
        content: makeIncidentContent(color, 26),
        zIndex: 700, // above bars (600), below events (800)
      });

      const getCategoryIcon = (category: string) => {
        const c = category.toLowerCase();
        if (c.includes('accident')) return '💥';
        if (c.includes('road closed') || c.includes('closure')) return '🚧';
        if (c.includes('lane closed')) return '🚧';
        if (c.includes('jam')) return '🐢';
        if (c.includes('flooding')) return '🌊';
        if (c.includes('construction') || c.includes('road works')) return '🚜';
        if (c.includes('dangerous')) return '⚠️';
        return '⚠️';
      };

      const severityStyle =
        inc.severity === 'high' ? 'background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5;' :
        inc.severity === 'medium' ? 'background: #fef3c7; color: #92400e; border: 1px solid #fcd34d;' :
        'background: #fef9c3; color: #854d0e; border: 1px solid #fde68a;';

      marker.addListener('gmp-click', () => {
        infoWindowRef.current?.close();
        const safeCategory = escapeHtml(inc.category);
        const safeRoad = inc.road ? escapeHtml(inc.road) : '';
        const safeLocation = inc.location ? escapeHtml(inc.location) : '';
        const safeDescription = inc.description ? escapeHtml(inc.description) : '';

        const content = `
          <div style="padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 280px;">
            <div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
              <span style="font-size: 20px;">${getCategoryIcon(inc.category)}</span>
              <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 14px; color: #1f2937; line-height: 1.3;">
                  ${safeCategory}${safeRoad ? ` on ${safeRoad}` : ''}
                </div>
                ${safeLocation ? `<div style="font-size: 12px; color: #6b7280; margin-top: 2px;">${safeLocation}</div>` : ''}
              </div>
              <span style="padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; ${severityStyle}">
                ${escapeHtml(inc.severity.toUpperCase())}
              </span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; padding: 8px; background: #fffbeb; border-radius: 6px; border: 1px solid #fde68a;">
              ${inc.delayMinutes > 0 ? `
                <div>
                  <span style="color: #6b7280; display: block; font-size: 10px; text-transform: uppercase;">Delay</span>
                  <span style="font-weight: 600; color: #92400e; font-size: 13px;">${inc.delayMinutes} min</span>
                </div>
              ` : ''}
              ${inc.distanceFromDriver != null ? `
                <div>
                  <span style="color: #6b7280; display: block; font-size: 10px; text-transform: uppercase;">From You</span>
                  <span style="font-weight: 600; color: #92400e; font-size: 13px;">${inc.distanceFromDriver.toFixed(1)} mi</span>
                </div>
              ` : ''}
            </div>

            ${inc.isHighway ? `
              <div style="display: inline-block; padding: 2px 8px; background: #dbeafe; color: #1e40af; border-radius: 4px; font-size: 11px; font-weight: 500; margin-bottom: 8px;">
                HIGHWAY
              </div>
            ` : ''}

            ${safeDescription && safeDescription !== safeCategory ? `
              <div style="font-size: 12px; color: #4b5563; margin-top: 4px;">
                ${safeDescription}
              </div>
            ` : ''}
          </div>
        `;

        infoWindowRef.current?.setContent(content);
        infoWindowRef.current?.open(map, marker);
      });

      incidentMarkersRef.current.push(marker);
    });

    console.log(`[StrategyMap] Added ${incidents.length} incident markers (${incidents.filter((i) => i.severity === 'high').length} high severity)`);
  }, [mapReady, incidents, layerVisibility.incidents]);

  return (
    <div className="mb-24" data-testid="map-tab">
      {isLoading && (
        <div className="flex items-center justify-center py-12 text-gray-500">
          <Loader className="w-5 h-5 animate-spin mr-2" />
          Loading map...
        </div>
      )}

      {/* PHASE F: map container wrapped in a positioned parent so layer-toggle
          chips can float top-right without affecting map sizing. */}
      <div className="relative">
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

        {/* Layer toggle chips (top-right). Currently just incidents; future
            phases will add zone subtypes here. */}
        <div className="absolute top-3 right-3 flex gap-2 z-10" data-testid="map-layer-toggles">
          <button
            type="button"
            onClick={() => setLayerVisibility((prev) => ({ ...prev, incidents: !prev.incidents }))}
            aria-pressed={layerVisibility.incidents}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shadow-md border transition-colors backdrop-blur ${
              layerVisibility.incidents
                ? 'bg-rose-600 text-white border-rose-700'
                : 'bg-white/90 text-gray-700 border-gray-200 hover:bg-white'
            }`}
            data-testid="toggle-incidents"
            title={
              layerVisibility.incidents
                ? `Hide traffic incidents${incidents.length ? ` (${incidents.length} active)` : ''}`
                : `Show traffic incidents${incidents.length ? ` (${incidents.length} active)` : ''}`
            }
          >
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Incidents{incidents.length > 0 ? ` · ${incidents.length}` : ''}</span>
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <h3 className="font-semibold text-gray-800 mb-3">Map Legend</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          {/* Strategy Venues Column */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Strategy Venues</div>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-blue-700 border border-white shadow" />
              <span className="text-gray-700">Your location</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-red-600 border border-white shadow" />
              <span className="text-gray-700">Top venue (Grade A)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-orange-600 border border-white shadow" />
              <span className="text-gray-700">Good venue (Grade B)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-yellow-500 border border-white shadow" />
              <span className="text-gray-700">Standard venue (Grade C+)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-purple-600 border border-white shadow" />
              <span className="text-gray-700">Event (today only)</span>
            </div>
          </div>

          {/* Bars Column */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Bars & Lounges ($$+)</div>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-green-600 border border-white shadow" />
              <span className="text-gray-700">Open bar</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-orange-600 border border-white shadow" />
              <span className="text-gray-700">Closed (worth staging near)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-red-600 border border-white shadow" />
              <span className="text-gray-700">Closing soon (last call!)</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Shows $$ and above venues
            </div>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500 flex items-start gap-2">
          <span className="mt-0.5">🚦</span>
          <span>Traffic overlay shows real-time road conditions (green=flowing, yellow=slow, red=congested)</span>
        </div>
        {/* PHASE F: incident layer legend (visible regardless of toggle state
            so drivers know what the triangle glyph means before turning it on).
            2026-04-30: explicit severity swatches added — three triangle pips
            sized like the actual map glyphs, in the rose family that matches
            MARKER_COLORS.incidentHigh/Medium/Low. */}
        <div className="mt-2 pt-2 border-t border-gray-200">
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Traffic Incidents</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-700">
            <span className="flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" aria-hidden="true">
                <path d="M12 2 L22 21 L2 21 Z" fill="#be185d" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
              </svg>
              <span>High severity</span>
            </span>
            <span className="flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" aria-hidden="true">
                <path d="M12 2 L22 21 L2 21 Z" fill="#e11d48" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
              </svg>
              <span>Medium</span>
            </span>
            <span className="flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" aria-hidden="true">
                <path d="M12 2 L22 21 L2 21 Z" fill="#f43f5e" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
              </svg>
              <span>Low</span>
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-1.5">
            Off by default. Use the toggle in the top-right of the map to show TomTom incidents (accidents, jams, road closures).
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

export default StrategyMap;
