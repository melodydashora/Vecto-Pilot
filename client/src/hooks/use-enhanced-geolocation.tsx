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
  isHighAccuracy: boolean;
}

// Use Google Maps API for precise location detection - no hardcoded fallbacks
const getCityFromCoords = async (lat: number, lng: number): Promise<string> => {
  try {
    console.log(`🔍 Using Google Maps API for coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    const response = await fetch(`/api/location/resolve?lat=${lat}&lng=${lng}`);
    
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.location && data.location.city) {
        const locationString = `${data.location.city}, ${data.location.state}`;
        console.log(`✅ Google Maps resolved: ${locationString}`);
        return locationString;
      }
    }
    
    // Show coordinates if Google Maps fails - no hardcoded city names
    console.log(`⚠️ Google Maps failed, showing coordinates`);
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch (error) {
    console.error('Location resolution error:', error);
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
};

export function useEnhancedGeolocation(): GeolocationHook {
  const [location, setLocation] = useState<LocationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(""); // Start blank
  const [lastGpsUpdate, setLastGpsUpdate] = useState("");
  const [isHighAccuracy, setIsHighAccuracy] = useState(false);
  const isMountedRef = useRef(true);
  const attemptCountRef = useRef(0);

  useEffect(() => {
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
    attemptCountRef.current += 1;
    
    console.log(`[useGeoPosition] Starting GPS attempt ${attemptCountRef.current}...`);

    // Multi-tier GPS accuracy approach
    const highAccuracyOptions = {
      enableHighAccuracy: true,
      timeout: 15000, // 15 seconds for high accuracy
      maximumAge: 60000, // 1 minute cache for high accuracy
    };

    const lowAccuracyOptions = {
      enableHighAccuracy: false,
      timeout: 10000, // 10 seconds for network-based
      maximumAge: 300000, // 5 minutes cache for network-based
    };

    // Try high accuracy GPS first
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (!isMountedRef.current) return;
        
        const { latitude, longitude, accuracy } = position.coords;
        
        console.log(`[useGeoPosition] GPS success! Accuracy: ${accuracy?.toFixed(0)}m`);
        
        // Accept any accuracy that's better than 50km (50,000m)
        if (accuracy && accuracy > 50000) {
          console.warn(`⚠️ GPS accuracy too low: ${(accuracy / 1000).toFixed(1)}km`);
          
          // Try low accuracy fallback
          navigator.geolocation.getCurrentPosition(
            async (fallbackPosition) => {
              if (!isMountedRef.current) return;
              
              const fb = fallbackPosition.coords;
              console.log(`[useGeoPosition] Fallback GPS: ${fb.accuracy?.toFixed(0)}m accuracy`);
              
              setLocation({
                latitude: fb.latitude,
                longitude: fb.longitude,
                accuracy: fb.accuracy,
              });
              
              setIsHighAccuracy(false);
              
              try {
                const city = await getCityFromCoords(fb.latitude, fb.longitude);
                if (isMountedRef.current) {
                  setCurrentLocation(city);
                }
              } catch (error) {
                console.error('Failed to get city name:', error);
                if (isMountedRef.current) {
                  setCurrentLocation(`${fb.latitude.toFixed(4)}, ${fb.longitude.toFixed(4)}`);
                }
              }
              
              if (isMountedRef.current) {
                setLastGpsUpdate("Just now");
                setLoading(false);
              }
            },
            (fallbackErr) => {
              console.error('[useGeoPosition] Both GPS attempts failed:', fallbackErr);
              if (isMountedRef.current) {
                setError("GPS unavailable. Please enable location permissions or enter your location manually.");
                setLoading(false);
              }
            },
            lowAccuracyOptions
          );
          return;
        }
        
        setLocation({
          latitude,
          longitude,
          accuracy,
        });
        
        setIsHighAccuracy(true);
        
        try {
          const city = await getCityFromCoords(latitude, longitude);
          if (isMountedRef.current) {
            setCurrentLocation(city);
          }
        } catch (error) {
          console.error('Failed to get city name:', error);
          if (isMountedRef.current) {
            setCurrentLocation(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
          }
        }
        
        if (isMountedRef.current) {
          setLastGpsUpdate("Just now");
          setLoading(false);
        }
      },
      (err) => {
        console.warn(`[useGeoPosition] High-accuracy GPS failed:`, err.message);
        
        // Try network-based location as fallback
        navigator.geolocation.getCurrentPosition(
          async (networkPosition) => {
            if (!isMountedRef.current) return;
            
            const { latitude, longitude, accuracy } = networkPosition.coords;
            console.log(`[useGeoPosition] Network location success: ${accuracy?.toFixed(0)}m accuracy`);
            
            setLocation({
              latitude,
              longitude,
              accuracy,
            });
            
            setIsHighAccuracy(false);
            
            try {
              const city = await getCityFromCoords(latitude, longitude);
              if (isMountedRef.current) {
                setCurrentLocation(city);
              }
            } catch (error) {
              console.error('Failed to get city name:', error);
              if (isMountedRef.current) {
                setCurrentLocation(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
              }
            }
            
            if (isMountedRef.current) {
              setLastGpsUpdate("Just now");
              setLoading(false);
            }
          },
          (networkErr) => {
            let errorMessage = "Failed to get location";
            
            switch (networkErr.code) {
              case networkErr.PERMISSION_DENIED:
                errorMessage = "GPS blocked: Click the location icon in your browser's address bar → Allow location access → Refresh page";
                break;
              case networkErr.POSITION_UNAVAILABLE:
                errorMessage = "GPS signal unavailable. Try moving to an open area with better signal.";
                break;
              case networkErr.TIMEOUT:
                errorMessage = "GPS timeout. Try again or check browser location permissions.";
                break;
              default:
                errorMessage = "GPS error. Please check your browser location settings.";
            }
            
            if (isMountedRef.current) {
              setError(errorMessage);
              setLoading(false);
            }
          },
          lowAccuracyOptions
        );
      },
      highAccuracyOptions
    );
  };

  // Automatically get location on first mount
  useEffect(() => {
    getCurrentLocation();
  }, []);

  // Watch for location changes (optional)
  useEffect(() => {
    if (!navigator.geolocation || !location) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        // Only update if we get significantly better accuracy or position changed
        const newAccuracy = position.coords.accuracy || 0;
        const currentAccuracy = location.accuracy || Infinity;
        
        const distanceMoved = Math.sqrt(
          Math.pow(position.coords.latitude - location.latitude, 2) +
          Math.pow(position.coords.longitude - location.longitude, 2)
        ) * 111000; // Convert to meters approximately
        
        if (newAccuracy < currentAccuracy * 0.8 || distanceMoved > 100) {
          console.log(`[useGeoPosition] Location update: ${newAccuracy.toFixed(0)}m accuracy`);
          setLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        }
      },
      (err) => {
        console.warn("Location watch error:", err);
      },
      {
        enableHighAccuracy: false,
        timeout: 30000,
        maximumAge: 600000, // 10 minutes
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [location]);

  const refreshGps = getCurrentLocation;

  return {
    location,
    error,
    loading,
    currentLocation,
    lastGpsUpdate,
    getCurrentLocation,
    refreshGps,
    isHighAccuracy,
  };
}