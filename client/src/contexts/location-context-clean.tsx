
import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';

// Inline geolocation helper (previously in utils/getGeoPosition.ts)
function getGeoPosition(): Promise<{ latitude: number; longitude: number; accuracy: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      console.warn('[getGeoPosition] Geolocation not supported');
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        });
      },
      (error) => {
        console.warn('[getGeoPosition] Failed:', error.message);
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
  const generationCounterRef = useRef(0);
  const isInitialMountRef = useRef(true);
  const lastEnrichmentCoordsRef = useRef<string | null>(null);

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

    try {
      const [locationRes, weatherRes, airRes] = await Promise.all([
        fetch(`/api/location/resolve?lat=${lat}&lng=${lng}&device_id=${encodeURIComponent(deviceId)}&accuracy=${accuracy}&coord_source=gps`),
        fetch(`/api/location/weather?lat=${lat}&lng=${lng}`),
        fetch(`/api/location/airquality?lat=${lat}&lng=${lng}`)
      ]);

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
    setIsUpdating(true);
    setOverrideCoords(null);
    setIsLocationResolved(false); // Reset - gates queries until new location resolves

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

  // Initial GPS fetch on mount
  useEffect(() => {
    refreshGPS();
  }, []);

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
        isLocationResolved
      }}
    >
      {children}
    </LocationContext.Provider>
  );
};
