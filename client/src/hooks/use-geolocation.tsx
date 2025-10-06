import { useState, useEffect, useRef } from "react";

interface LocationState {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

interface GeolocationHook {
  location: LocationState | null;
  error: string | null;
  loading: boolean;
  currentLocation: string;
  lastGpsUpdate: string;
  getCurrentLocation: () => void;
  refreshGps: () => void;
}

// Use Google Maps API for precise location detection and store coordinates for ML
const getCityFromCoords = async (lat: number, lng: number): Promise<string> => {
  try {
    // Ensure API key is set for Google Maps
    if (!process.env.GOOGLE_MAPS_API_KEY) {
      console.error('Google Maps API key is not set.');
      // Fallback to raw coordinates if API key is missing
      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }

    console.log(`🔍 [PRECISION GPS] Resolving coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    // Append API key to the fetch request
    const response = await fetch(`/api/location/resolve?lat=${lat}&lng=${lng}&key=${process.env.GOOGLE_MAPS_API_KEY}`);

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.location && data.location.city) {
        const locationString = `${data.location.city}, ${data.location.state}`;
        console.log(`✅ [PRECISION GPS] Resolved to: ${locationString}`);

        // Store coordinates in database for ML training
        await storeCoordinates(lat, lng, locationString);
        return locationString;
      }
    }

    // Show coordinates if Google Maps fails - still store raw coords for ML
    console.log(`⚠️ Google Maps failed, using raw coordinates`);
    await storeCoordinates(lat, lng, `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch (error) {
    console.error('Location resolution error:', error);
    // Fallback to raw coordinates in case of any error during resolution
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
};

// Helper function to store coordinates for ML data
const storeCoordinates = async (lat: number, lng: number, resolvedLocation: string) => {
  try {
    await fetch('/api/location/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latitude: lat,
        longitude: lng,
        resolvedLocation,
        timestamp: new Date().toISOString(),
        source: 'gps' // Default source, could be refined
      })
    });
    console.log(`📊 [ML DATA] Coordinates stored for training`);
  } catch (trackError) {
    console.warn('Failed to store coordinates for ML:', trackError);
  }
};

export function useGeolocation(): GeolocationHook {
  const [location, setLocation] = useState<LocationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(""); // Start blank
  const [lastGpsUpdate, setLastGpsUpdate] = useState("");
  const isMountedRef = useRef(true);

  useEffect(() => {
    // Cleanup function to set isMountedRef to false when the component unmounts
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by this browser");
      return;
    }

    setLoading(true);
    setError(null);
    console.log("[useGeoPosition] Starting GPS fetch...");

    // Try high-accuracy GPS first with longer timeout
    const highAccuracyOptions = {
      enableHighAccuracy: true,
      timeout: 20000, // 20 seconds for high accuracy GPS
      maximumAge: 30000, // 30 seconds cache
    };

    console.log("[useGeoPosition] Attempting high-accuracy GPS for ML data collection...");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (!isMountedRef.current) return;

        const { latitude, longitude, accuracy } = position.coords;
        console.log(`[useGeoPosition] 📍 PRECISE GPS SUCCESS! Lat: ${latitude}, Lng: ${longitude}, Accuracy: ${accuracy?.toFixed(0)}m`);

        setLocation({
          latitude,
          longitude,
          accuracy,
        });

        try {
          const city = await getCityFromCoords(latitude, longitude);
          if (isMountedRef.current) {
            setCurrentLocation(city);
          }
        } catch (error) {
          console.error('Failed to get city name during high accuracy GPS:', error);
          // Fallback to raw coordinates if city resolution fails
          if (isMountedRef.current) {
            setCurrentLocation(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
          }
        }

        if (isMountedRef.current) {
          setLastGpsUpdate("Just now");
          setLoading(false);
        }
      },
      (highAccuracyError) => {
        console.warn(`[useGeoPosition] High-accuracy GPS failed: ${highAccuracyError.message}`);

        // Try network-based location as fallback
        const networkOptions = {
          enableHighAccuracy: false, // Request lower accuracy
          timeout: 15000, // 15 seconds for network-based
          maximumAge: 60000, // 1 minute cache
        };

        console.log("[useGeoPosition] Trying network-based location for ML data...");
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            if (!isMountedRef.current) return;

            const { latitude, longitude, accuracy } = position.coords;
            console.log(`[useGeoPosition] 🌐 NETWORK GPS SUCCESS! Lat: ${latitude}, Lng: ${longitude}, Accuracy: ${accuracy?.toFixed(0)}m`);

            setLocation({
              latitude,
              longitude,
              accuracy,
            });

            try {
              const city = await getCityFromCoords(latitude, longitude);
              if (isMountedRef.current) {
                setCurrentLocation(city);
                setError(null); // Clear any previous errors
              }
            } catch (error) {
              console.error('Failed to get city name during network GPS:', error);
              // Fallback to raw coordinates if city resolution fails
              if (isMountedRef.current) {
                setCurrentLocation(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
              }
            }

            if (isMountedRef.current) {
              setLastGpsUpdate("Just now");
              setLoading(false);
            }
          },
          (networkError) => {
            console.error("[useGeoPosition] All location methods failed:", networkError);

            let errorMessage = "Unable to get your location";
            // Provide user-friendly error messages based on error code
            switch (networkError.code) {
              case networkError.PERMISSION_DENIED:
                errorMessage = "GPS blocked: Please allow location access in your browser settings.";
                break;
              case networkError.POSITION_UNAVAILABLE:
                errorMessage = "GPS signal unavailable. Try moving to an open area.";
                break;
              case networkError.TIMEOUT:
                errorMessage = "GPS timeout. Please refresh the page or check your connection.";
                break;
              default:
                errorMessage = "Location error. Please check your browser location settings.";
            }

            if (isMountedRef.current) {
              setError(errorMessage);
              setLoading(false);
            }
          },
          networkOptions
        );
      },
      highAccuracyOptions
    );
  };

  // Automatically get location on first mount
  useEffect(() => {
    getCurrentLocation();
  }, []);

  // Note: The original code had a useEffect for `watchPosition`.
  // This functionality has been removed as per the provided edited code.
  // If re-adding, ensure it's necessary and correctly implemented.

  const refreshGps = getCurrentLocation;

  return {
    location,
    error,
    loading,
    currentLocation,
    lastGpsUpdate,
    getCurrentLocation,
    refreshGps,
  };
}