// 📦 GPS Manager – Phase 13 & 14: GPS Stability + Smart Block Refresh Control
// 📂 File: src/utils/gpsManager.ts
// 👤 Owner: VectoPilot Driver Intelligence Layer
// 🔒 Required to stop UI flicker and control Smart Block refreshes

import { useEffect, useState } from 'react';

export const useControlledGPS = () => {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  const fetchLocation = () => {
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setLastUpdate(Date.now());
        setLoading(false);
      },
      (err) => {
        console.error('[GPS ERROR]', err);
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Only on initial app load
  useEffect(() => {
    fetchLocation();
  }, []);

  return { coords, loading, fetchLocation, lastUpdate };
};