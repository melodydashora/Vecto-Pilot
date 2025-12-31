
import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './auth-context';

// SessionStorage persistence for snapshot data
// Prevents data loss when switching between apps (Uber ↔ Vecto)
const SNAPSHOT_STORAGE_KEY = 'vecto_snapshot';
// TTL for session storage - KEEP SHORT for real-time intelligence
// 2 minutes allows quick app switches (Uber ↔ Vecto) but ensures fresh data otherwise
// LESSON LEARNED: 1-hour TTL caused 49-minute-old stale strategies to appear
const SNAPSHOT_TTL_MS = 2 * 60 * 1000; // 2 minutes TTL (was 1 hour - too long!)

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
  // Last snapshot ID created - fallback for co-pilot if event is missed
  lastSnapshotId: string | null;
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
  const { token, user, isLoading: authLoading } = useAuth();

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
  // Expose snapshot ID directly so co-pilot can access it as fallback if event is missed
  const [lastSnapshotId, setLastSnapshotId] = useState<string | null>(null);
  const generationCounterRef = useRef(0);
  const isInitialMountRef = useRef(true);
  const lastEnrichmentCoordsRef = useRef<string | null>(null);
  const sessionRestoreAttemptedRef = useRef(false);

  // Restore DISPLAY data from sessionStorage on mount (for immediate UX)
  // IMPORTANT: Do NOT restore snapshot_id - always create fresh snapshot!
  // LESSON LEARNED: Restoring old snapshot_id triggers waterfall for stale data,
  // causing duplicate pipeline runs and showing old strategies
  useEffect(() => {
    if (sessionRestoreAttemptedRef.current) return;
    sessionRestoreAttemptedRef.current = true;

    try {
      const stored = sessionStorage.getItem(SNAPSHOT_STORAGE_KEY);
      if (!stored) return;

      const data = JSON.parse(stored);

      // Check TTL - don't restore stale data (real-time app needs fresh intel)
      if (Date.now() - data.timestamp > SNAPSHOT_TTL_MS) {
        console.log('📦 [LocationContext] Stored snapshot expired (>2min), starting fresh');
        sessionStorage.removeItem(SNAPSHOT_STORAGE_KEY);
        return;
      }

      console.log('📦 [LocationContext] Restoring DISPLAY data only (not snapshot_id):', data.city);

      // Restore DISPLAY data only for immediate UX
      // DO NOT restore snapshot_id - we always want fresh snapshots!
      // if (data.snapshotId) setLastSnapshotId(data.snapshotId); // REMOVED - causes duplicate waterfalls!
      if (data.coords) setCurrentCoords(data.coords);
      if (data.city) setCity(data.city);
      if (data.state) setState(data.state);
      if (data.timeZone) setTimeZone(data.timeZone);
      if (data.locationString) setCurrentLocationString(data.locationString);
      if (data.weather) setWeather(data.weather);
      if (data.airQuality) setAirQuality(data.airQuality);
      // Note: Don't set isLocationResolved - GPS fetch will set it properly

      // IMPORTANT: Do NOT skip GPS fetch!
      // We restored display data for immediate UX, but still need fresh snapshot
      // isInitialMountRef.current = false; // REMOVED - always fetch GPS!
      // lastEnrichmentCoordsRef.current = ...; // REMOVED - always create new snapshot!
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

  const enrichLocation = useCallback(async (lat: number, lng: number, accuracy: number) => {
    // Prevent duplicate enrichment for same coordinates (debounce)
    const coordKey = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    if (lastEnrichmentCoordsRef.current === coordKey) {
      console.log('⏭️ Skipping duplicate enrichment for same coordinates:', coordKey);
      return;
    }
    lastEnrichmentCoordsRef.current = coordKey;

    const deviceId = localStorage.getItem('vecto_device_id') || crypto.randomUUID();
    localStorage.setItem('vecto_device_id', deviceId);

    const currentGeneration = ++generationCounterRef.current;
    console.log(`🔢 Generation #${currentGeneration} starting for GPS update`);
    console.log(`🔐 [LocationContext] Auth state: token=${token ? 'yes' : 'no'}, userId=${user?.userId || 'anonymous'}`);

    try {
      // Build location resolve URL with authenticated userId if logged in
      // This userId is the forever UUID from driver_profiles - NO auto-assignment
      let resolveUrl = `/api/location/resolve?lat=${lat}&lng=${lng}&device_id=${encodeURIComponent(deviceId)}&accuracy=${accuracy}&coord_source=gps`;
      if (user?.userId) {
        resolveUrl += `&user_id=${encodeURIComponent(user.userId)}`;
      }

      // Prepare headers - include auth token if logged in
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const [locationRes, weatherRes, airRes] = await Promise.all([
        fetch(resolveUrl, { headers }),
        fetch(`/api/location/weather?lat=${lat}&lng=${lng}`),
        fetch(`/api/location/airquality?lat=${lat}&lng=${lng}`)
      ]);

      if (currentGeneration !== generationCounterRef.current) {
        console.log(`⏭️ Generation #${currentGeneration} superseded - ignoring results`);
        return;
      }

      // Handle authentication errors - clear stale token and redirect to login
      if (locationRes.status === 401) {
        console.warn('🔐 [LocationContext] Authentication failed - clearing stale token');
        // Clear stale token from localStorage
        localStorage.removeItem('auth_token');
        // Dispatch event so auth context can update
        window.dispatchEvent(new CustomEvent('auth-token-expired'));
        // Redirect to sign-in
        window.location.href = '/auth/sign-in?expired=true';
        return;
      }

      const locationData = await locationRes.json();
      const weatherData = weatherRes.ok ? await weatherRes.json() : null;
      const airQualityData = airRes.ok ? await airRes.json() : null;

      // Set weather state for context consumers (prevents duplicate API calls in GlobalHeader)
      if (weatherData?.available) {
        setWeather({
          temp: weatherData.temperature,
          conditions: weatherData.conditions,
          description: weatherData.description
        });
      }

      // Set air quality state for context consumers
      if (airQualityData?.available) {
        setAirQuality({
          aqi: airQualityData.aqi,
          category: airQualityData.category
        });
      }

      setCity(locationData.city);
      setState(locationData.state);
      setTimeZone(locationData.timeZone);
      setCurrentLocationString(`${locationData.city}, ${locationData.state}`);
      setLastUpdated(new Date().toISOString());

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
        if (weatherData?.available || airQualityData?.available) {
          try {
            await fetch(`/api/location/snapshot/${snapshotId}/enrich`, {
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
              })
            });
            console.log(`📸 [LocationContext] Snapshot enriched with weather/air`);
          } catch (enrichErr) {
            console.warn('[LocationContext] Failed to enrich snapshot:', enrichErr);
          }
        }

        // Set snapshot ID in state (fallback for co-pilot if event is missed)
        setLastSnapshotId(snapshotId);

        // Dispatch event - snapshot is ready
        window.dispatchEvent(new CustomEvent('vecto-snapshot-saved', {
          detail: { snapshotId, holiday: null, is_holiday: false }
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

        const snapshotRes = await fetch('/api/location/snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snapshot)
        });

        if (snapshotRes.ok) {
          // Set snapshot ID in state (fallback for co-pilot if event is missed)
          setLastSnapshotId(fallbackSnapshotId);

          window.dispatchEvent(new CustomEvent('vecto-snapshot-saved', {
            detail: { snapshotId: fallbackSnapshotId, holiday: null, is_holiday: false }
          }));
        }
      }
    } catch (error) {
      console.error('[LocationContext] Enrichment failed:', error);
    }
  }, [token, user]);

  const refreshGPS = useCallback(async () => {
    setIsUpdating(true);
    setOverrideCoords(null);
    setIsLocationResolved(false); // Reset - gates queries until new location resolves

    // Clear sessionStorage - driver clicked refresh to get fresh data at staging area
    clearSnapshotStorage();

    // Clear old strategy
    localStorage.removeItem('vecto_persistent_strategy');
    localStorage.removeItem('vecto_strategy_snapshot_id');
    window.dispatchEvent(new CustomEvent('vecto-strategy-cleared'));

    try {
      const coords = await getGeoPosition();
      if (coords) {
        setCurrentCoords({ latitude: coords.latitude, longitude: coords.longitude });
        await enrichLocation(coords.latitude, coords.longitude, coords.accuracy);
      } else {
        // No fallback - GPS-first global app. User must enable location services.
        console.warn('[LocationContext] Browser geolocation failed - no fallback');
        setCurrentLocationString('Location unavailable - enable GPS');
      }
    } finally {
      setIsUpdating(false);
    }
  }, [enrichLocation]);

  // Initial GPS fetch - ONLY start when user is AUTHENTICATED
  // This ensures snapshots are ALWAYS linked to the authenticated user
  // Anonymous users on sign-up/sign-in pages should NOT create snapshots
  // Note: Browser may show "[Violation] Only request geolocation in response to user gesture"
  // This is a warning, not an error - we try anyway and fall back to button click if needed
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

    const timer = setTimeout(() => {
      if (lastSnapshotId && currentCoords) {
        console.log('📦 [LocationContext] Using cached location from sessionStorage');
        return;
      }
      console.log(`📍 [LocationContext] Authenticated user ${user.userId.slice(0, 8)}... starting GPS fetch`);
      refreshGPS();
    }, 50);
    return () => clearTimeout(timer);
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
      // Trigger fresh GPS fetch → creates new snapshot for current user
      refreshGPS();
    };

    window.addEventListener('snapshot-ownership-error', handleOwnershipError);
    return () => window.removeEventListener('snapshot-ownership-error', handleOwnershipError);
  }, [refreshGPS]);

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

  return (
    <LocationContext.Provider
      value={{
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
        setOverrideCoords
      }}
    >
      {children}
    </LocationContext.Provider>
  );
};
