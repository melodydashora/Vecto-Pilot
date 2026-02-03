// 2026-01-09: P1-6 FIX - Using centralized constants
import React, { createContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from './auth-context';
import { STORAGE_KEYS, SESSION_KEYS } from '@/constants/storageKeys';
import { API_ROUTES } from '@/constants/apiRoutes';

// ═══════════════════════════════════════════════════════════════════════════
// SNAPSHOT ARCHITECTURE (Updated 2026-01-05)
// ═══════════════════════════════════════════════════════════════════════════
// Three-table architecture (per SAVE-IMPORTANT.md):
//   - driver_profiles: Identity (forever)
//   - users: Session (login → logout/60min TTL)
//   - snapshots: Activity (forever)
//
// Session rules:
//   - Login creates users row with session_id, current_snapshot_id=null
//   - Snapshot creation updates users.current_snapshot_id
//   - Every authenticated request updates users.last_active_at (60 min sliding window)
//   - Hard limit: 2 hours from session_start_at = force re-login
//   - Logout deletes users row immediately
//
// Client behavior:
//   - Does NOT persist snapshot_id across reloads (server owns it)
//   - Fires 'vecto-snapshot-saved' event for downstream components
//   - Manual refresh (force=true) creates fresh snapshot
// ═══════════════════════════════════════════════════════════════════════════

// SessionStorage persistence for snapshot data
// Prevents data loss when switching between apps (Uber ↔ Vecto)
// 2026-01-09: P1-6 - Use centralized constant
const SNAPSHOT_STORAGE_KEY = SESSION_KEYS.SNAPSHOT;
// TTL for session storage - KEEP SHORT for real-time intelligence
// 2 minutes allows quick app switches (Uber ↔ Vecto) but ensures fresh data otherwise
// LESSON LEARNED: 1-hour TTL caused 49-minute-old stale strategies to appear
// 2026-01-06: P3-B - Extended TTL for resume support
// Previous: 2 min (too short - driver switches to Uber for 5 min, loses everything)
// Previous: 1 hour (too long - stale traffic/events data)
// New: 15 min - reasonable for app switching during active shift
// The server has its own 60-min TTL for snapshot reuse, this is for CLIENT-side resume
const SNAPSHOT_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL for resume

// Clear sessionStorage - called when driver clicks GPS refresh button
// Driver does this when returning to staging area to get fresh data
function clearSnapshotStorage(): void {
  sessionStorage.removeItem(SNAPSHOT_STORAGE_KEY);
  console.log('🔄 [LocationContext] Cleared sessionStorage - fresh data requested');
}

// Inline geolocation helper with manual timeout fallback
// Browser's geolocation timeout can hang in some environments (previews, permission blocked)
function getGeoPosition(): Promise<{ latitude: number; longitude: number; accuracy: number } | null> {
  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve) => {
    let resolved = false;

    // Check permission state first (if available)
    let permissionState = 'unknown';
    try {
      if (navigator.permissions) {
        const result = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
        permissionState = result.state; // 'granted', 'denied', or 'prompt'
      }
    } catch (_e) {
      permissionState = 'query-failed';
    }

    // Debug: Log environment info
    console.log('[getGeoPosition] Starting...', {
      hasNavigator: typeof navigator !== 'undefined',
      hasGeolocation: typeof navigator !== 'undefined' && !!navigator.geolocation,
      isSecureContext: typeof window !== 'undefined' && window.isSecureContext,
      protocol: typeof window !== 'undefined' ? window.location.protocol : 'unknown',
      hostname: typeof window !== 'undefined' ? window.location.hostname : 'unknown',
      permissionState
    });

    if (!navigator.geolocation) {
      console.warn('[getGeoPosition] Geolocation not supported');
      resolve(null);
      return;
    }

    // Manual timeout - must be > browser timeout to let browser respond first
    // Browser timeout is 10s, so manual is 12s as fallback
    const manualTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.warn('[getGeoPosition] Manual timeout (12s) - browser geolocation hung.');
        resolve(null);
      }
    }, 12000);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(manualTimeout);
        console.log('[getGeoPosition] Success:', position.coords.latitude, position.coords.longitude);
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        });
      },
      async (error) => {
        if (resolved) return;
        console.warn('[getGeoPosition] Browser failed:', error.code, error.message);

        // Fallback: Google Geolocation API (works when browser GPS fails)
        const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
        if (GOOGLE_API_KEY) {
          try {
            console.log('[getGeoPosition] Trying Google Geolocation API fallback...');
            const res = await fetch(
              `https://www.googleapis.com/geolocation/v1/geolocate?key=${GOOGLE_API_KEY}`,
              { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
            );
            if (res.ok) {
              const data = await res.json();
              if (data?.location) {
                resolved = true;
                clearTimeout(manualTimeout);
                console.log('[getGeoPosition] Google API success:', data.location.lat, data.location.lng);
                resolve({
                  latitude: data.location.lat,
                  longitude: data.location.lng,
                  accuracy: data.accuracy || 100
                });
                return;
              }
            }
          } catch (e) {
            console.warn('[getGeoPosition] Google API fallback failed:', e);
          }
        }

        // No fallback worked
        resolved = true;
        clearTimeout(manualTimeout);
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  });
}

interface LocationContextType {
  currentCoords: { latitude: number; longitude: number } | null;
  currentLocationString: string;
  city: string | null;
  state: string | null;
  timeZone: string | null;
  isUpdating: boolean;
  lastUpdated: string | null;
  refreshGPS: () => Promise<void>;
  overrideCoords: { latitude: number; longitude: number; city?: string } | null;
  // Weather and air quality - fetched once during enrichment, shared via context
  weather: { temp: number; conditions: string; description?: string } | null;
  airQuality: { aqi: number; category: string } | null;
  // Location resolution gate - true when city/formattedAddress are available
  // Use this to gate downstream queries (Bar Tab, Strategy) to prevent race conditions
  isLocationResolved: boolean;
  isLoading: boolean;
  setOverrideCoords: (coords: { latitude: number; longitude: number; city?: string } | null) => void;
}

export const LocationContext = createContext<LocationContextType | null>(null);

// Custom hook to consume location context
export const useLocation = () => {
  const context = React.useContext(LocationContext);
  if (!context) {
    throw new Error('useLocation must be used within LocationProvider');
  }
  return context;
};

export const LocationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Get auth state to link snapshots to logged-in user
  // Also get profile for home location fallback when GPS fails
  const { token, user, profile, isLoading: authLoading } = useAuth();

  const [currentCoords, setCurrentCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [currentLocationString, setCurrentLocationString] = useState('Getting location...');
  const [city, setCity] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [overrideCoords, setOverrideCoords] = useState<{ latitude: number; longitude: number; city?: string } | null>(null);
  // Weather and air quality state - fetched once during enrichment, exposed via context
  const [weather, setWeather] = useState<{ temp: number; conditions: string; description?: string } | null>(null);
  const [airQuality, setAirQuality] = useState<{ aqi: number; category: string } | null>(null);
  // Location resolution gate - prevents race conditions by gating downstream queries
  const [isLocationResolved, setIsLocationResolved] = useState(false);
  // 2026-02-01: FAIL HARD - Location error state for immediate critical error trigger
  // When set, CoPilotContext should block the UI with CriticalError modal
  const [locationError, setLocationError] = useState<{ code: string; message: string } | null>(null);
  // Expose snapshot ID directly so co-pilot can access it as fallback if event is missed
  const [lastSnapshotId, setLastSnapshotId] = useState<string | null>(null);
  const generationCounterRef = useRef(0);
  const isInitialMountRef = useRef(true);
  const lastEnrichmentCoordsRef = useRef<string | null>(null);
  const sessionRestoreAttemptedRef = useRef(false);
  // AbortController for request cancellation - prevents stale responses from overwriting fresh data
  // Updated 2026-01-05: Fixes network waste when users tap refresh rapidly
  const abortControllerRef = useRef<AbortController | null>(null);
  // 2026-01-07: Ref to always access latest refreshGPS without adding to effect deps
  // Adding refreshGPS to deps caused infinite loop (Maximum update depth exceeded)
  // The ref is updated after refreshGPS is defined (see useEffect below refreshGPS definition)
  const refreshGPSRef = useRef<(force?: boolean) => Promise<void>>();

  // 2026-01-14: Refs to access current state values in GPS effect without adding to deps
  // This prevents the closure capture problem where setTimeout sees stale values
  const lastSnapshotIdRef = useRef<string | null>(null);
  const currentCoordsRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const cityRef = useRef<string | null>(null);

  // 2026-01-06: P3-B - Restore FULL session including snapshotId for resume
  // Previous: Only restored display data, always created new snapshot
  // Problem: User switches apps for 5 min → returns → 35-50s regeneration
  // Solution: Restore snapshotId if within TTL, mark as "resume" to skip regeneration
  //
  // LESSON LEARNED (updated 2026-01-06):
  // The "duplicate waterfalls" issue was caused by MOUNT-CLEARING strategy (P3-A fix)
  // With P3-A fixed, we can now safely restore snapshotId because:
  // - Strategy is also restored from localStorage if snapshotId matches
  // - CoPilotContext will see existing strategy and not regenerate
  useEffect(() => {
    if (sessionRestoreAttemptedRef.current) return;
    sessionRestoreAttemptedRef.current = true;

    try {
      const stored = sessionStorage.getItem(SNAPSHOT_STORAGE_KEY);
      if (!stored) return;

      const data = JSON.parse(stored);

      // Check TTL - don't restore stale data (real-time app needs fresh intel)
      if (Date.now() - data.timestamp > SNAPSHOT_TTL_MS) {
        console.log('📦 [LocationContext] Stored snapshot expired (>15min), starting fresh');
        sessionStorage.removeItem(SNAPSHOT_STORAGE_KEY);
        return;
      }

      console.log('📦 [LocationContext] RESUME MODE - restoring full session:', data.snapshotId?.slice(0, 8));

      // 2026-01-06: P3-B - Now restore snapshotId for resume
      // This works because P3-A fixed the mount-clearing issue
      if (data.snapshotId) {
        setLastSnapshotId(data.snapshotId);
        // Mark as resume for P3-D - CoPilotContext should not trigger blocks-fast
        sessionStorage.setItem(SESSION_KEYS.RESUME_REASON, 'resume');
      }
      if (data.coords) setCurrentCoords(data.coords);
      if (data.city) setCity(data.city);
      if (data.state) setState(data.state);
      if (data.timeZone) setTimeZone(data.timeZone);
      if (data.locationString) setCurrentLocationString(data.locationString);
      if (data.weather) setWeather(data.weather);
      if (data.airQuality) setAirQuality(data.airQuality);

      // 2026-01-07: DO NOT set isLocationResolved during restore
      // LESSON LEARNED: Setting isLocationResolved = true here caused auth loop bug.
      // The restore runs BEFORE auth finishes loading (empty deps []).
      // If we gate queries here, they fire before auth is ready → 401 → logout loop.
      //
      // Instead, let the normal flow handle this:
      // 1. Auth loads → isLoading becomes false
      // 2. GPS effect runs (line 604) → sees we have cached coords
      // 3. enrichLocation is called → server validates snapshot
      // 4. On success, isLocationResolved is set to true (line 428)
      //
      // The restored display data (city, weather, etc.) shows immediately in UI,
      // but API queries wait until auth + snapshot validation complete.

      // Skip GPS fetch on resume - we have valid cached data
      // The coord tracking prevents duplicate enrichment
      if (data.coords) {
        const coordKey = `${data.coords.latitude.toFixed(6)},${data.coords.longitude.toFixed(6)}`;
        lastEnrichmentCoordsRef.current = coordKey;
        console.log('📦 [LocationContext] Resume complete - skipping GPS fetch for coords:', coordKey);
      }
    } catch (e) {
      console.warn('[LocationContext] Failed to restore from sessionStorage:', e);
    }
  }, []);

  // Persist snapshot data to sessionStorage when it changes
  // This enables persistence across app switches
  useEffect(() => {
    if (!lastSnapshotId) return;

    const dataToStore = {
      snapshotId: lastSnapshotId,
      coords: currentCoords,
      city,
      state,
      timeZone,
      locationString: currentLocationString,
      weather,
      airQuality,
      isLocationResolved,
      lastUpdated,
      timestamp: Date.now(),
    };

    sessionStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(dataToStore));
    console.log('💾 [LocationContext] Persisted snapshot to sessionStorage:', lastSnapshotId.slice(0, 8));
  }, [lastSnapshotId, currentCoords, city, state, timeZone, currentLocationString, weather, airQuality, isLocationResolved, lastUpdated]);

  const enrichLocation = useCallback(async (lat: number, lng: number, accuracy: number, forceRefresh = false) => {
    // Prevent duplicate enrichment for same coordinates (debounce)
    // Skip debounce check if force refresh (user clicked button)
    const coordKey = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    if (!forceRefresh && lastEnrichmentCoordsRef.current === coordKey) {
      console.log('⏭️ Skipping duplicate enrichment for same coordinates:', coordKey);
      return;
    }
    lastEnrichmentCoordsRef.current = coordKey;

    // Cancel any pending requests before starting new ones
    // Updated 2026-01-05: Prevents network waste when users tap refresh rapidly
    if (abortControllerRef.current) {
      console.log('🛑 [LocationContext] Cancelling previous enrichment request');
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const deviceId = localStorage.getItem(STORAGE_KEYS.DEVICE_ID) || crypto.randomUUID();
    localStorage.setItem(STORAGE_KEYS.DEVICE_ID, deviceId);

    const currentGeneration = ++generationCounterRef.current;
    console.log(`🔢 Generation #${currentGeneration} starting for GPS update`);
    console.log(`🔐 [LocationContext] Auth state: token=${token ? 'yes' : 'no'}, userId=${user?.userId || 'anonymous'}`);

    // 2026-01-07: SAFEGUARD - Never make location requests without auth
    // This catches stale closure bugs where enrichLocation was captured with null token
    if (!token || !user?.userId) {
      console.error('[LocationContext] ❌ BUG: enrichLocation called without auth! Aborting to prevent 401 loop.');
      console.error('[LocationContext] This is likely a stale closure - refreshGPS captured old enrichLocation');
      return;
    }

    try {
      // 2026-01-09: P0-2 FIX - Removed user_id query param (was security bypass)
      // Authentication ONLY comes from Authorization header now
      // 2026-01-15: Using centralized API_ROUTES constant
      let resolveUrl = API_ROUTES.LOCATION.RESOLVE_WITH_PARAMS(lat, lng, deviceId, accuracy);
      // Force refresh bypasses server-side snapshot reuse (60 min TTL)
      // This is used when user explicitly clicks the refresh button
      if (forceRefresh) {
        resolveUrl += '&force=true';
      }

      // Prepare headers - include auth token if logged in (ONLY source of auth)
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // 2026-01-09: P0-2 FIX - Removed sensitive DEBUG logging
      // Token prefixes and userIds were being logged, exposing auth details
      console.log('[LocationContext] Making location resolve request');

      // ═══════════════════════════════════════════════════════════════════════════
      // TWO-PHASE UI UPDATE: Weather/AQI appear ~200-300ms before city/state
      // Weather and AQI are faster (single Google API each), location is slower
      // (Google Geocode + Timezone + DB writes)
      // ═══════════════════════════════════════════════════════════════════════════

      // Start all requests in parallel with abort signal
      // Updated 2026-01-05: Added signal for request cancellation
      // 2026-01-15: Using centralized API_ROUTES constants
      const locationPromise = fetch(resolveUrl, { headers, signal: controller.signal });
      const weatherPromise = fetch(API_ROUTES.LOCATION.WEATHER_WITH_COORDS(lat, lng), { signal: controller.signal });
      const airPromise = fetch(API_ROUTES.LOCATION.AIR_QUALITY_WITH_COORDS(lat, lng), { signal: controller.signal });

      // Track weather/air data for snapshot enrichment later
      let weatherData: { available: boolean; temperature: number; conditions: string; description?: string } | null = null;
      let airQualityData: { available: boolean; aqi: number; category: string } | null = null;

      // PHASE 1: Update UI as soon as weather/air resolve (faster APIs)
      // Don't await - let them update independently
      weatherPromise.then(async (res) => {
        if (currentGeneration !== generationCounterRef.current) return;
        if (res.ok) {
          const data = await res.json();
          weatherData = data;
          if (data?.available) {
            setWeather({
              temp: data.temperature,
              conditions: data.conditions,
              description: data.description
            });
            console.log('🌤️ [LocationContext] Weather updated (phase 1)');
          }
        }
      }).catch((err) => console.warn('[LocationContext] Weather fetch failed:', err));

      airPromise.then(async (res) => {
        if (currentGeneration !== generationCounterRef.current) return;
        if (res.ok) {
          const data = await res.json();
          airQualityData = data;
          if (data?.available) {
            setAirQuality({
              aqi: data.aqi,
              category: data.category
            });
            console.log('💨 [LocationContext] AQI updated (phase 1)');
          }
        }
      }).catch((err) => console.warn('[LocationContext] AQI fetch failed:', err));

      // PHASE 2: Wait for location resolve (slower due to DB writes)
      const locationRes = await locationPromise;

      if (currentGeneration !== generationCounterRef.current) {
        console.log(`⏭️ Generation #${currentGeneration} superseded - ignoring results`);
        return;
      }

      // Handle authentication errors - clear stale token and redirect to login
      if (locationRes.status === 401) {
        // 2026-01-07: DEBUG - Log detailed info about the 401
        let errorBody = null;
        try {
          errorBody = await locationRes.clone().json();
        } catch (_e) { /* ignore */ }
        console.error('🔐 [LocationContext] ❌ 401 ERROR - Authentication failed!');
        console.error('🔐 [LocationContext] Response body:', errorBody);
        console.error('🔐 [LocationContext] Token was present:', !!token);
        console.error('🔐 [LocationContext] Token from localStorage:', localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)?.substring(0, 20) + '...');
        console.error('🔐 [LocationContext] User ID sent:', user?.userId);

        // Clear stale token from localStorage (using centralized STORAGE_KEYS)
        localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
        // Dispatch event so auth context can update
        window.dispatchEvent(new CustomEvent('auth-token-expired'));
        // Redirect to sign-in
        window.location.href = '/auth/sign-in?expired=true';
        return;
      }

      const locationData = await locationRes.json();

      // Ensure weather/air data is populated (in case location finished first)
      if (!weatherData) {
        try {
          const res = await weatherPromise;
          if (res.ok) weatherData = await res.json();
        } catch (_e) { /* already logged */ }
      }
      if (!airQualityData) {
        try {
          const res = await airPromise;
          if (res.ok) airQualityData = await res.json();
        } catch (_e) { /* already logged */ }
      }

      // Update city/state (phase 2 - after location resolves)
      setCity(locationData.city);
      setState(locationData.state);
      setTimeZone(locationData.timeZone);
      // 2026-02-01: FAIL HARD - If city/state missing, trigger critical error
      // This prevents waterfall from progressing with incomplete location data
      if (locationData.city && locationData.state) {
        setCurrentLocationString(`${locationData.city}, ${locationData.state}`);
        setLocationError(null); // Clear any previous error
      } else {
        // FAIL HARD: Set error state that will block the UI
        console.error('❌ [LocationContext] FAIL HARD: City/state missing from geocode response', {
          city: locationData.city,
          state: locationData.state,
          formattedAddress: locationData.formattedAddress
        });

        // CRITICAL: Clear ALL stale data from session restore
        // Without valid coords, weather/AQI/timezone are meaningless and misleading
        setWeather(null);
        setAirQuality(null);
        setTimeZone(null);
        setCity(null);
        setState(null);
        setCurrentCoords(null);
        setLastSnapshotId(null);
        sessionStorage.removeItem(SNAPSHOT_STORAGE_KEY);
        console.log('🧹 [LocationContext] Cleared ALL stale data - coords are required for everything');

        setLocationError({
          code: 'geocode_incomplete',
          message: 'Could not determine your city/state. Please check GPS permissions and try again.'
        });
        setCurrentLocationString('Location unavailable');
        return; // Stop processing - don't allow waterfall to continue
      }
      setLastUpdated(new Date().toISOString());
      console.log('📍 [LocationContext] Location updated (phase 2):', locationData.city, locationData.state);

      // Mark location as resolved - gates downstream queries (Bar Tab, Strategy)
      if (locationData.city && locationData.formattedAddress) {
        setIsLocationResolved(true);
        console.log('✅ [LocationContext] Location resolved - downstream queries enabled');
      }

      // NOTE: JWT tokens are only used for registered users who login via /api/auth/login
      // Anonymous users access data via snapshot ownership (snapshot_id acts as capability token)
      // The old /api/auth/token endpoint is disabled in production

      // ═══════════════════════════════════════════════════════════════════════════
      // SNAPSHOT: Server creates snapshot during resolve, returns snapshot_id
      // We just need to enrich it with weather/air and dispatch the event
      // ═══════════════════════════════════════════════════════════════════════════
      const snapshotId = locationData.snapshot_id;

      if (snapshotId) {
        console.log(`📸 [LocationContext] Using server-created snapshot: ${snapshotId.slice(0, 8)}...`);

        // Enrich snapshot with weather/air if available
        // 2026-01-15: Using centralized API_ROUTES constant
        if (weatherData?.available || airQualityData?.available) {
          try {
            await fetch(API_ROUTES.LOCATION.SNAPSHOT_ENRICH(snapshotId), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                weather: weatherData?.available ? {
                  tempF: weatherData.temperature,
                  conditions: weatherData.conditions,
                  description: weatherData.description
                } : undefined,
                air: airQualityData?.available ? {
                  aqi: airQualityData.aqi,
                  category: airQualityData.category
                } : undefined
              }),
              signal: controller.signal
            });
            console.log(`📸 [LocationContext] Snapshot enriched with weather/air`);
          } catch (enrichErr) {
            // Ignore AbortError - request was intentionally cancelled
            if (enrichErr instanceof Error && enrichErr.name === 'AbortError') {
              console.log('🛑 [LocationContext] Enrich request cancelled');
              return;
            }
            console.warn('[LocationContext] Failed to enrich snapshot:', enrichErr);
          }
        }

        // Set snapshot ID in state (fallback for co-pilot if event is missed)
        setLastSnapshotId(snapshotId);

        // 2026-01-06: P3-D - Include reason for smart resume support
        // CoPilotContext uses this to decide whether to trigger blocks-fast
        const reason = forceRefresh ? 'manual_refresh' : 'init';
        window.dispatchEvent(new CustomEvent('vecto-snapshot-saved', {
          detail: { snapshotId, holiday: null, is_holiday: false, reason }
        }));
      } else {
        // Fallback: Server didn't return snapshot_id, create one client-side (legacy path)
        console.warn('⚠️ [LocationContext] No snapshot_id from server - using legacy client creation');
        const fallbackSnapshotId = crypto.randomUUID();
        const now = new Date();
        const hour = new Date(now.toLocaleString('en-US', { timeZone: locationData.timeZone })).getHours();
        const dow = new Date(now.toLocaleString('en-US', { timeZone: locationData.timeZone })).getDay();

        const snapshot = {
          snapshot_id: fallbackSnapshotId,
          user_id: locationData.user_id,
          device_id: deviceId,
          session_id: crypto.randomUUID(),
          created_at: now.toISOString(),
          coord: { lat, lng, source: 'gps' },
          resolved: {
            city: locationData.city,
            state: locationData.state,
            country: locationData.country,
            timezone: locationData.timeZone,
            formattedAddress: locationData.formattedAddress
          },
          time_context: {
            local_iso: now.toISOString(),
            dow,
            hour,
            is_weekend: dow === 0 || dow === 6,
            day_part_key: hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
          },
          weather: weatherData?.available ? {
            tempF: weatherData.temperature,
            conditions: weatherData.conditions,
            description: weatherData.description
          } : undefined,
          air: airQualityData?.available ? {
            aqi: airQualityData.aqi,
            category: airQualityData.category
          } : undefined,
          device: { platform: 'web' },
          permissions: { geolocation: 'granted' }
        };

        // 2026-01-15: Using centralized API_ROUTES constant
        const snapshotRes = await fetch(API_ROUTES.LOCATION.SNAPSHOT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snapshot),
          signal: controller.signal
        });

        if (snapshotRes.ok) {
          // Set snapshot ID in state (fallback for co-pilot if event is missed)
          setLastSnapshotId(fallbackSnapshotId);

          // 2026-01-06: P3-D - Include reason (legacy path uses same logic)
          const fallbackReason = forceRefresh ? 'manual_refresh' : 'init';
          window.dispatchEvent(new CustomEvent('vecto-snapshot-saved', {
            detail: { snapshotId: fallbackSnapshotId, holiday: null, is_holiday: false, reason: fallbackReason }
          }));
        }
      }
    } catch (error) {
      // Ignore AbortError - request was intentionally cancelled (user tapped refresh rapidly)
      // Updated 2026-01-05: Graceful handling of cancelled requests
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('🛑 [LocationContext] Enrichment cancelled by newer request');
        return;
      }
      console.error('[LocationContext] Enrichment failed:', error);
    }
  // 2026-01-06: Depend on user?.userId (primitive) instead of user object
  // This prevents callback recreation when user object reference changes but userId stays the same
  }, [token, user?.userId]);

  // refreshGPS: Fetch GPS and resolve location
  // forceNewSnapshot: true = user clicked refresh button, always create new snapshot
  //                   false = initial mount, allow server to reuse existing snapshot if < 60 min
  const refreshGPS = useCallback(async (forceNewSnapshot = true) => {
    setIsUpdating(true);
    setOverrideCoords(null);
    setIsLocationResolved(false); // Reset - gates queries until new location resolves

    // Only clear storage when user explicitly requests fresh data
    if (forceNewSnapshot) {
      // Clear sessionStorage - driver clicked refresh to get fresh data at staging area
      clearSnapshotStorage();

      // Clear old strategy
      localStorage.removeItem(STORAGE_KEYS.PERSISTENT_STRATEGY);
      localStorage.removeItem(STORAGE_KEYS.STRATEGY_SNAPSHOT_ID);
      window.dispatchEvent(new CustomEvent('vecto-strategy-cleared'));
    }

    try {
      const coords = await getGeoPosition();
      if (coords) {
        console.log('📍 [LocationContext] GPS success - using live location');
        setCurrentCoords({ latitude: coords.latitude, longitude: coords.longitude });
        // Pass forceNewSnapshot to server - controls whether to reuse existing snapshot
        await enrichLocation(coords.latitude, coords.longitude, coords.accuracy, forceNewSnapshot);
      } else if (profile?.homeLat && profile?.homeLng) {
        // Fallback to home location from user's profile (set during registration)
        console.log('🏠 [LocationContext] GPS unavailable - using home location from profile');
        setCurrentCoords({ latitude: profile.homeLat, longitude: profile.homeLng });
        // Pass forceNewSnapshot to server - controls whether to reuse existing snapshot
        await enrichLocation(profile.homeLat, profile.homeLng, 100, forceNewSnapshot); // 100m accuracy for geocoded address
      } else {
        // No GPS and no home location - user needs to enable GPS
        console.warn('[LocationContext] No GPS and no home location - cannot proceed');
        setCurrentLocationString('Location unavailable - enable GPS');
      }
    } finally {
      setIsUpdating(false);
    }
  }, [enrichLocation, profile?.homeLat, profile?.homeLng]);

  // 2026-01-07: Keep ref in sync with latest refreshGPS
  // This allows the GPS effect to always call the latest version
  // without adding refreshGPS to its deps (which causes infinite loop)
  useEffect(() => {
    refreshGPSRef.current = refreshGPS;
  }, [refreshGPS]);

  // 2026-01-14: Keep state refs in sync for GPS effect to read current values
  // Without this, setTimeout closure captures stale values from when effect ran
  useEffect(() => { lastSnapshotIdRef.current = lastSnapshotId; }, [lastSnapshotId]);
  useEffect(() => { currentCoordsRef.current = currentCoords; }, [currentCoords]);
  useEffect(() => { cityRef.current = city; }, [city]);

  // Initial GPS fetch - ONLY start when user is AUTHENTICATED
  // This ensures snapshots are ALWAYS linked to the authenticated user
  // Anonymous users on sign-up/sign-in pages should NOT create snapshots
  // Note: Browser may show "[Violation] Only request geolocation in response to user gesture"
  // This is a warning, not an error - we try anyway and fall back to button click if needed
  //
  // 2026-01-14: FIX - Removed lastSnapshotId, currentCoords, city from deps
  // These values are SET by refreshGPS, so having them in deps caused cascade:
  // 1. Effect runs → refreshGPS called → setCurrentCoords
  // 2. currentCoords changed → effect re-runs → another refreshGPS
  // This was causing 4x GPS fetches in 200ms!
  //
  // Instead, we use refs to check cached data without adding to deps.
  // The ref is updated in session restore (line 270-273) and by state updates.
  const gpsEffectRanRef = useRef(false);

  useEffect(() => {
    // Don't start GPS fetch until auth state is determined
    if (authLoading) {
      console.log('🔐 [LocationContext] Waiting for auth state to load...');
      return;
    }

    // CRITICAL: Only start GPS fetch if user is AUTHENTICATED
    // Anonymous users should not create snapshots
    if (!user?.userId || !token) {
      console.log('🔐 [LocationContext] User not authenticated - skipping GPS fetch');
      return;
    }

    // 2026-01-14: Prevent duplicate GPS fetches
    // This flag ensures we only start ONE GPS fetch per auth session
    if (gpsEffectRanRef.current) {
      console.log('⏭️ [LocationContext] GPS effect already ran this session - skipping');
      return;
    }

    const timer = setTimeout(() => {
      // Double-check the flag inside timeout (state might have changed)
      if (gpsEffectRanRef.current) return;

      // 2026-01-14: Handle resume with cached data
      // Auth is now verified, check if we have valid cached data to resume from
      // Use REFS to get current values - closures would capture stale values!
      const cachedSnapshotId = lastSnapshotIdRef.current;
      const cachedCoords = currentCoordsRef.current;
      const cachedCity = cityRef.current;

      if (cachedSnapshotId && cachedCoords && cachedCity) {
        console.log('📦 [LocationContext] RESUME: Auth verified, enabling cached data');
        console.log(`📦 [LocationContext] Cached snapshot: ${cachedSnapshotId.slice(0, 8)}, city: ${cachedCity}`);

        // Mark location as resolved - auth is verified, cached data is valid
        // This gates downstream queries (bars, briefing)
        setIsLocationResolved(true);

        // Dispatch event so CoPilotContext can use the cached snapshotId
        // reason: 'resume' tells it not to regenerate strategy
        window.dispatchEvent(new CustomEvent('vecto-snapshot-saved', {
          detail: { snapshotId: cachedSnapshotId, holiday: null, is_holiday: false, reason: 'resume' }
        }));

        gpsEffectRanRef.current = true;
        return;
      }

      gpsEffectRanRef.current = true;
      console.log(`📍 [LocationContext] Authenticated user ${user.userId.slice(0, 8)}... starting GPS fetch`);
      // Initial mount: allow server to reuse existing snapshot if < 60 min old
      // 2026-01-07: Use ref to call latest refreshGPS without adding to deps
      refreshGPSRef.current?.(false);
    }, 50);
    return () => clearTimeout(timer);
  // 2026-01-14: CRITICAL - Only depend on auth state, NOT on GPS data (lastSnapshotId, currentCoords, city)
  // Those values are SET by refreshGPS, so having them in deps caused 4x GPS fetches
  }, [authLoading, user?.userId, token]);

  // Listen for snapshot ownership errors (when user changes but stale snapshot ID is used)
  // This triggers a fresh GPS fetch to create a new snapshot for the current user
  useEffect(() => {
    const handleOwnershipError = () => {
      console.warn('🚨 [LocationContext] Snapshot ownership error - clearing and refreshing');
      // Clear the stale snapshot ID
      setLastSnapshotId(null);
      // Clear sessionStorage to remove any persisted stale data
      clearSnapshotStorage();
      // Clear the coord tracking so enrichment can run again
      lastEnrichmentCoordsRef.current = null;
      // Trigger fresh GPS fetch → force new snapshot for current user
      // 2026-01-07: Use ref to access latest refreshGPS
      refreshGPSRef.current?.(true);
    };

    window.addEventListener('snapshot-ownership-error', handleOwnershipError);
    return () => window.removeEventListener('snapshot-ownership-error', handleOwnershipError);
  }, []); // Empty deps - event listener only needs to be set up once

  // Auto-enrich when coords change (but skip initial mount to avoid duplicate)
  useEffect(() => {
    // Skip on initial mount - refreshGPS() already handles enrichment
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }

    // Only enrich if we have valid coords and they've changed
    if (currentCoords) {
      console.log('📍 Coordinates changed - triggering enrichment');
      enrichLocation(currentCoords.latitude, currentCoords.longitude, 10);
    }
  }, [currentCoords?.latitude, currentCoords?.longitude, enrichLocation]);

  // 2026-01-06: CRITICAL FIX - Memoize context value to prevent infinite re-render loops
  // Without useMemo, every render creates a new object → all consumers re-render → cascade
  // This was causing "Maximum update depth exceeded" errors
  const contextValue = useMemo(() => ({
    currentCoords,
    currentLocationString,
    city,
    state,
    timeZone,
    isUpdating,
    lastUpdated,
    refreshGPS,
    overrideCoords,
    weather,
    airQuality,
    isLocationResolved,
    lastSnapshotId,
    isLoading: isUpdating,
    setOverrideCoords,
    // 2026-02-01: FAIL HARD - Expose location error for CoPilotContext to trigger CriticalError
    locationError
  }), [
    currentCoords,
    currentLocationString,
    city,
    state,
    timeZone,
    isUpdating,
    lastUpdated,
    refreshGPS,
    overrideCoords,
    weather,
    airQuality,
    isLocationResolved,
    lastSnapshotId,
    setOverrideCoords,
    locationError
  ]);

  return (
    <LocationContext.Provider value={contextValue}>
      {children}
    </LocationContext.Provider>
  );
};
