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
      // Check permission status first to provide better feedback
      if (navigator.permissions) {
        try {
          const permissionStatus = await navigator.permissions.query({ name: 'geolocation' });
          console.log("[useGeoPosition] Permission status:", permissionStatus.state);
          
          if (permissionStatus.state === 'denied') {
            throw new Error('Location access denied. Please enable location permission in your browser settings.');
          }
          
          // If permission is "prompt", the browser will show its native dialog when we call getCurrentPosition
          if (permissionStatus.state === 'prompt') {
            console.log("[useGeoPosition] Permission not yet granted - browser will prompt user");
          }
        } catch (permErr) {
          console.warn("[useGeoPosition] Permission API not fully supported, continuing anyway:", permErr);
        }
      }

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
            
            // Provide user-friendly error messages based on error code
            let errorMessage = 'Unable to access location';
            switch (geoError.code) {
              case geoError.PERMISSION_DENIED:
                errorMessage = 'Location access denied. Please enable location permission in your browser settings.';
                break;
              case geoError.POSITION_UNAVAILABLE:
                errorMessage = 'Location information unavailable. Please check your device settings.';
                break;
              case geoError.TIMEOUT:
                errorMessage = 'Location request timed out. Please try again.';
                break;
            }
            reject(new Error(errorMessage));
          },
          { 
            enableHighAccuracy: true,  // Request most precise GPS
            timeout: 7000, 
            maximumAge: 0  // CRITICAL: Always request fresh location, never use cached - this ensures permission prompt appears
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
    // Always request location permission on component mount (browser reopen/page refresh)
    // This ensures users are prompted for location when they first open the app
    if (isFirstMount.current && !hasLoadedOnce.current) {
      isFirstMount.current = false;
      hasLoadedOnce.current = true;
      
      // Add a small delay to ensure DOM is ready before requesting GPS permission
      // This gives the browser time to show its native permission dialog properly
      const initialTimeout = setTimeout(() => {
        console.log("[useGeoPosition] Initial GPS request - user will be prompted if permission not granted...");
        fetchPosition();
      }, 100); // 100ms delay to ensure DOM is ready

      return () => {
        clearTimeout(initialTimeout);
      };
    }
    
    // Note: We intentionally don't set up intervals anymore to prevent UI flicker
    // Manual refresh is handled by the refresh function which ALWAYS gets fresh location (maximumAge: 0)
  }, []); // Empty dependency array - only run once on mount

  return { coords, loading, error, refresh: fetchPosition };
};