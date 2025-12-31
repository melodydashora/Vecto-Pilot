
import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';

// SessionStorage persistence for snapshot data
// Prevents data loss when switching between apps (Uber ↔ Vecto)
const SNAPSHOT_STORAGE_KEY = 'vecto_snapshot';
const SNAPSHOT_TTL_MS = 60 * 60 * 1000; // 1 hour TTL

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
    } catch (e) {
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

    // Manual timeout - browser's timeout can hang in previews
    const manualTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.warn('[getGeoPosition] Manual timeout (5s) - browser geolocation hung. Try opening in new tab.');
        resolve(null);
      }
    }, 5000);

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
      (error) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(manualTimeout);
        console.warn('[getGeoPosition] Failed:', error.code, error.message);
        // Error codes: 1=PERMISSION_DENIED, 2=POSITION_UNAVAILABLE, 3=TIMEOUT
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
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
  console.log('🏠 [LocationProvider] Component rendering...');

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

  // Restore snapshot data from sessionStorage on mount
  // This preserves data when user switches between apps (Uber ↔ Vecto)
  // GPS refresh button clears storage via refreshGPS() - not browser refresh
  useEffect(() => {
    if (sessionRestoreAttemptedRef.current) return;
    sessionRestoreAttemptedRef.current = true;

    try {
      const stored = sessionStorage.getItem(SNAPSHOT_STORAGE_KEY);
      if (!stored) return;

      const data = JSON.parse(stored);

      // Check TTL - don't restore stale data
      if (Date.now() - data.timestamp > SNAPSHOT_TTL_MS) {
        console.log('📦 [LocationContext] Stored snapshot expired (>1hr), starting fresh');
        sessionStorage.removeItem(SNAPSHOT_STORAGE_KEY);
        return;
      }

      console.log('📦 [LocationContext] Restoring snapshot from sessionStorage:', data.snapshotId?.slice(0, 8));

      // Restore all snapshot data
      if (data.snapshotId) setLastSnapshotId(data.snapshotId);
      if (data.coords) setCurrentCoords(data.coords);
      if (data.city) setCity(data.city);
      if (data.state) setState(data.state);
      if (data.timeZone) setTimeZone(data.timeZone);
      if (data.locationString) setCurrentLocationString(data.locationString);
      if (data.weather) setWeather(data.weather);
      if (data.airQuality) setAirQuality(data.airQuality);
      if (data.isLocationResolved) setIsLocationResolved(true);
      if (data.lastUpdated) setLastUpdated(data.lastUpdated);

      // If we restored valid data, skip the initial GPS fetch
      if (data.snapshotId && data.coords) {
        isInitialMountRef.current = false;
        lastEnrichmentCoordsRef.current = `${data.coords.latitude.toFixed(6)},${data.coords.longitude.toFixed(6)}`;
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

  const enrichLocation = useCallback(async (lat: number, lng: number, accuracy: number) => {
    console.log('📍 [enrichLocation] ═══════════════════════════════════════════════');
    console.log('📍 [enrichLocation] STARTED with:', { lat, lng, accuracy });

    // Prevent duplicate enrichment for same coordinates (debounce)
    const coordKey = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    if (lastEnrichmentCoordsRef.current === coordKey) {
      console.log('⏭️ [enrichLocation] Skipping duplicate enrichment for same coordinates:', coordKey);
      return;
    }
    lastEnrichmentCoordsRef.current = coordKey;
    console.log('📍 [enrichLocation] New coordinates, proceeding...');

    const deviceId = localStorage.getItem('vecto_device_id') || crypto.randomUUID();
    localStorage.setItem('vecto_device_id', deviceId);
    console.log('📍 [enrichLocation] Device ID:', deviceId.slice(0, 8));

    const currentGeneration = ++generationCounterRef.current;
    console.log(`📍 [enrichLocation] Generation #${currentGeneration} starting API calls...`);

    try {
      console.log('📍 [enrichLocation] Calling /api/location/resolve, /weather, /airquality...');
      const [locationRes, weatherRes, airRes] = await Promise.all([
        fetch(`/api/location/resolve?lat=${lat}&lng=${lng}&device_id=${encodeURIComponent(deviceId)}&accuracy=${accuracy}&coord_source=gps`),
        fetch(`/api/location/weather?lat=${lat}&lng=${lng}`),
        fetch(`/api/location/airquality?lat=${lat}&lng=${lng}`)
      ]);
      console.log('📍 [enrichLocation] API responses:', {
        location: locationRes.status,
        weather: weatherRes.status,
        air: airRes.status
      });

      if (currentGeneration !== generationCounterRef.current) {
        console.log(`⏭️ Generation #${currentGeneration} superseded - ignoring results`);
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

      // Store JWT token if returned
      if (locationData.user_id) {
        const tokenRes = await fetch('/api/auth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: locationData.user_id })
        });
        if (tokenRes.ok) {
          const { token } = await tokenRes.json();
          localStorage.setItem('vecto_auth_token', token);
        }
      }

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
  }, []);

  const refreshGPS = useCallback(async () => {
    console.log('🔄 [refreshGPS] ═══════════════════════════════════════════════');
    console.log('🔄 [refreshGPS] STARTED - User or system requested GPS refresh');
    console.log('🔄 [refreshGPS] Step 1: Setting isUpdating=true');
    setIsUpdating(true);
    setOverrideCoords(null);
    setIsLocationResolved(false); // Reset - gates queries until new location resolves

    // Clear sessionStorage - driver clicked refresh to get fresh data at staging area
    console.log('🔄 [refreshGPS] Step 2: Clearing sessionStorage and strategy');
    clearSnapshotStorage();

    // Clear old strategy
    localStorage.removeItem('vecto_persistent_strategy');
    localStorage.removeItem('vecto_strategy_snapshot_id');
    window.dispatchEvent(new CustomEvent('vecto-strategy-cleared'));

    try {
      console.log('🔄 [refreshGPS] Step 3: Calling getGeoPosition()...');
      const coords = await getGeoPosition();
      console.log('🔄 [refreshGPS] Step 4: getGeoPosition returned:', coords ? `${coords.latitude}, ${coords.longitude}` : 'NULL');

      if (coords) {
        console.log('🔄 [refreshGPS] Step 5: Setting currentCoords state');
        setCurrentCoords({ latitude: coords.latitude, longitude: coords.longitude });
        console.log('🔄 [refreshGPS] Step 6: Calling enrichLocation()...');
        await enrichLocation(coords.latitude, coords.longitude, coords.accuracy);
        console.log('🔄 [refreshGPS] Step 7: enrichLocation() completed');
      } else {
        // GPS failed - try IP-based fallback for development/preview environments
        console.warn('🔄 [refreshGPS] ⚠️ GPS failed, trying IP fallback...');
        try {
          const ipRes = await fetch('/api/location/ip');
          if (ipRes.ok) {
            const ipData = await ipRes.json();
            if (ipData.latitude && ipData.longitude) {
              console.log('🔄 [refreshGPS] ✅ IP fallback succeeded:', ipData.city, ipData.state);
              setCurrentCoords({ latitude: ipData.latitude, longitude: ipData.longitude });
              await enrichLocation(ipData.latitude, ipData.longitude, 5000); // Low accuracy for IP
              return;
            }
          }
        } catch (ipErr) {
          console.warn('🔄 [refreshGPS] IP fallback also failed:', ipErr);
        }
        // Both GPS and IP failed
        console.error('🔄 [refreshGPS] ❌ Both GPS and IP fallback failed');
        setCurrentLocationString('Location unavailable - check device settings');
      }
    } catch (err) {
      console.error('🔄 [refreshGPS] ❌ EXCEPTION:', err);
    } finally {
      console.log('🔄 [refreshGPS] Step FINAL: Setting isUpdating=false');
      setIsUpdating(false);
      console.log('🔄 [refreshGPS] ═══════════════════════════════════════════════');
    }
  }, [enrichLocation]);

  // Initial GPS fetch on mount - but skip if we restored from sessionStorage
  useEffect(() => {
    console.log('🚀 [LocationContext] Mount effect triggered');
    console.log('🚀 [LocationContext] Current state:', { lastSnapshotId, currentCoords, isUpdating });

    // Wait a tick to allow sessionStorage restore to complete first
    const timer = setTimeout(() => {
      console.log('🚀 [LocationContext] Timer fired, checking if GPS needed...');
      console.log('🚀 [LocationContext] lastSnapshotId:', lastSnapshotId);
      console.log('🚀 [LocationContext] currentCoords:', currentCoords);

      // If we restored valid data from sessionStorage, skip GPS fetch
      if (lastSnapshotId && currentCoords) {
        console.log('📦 [LocationContext] Skipping GPS fetch - restored from sessionStorage');
        return;
      }
      console.log('🚀 [LocationContext] No cached data, calling refreshGPS()...');
      refreshGPS();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // Listen for snapshot ownership errors (when stale snapshot ID is rejected by server)
  // This triggers a fresh GPS fetch to create a new snapshot for the current session
  useEffect(() => {
    const handleOwnershipError = () => {
      console.warn('🚨 [LocationContext] Snapshot ownership error - clearing and refreshing');
      // Clear the stale snapshot ID
      setLastSnapshotId(null);
      // Clear sessionStorage to remove any persisted stale data
      clearSnapshotStorage();
      // Clear the coord tracking so enrichment can run again
      lastEnrichmentCoordsRef.current = null;
      // Trigger fresh GPS fetch → creates new snapshot for current session
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
