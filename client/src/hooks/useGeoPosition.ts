// hooks/useGeoPosition.ts
// Phase 13: Refactored to fetch once on mount, then only on manual refresh
// Eliminates constant polling that causes UI flicker

import { useState, useEffect, useRef } from "react";

type GeoCoords = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

export const useGeoPosition = (refreshIntervalMs = 0) => {
  const [coords, setCoords] = useState<GeoCoords | null>(null);
  const [loading, setLoading] = useState(false); // Start with false to prevent initial flicker
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);
  const isFirstMount = useRef(true);
  const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  const fetchPosition = async () => {
    setLoading(true);
    setError(null);
    console.log("[useGeoPosition] Starting GPS fetch...");

    try {
      const browserPosition = await new Promise<GeoCoords | null>((resolve, reject) => {
        if (!("geolocation" in navigator)) {
          console.log("[useGeoPosition] Geolocation not available in browser");
          return resolve(null);
        }

        // Add a hard timeout in case browser hangs
        const timeoutId = setTimeout(() => {
          console.warn("[useGeoPosition] Browser GPS timed out after 8 seconds");
          resolve(null);
        }, 8000);

        console.log("[useGeoPosition] Calling getCurrentPosition...");
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            clearTimeout(timeoutId);
            console.log("✅ Browser geolocation success:", pos.coords);
            resolve({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            });
          },
          (geoError) => {
            clearTimeout(timeoutId);
            console.warn("❌ Browser location failed:", geoError.code, geoError.message);
            resolve(null);
          },
          { 
            enableHighAccuracy: true,  // Request most precise GPS
            timeout: 7000, 
            maximumAge: 0  // Don't use cached position - always get fresh coordinates
          }
        );
      });

      if (browserPosition) {
        console.log("[useGeoPosition] Got browser position:", browserPosition);
        setCoords(browserPosition);
      } else if (GOOGLE_API_KEY) {
        // Fallback: Google API but request precise location
        console.log("[useGeoPosition] Browser position failed, trying Google Geolocation API fallback...");
        const res = await fetch(
          `https://www.googleapis.com/geolocation/v1/geolocate?key=${GOOGLE_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
          }
        );

        if (!res.ok) {
          throw new Error(`Google API error: ${res.status}`);
        }

        const data = await res.json();
        if (data?.location) {
          console.log("✅ Google Geolocation API success:", data);
          setCoords({
            latitude: data.location.lat,
            longitude: data.location.lng,
            accuracy: data.accuracy,
          });
        } else {
          throw new Error("Google API did not return valid location data.");
        }
      } else {
        throw new Error("Location access denied and no Google API key available");
      }
    } catch (err: any) {
      console.error("Geo error:", err);
      setError(err.message ?? "Unknown error.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Phase 13: Only fetch once on mount, not on every render
    if (isFirstMount.current && !hasLoadedOnce.current) {
      isFirstMount.current = false;
      hasLoadedOnce.current = true;
      
      // Add a small delay to ensure DOM is ready before requesting GPS permission
      const initialTimeout = setTimeout(() => {
        console.log("[useGeoPosition] Initial GPS request after DOM ready...");
        fetchPosition();
      }, 100); // 100ms delay to ensure DOM is ready

      return () => {
        clearTimeout(initialTimeout);
      };
    }
    
    // Note: We intentionally don't set up intervals anymore to prevent UI flicker
    // Manual refresh is handled by the refresh function
  }, []); // Empty dependency array - only run once on mount

  return { coords, loading, error, refresh: fetchPosition };
};