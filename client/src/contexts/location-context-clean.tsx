
import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { getGeoPosition } from '@/utils/getGeoPosition';

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
}

export const LocationContext = createContext<LocationContextType | null>(null);

export const LocationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentCoords, setCurrentCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [currentLocationString, setCurrentLocationString] = useState('Getting location...');
  const [city, setCity] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [overrideCoords, setOverrideCoords] = useState<{ latitude: number; longitude: number; city?: string } | null>(null);
  const generationCounterRef = useRef(0);

  const enrichLocation = useCallback(async (lat: number, lng: number, accuracy: number) => {
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

      setCity(locationData.city);
      setState(locationData.state);
      setTimeZone(locationData.timeZone);
      setCurrentLocationString(`${locationData.city}, ${locationData.state}`);
      setLastUpdated(new Date().toISOString());

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

      // Create snapshot
      const snapshotId = crypto.randomUUID();
      const now = new Date();
      const hour = new Date(now.toLocaleString('en-US', { timeZone: locationData.timeZone })).getHours();
      const dow = new Date(now.toLocaleString('en-US', { timeZone: locationData.timeZone })).getDay();

      const snapshot = {
        snapshot_id: snapshotId,
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
          detail: { snapshotId, holiday: null, is_holiday: false }
        }));
      }
    } catch (error) {
      console.error('[LocationContext] Enrichment failed:', error);
    }
  }, []);

  const refreshGPS = useCallback(async () => {
    setIsUpdating(true);
    setOverrideCoords(null);
    
    // Clear old strategy
    localStorage.removeItem('vecto_persistent_strategy');
    localStorage.removeItem('vecto_strategy_snapshot_id');
    window.dispatchEvent(new CustomEvent('vecto-strategy-cleared'));

    try {
      const coords = await getGeoPosition();
      if (coords) {
        setCurrentCoords({ latitude: coords.latitude, longitude: coords.longitude });
        await enrichLocation(coords.latitude, coords.longitude, coords.accuracy);
      }
    } finally {
      setIsUpdating(false);
    }
  }, [enrichLocation]);

  // Initial GPS fetch on mount
  useEffect(() => {
    refreshGPS();
  }, []);

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
        overrideCoords
      }}
    >
      {children}
    </LocationContext.Provider>
  );
};
