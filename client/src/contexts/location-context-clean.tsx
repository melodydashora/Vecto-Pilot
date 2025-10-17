import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import { useGeoPosition } from "@/hooks/useGeoPosition";
import type { DriverSettings } from "@/types/driver";
import { buildTimeContext } from "@/lib/daypart";
import { createSnapshot } from "@/lib/snapshot";

// Simple type for no-go zones (for future implementation)
type NoGoZone = {
  id: string;
  name: string;
  reason: string;
  enabled: boolean;
};

// Simple helper - returns empty array (no default zones in clean build)
const getDefaultNoGoZones = (): NoGoZone[] => [];

interface LocationState {
  currentLocation: string;
  latitude?: number;
  longitude?: number;
  lastUpdated: Date;
  isUpdating: boolean;
  vehicleTypes: string[];
  minEarningsPerHour: number;
  noGoZones: NoGoZone[];
}

interface LocationContextType {
  location: LocationState;
  updateLocation: (newLocation: string, lat?: number, lon?: number) => void;
  refreshGPS: () => Promise<void>;
  clearLocation: () => void;
  updateVehicleTypes: (types: string[]) => void;
  updateMinEarnings: (amount: number) => void;
}

// Override coordinates for manual city search
export interface OverrideCoordinates {
  latitude: number;
  longitude: number;
  city: string;
  source: 'manual_city_search';
}

// Updated interface for LocationContext to properly type it
export interface LocationContextValue {
  isLoading: boolean;
  error: string | null;
  hasPermission: boolean | null;
  requestPermission: () => Promise<void>;

  // GPS and location data
  currentCoords: GeolocationCoordinates | null;
  currentLocationString: string;
  lastUpdated: Date | null;
  accuracy: number | null;
  location: GeolocationPosition | null;
  timeZone: string | null;

  // Override coordinates (for manual city search)
  overrideCoords: OverrideCoordinates | null;
  setOverrideCoords: (coords: OverrideCoordinates | null) => void;

  // Location session tracking
  locationSessionId: number;

  // User preferences and settings
  manualLocationOverride: string | null;
  settings: DriverSettings;
  updateSettings: (newSettings: Partial<DriverSettings>) => Promise<void>;

  // Location management
  refreshLocation: () => Promise<void>;
  refreshGPS: () => Promise<void>;
  setManualLocation: (location: string) => void;
  clearManualLocation: () => void;
  updateLocation: (location: any) => void;
  updateVehicleTypes: (types: string[]) => void;
  updateMinEarnings: (amount: number) => void;
}

const LocationContext = createContext<LocationContextValue | null>({
  // Provide default values to prevent errors during initialization
  isLoading: false,
  error: null,
  hasPermission: null,
  requestPermission: () => Promise.resolve(),
  
  // GPS and location data
  currentCoords: null,
  currentLocationString: "Getting location...",
  lastUpdated: null,
  accuracy: null,
  location: null, // GeolocationPosition | null
  timeZone: null,
  
  // Override coordinates (for manual city search)
  overrideCoords: null,
  setOverrideCoords: () => {},
  
  // Location session tracking
  locationSessionId: 0,
  
  // User preferences and settings
  manualLocationOverride: null,
  settings: {
    vehicleTypes: ["Standard"],
    minEarningsPerHour: 25,
  },
  
  // Location management functions
  refreshLocation: () => Promise.resolve(),
  refreshGPS: () => Promise.resolve(),
  setManualLocation: () => {},
  clearManualLocation: () => {},
  updateLocation: () => {},
  updateSettings: () => Promise.resolve(), // Fixed to return Promise<void>
  updateVehicleTypes: () => {},
  updateMinEarnings: () => {},
});

interface LocationProviderProps {
  children: ReactNode;
}

// Simple GPS function from attachment
const sendGPSLocation = async (): Promise<{
  success: boolean;
  data?: any;
  error?: string;
}> => {
  console.log("🎯 GPS: Starting location request...");

  if (!navigator.geolocation) {
    console.warn("Geolocation not supported");
    return { success: false, error: "Geolocation not supported" };
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        console.log(
          `✅ GPS coordinates obtained: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
        );

        // Use Google Maps API to resolve precise city name
        try {
          const response = await fetch(
            `/api/location/resolve?lat=${latitude}&lng=${longitude}`,
          );

          if (response.ok) {
            const data = await response.json();
            const cityName =
              data.city || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
            console.log(`✅ Location resolved via Google Maps: ${cityName}`);
            console.log(`🌍 Timezone received: ${data.timeZone}`);

            resolve({
              success: true,
              data: {
                city: cityName,
                latitude,
                longitude,
                timeZone: data.timeZone,
              },
            });
          } else {
            console.warn("⚠️ Google Maps API unavailable, using coordinates");
            resolve({
              success: true,
              data: {
                city: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
                latitude,
                longitude,
              },
            });
          }
        } catch (error) {
          console.warn(
            "⚠️ Location resolution failed, using coordinates:",
            error,
          );
          resolve({
            success: true,
            data: {
              city: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
              latitude,
              longitude,
            },
          });
        }
      },
      (error) => {
        console.error("GPS Error:", error);
        let errorMsg = "GPS permission required";

        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMsg = "GPS blocked - please allow location access";
            break;
          case error.POSITION_UNAVAILABLE:
            errorMsg = "GPS unavailable - check device settings";
            break;
          case error.TIMEOUT:
            errorMsg = "GPS timeout - try again";
            break;
        }

        resolve({ success: false, error: errorMsg });
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
    );
  });
};

export function LocationProvider({ children }: LocationProviderProps) {
  const [locationState, setLocationState] = useState<any>({
    // Changed to any to accommodate new structure from context value
    currentLocation: "Getting location...",
    latitude: undefined,
    longitude: undefined,
    lastUpdated: new Date(),
    isUpdating: false,
    vehicleTypes: ["Standard"],
    minEarningsPerHour: 25,
    noGoZones: getDefaultNoGoZones(),
    manualLocation: null, // Added manualLocation
    settings: {
      // Added settings object
      vehicleTypes: ["Standard"],
      minEarningsPerHour: 25,
    },
    coords: null, // Added coords
    accuracy: null, // Added accuracy
    error: null, // Added error
    isLoading: false, // Added isLoading
    hasPermission: null, // Added hasPermission
  });

  // Override coordinates state (for manual city search)
  const [overrideCoords, setOverrideCoords] = useState<OverrideCoordinates | null>(null);

  // Session ID to invalidate queries when location changes (GPS refresh or city search)
  const [locationSessionId, setLocationSessionId] = useState(0);

  // AbortController to cancel stale enrichment requests
  const enrichmentControllerRef = useRef<AbortController | null>(null);

  // Use the GPS hook without automatic refresh (0 = no interval)
  const { coords, loading, error: gpsError, refresh } = useGeoPosition(0);

  // Simplified GPS refresh function using the hook
  const refreshLocation = async () => {
    // Renamed from refreshGPS to refreshLocation for consistency
    console.log("🌐 Starting GPS refresh using useGeoPosition hook...");
    
    // GPS refresh clears override - this is the source of truth
    setOverrideCoords(null);
    console.log("🔄 GPS refresh - override coordinates cleared");
    
    setLocationState((prev: any) => ({
      ...prev,
      isUpdating: true,
      isLoading: true,
    }));

    // Use the refresh function from useGeoPosition hook
    await refresh();

    // The useEffect will handle updating the location when coords change
    console.log("✅ GPS refresh completed");
  };

  // Update location when GPS coordinates are received
  useEffect(() => {
    // Set isUpdating and isLoading to true when GPS is loading
    if (loading) {
      setLocationState((prev: any) => ({
        ...prev,
        isUpdating: true,
        isLoading: true,
        error: null, // Clear previous errors when starting a new load
      }));
      return;
    }

    if (coords) {
      console.log("[Global App] GPS coordinates received:", coords);
      
      // CLEAR OLD STRATEGY: We have new coords, about to create new snapshot
      console.log("🧹 Clearing old strategy before creating new snapshot");
      localStorage.removeItem('vecto_persistent_strategy');
      localStorage.removeItem('vecto_strategy_snapshot_id');
      window.dispatchEvent(new CustomEvent("vecto-strategy-cleared"));
      
      // Increment session ID to invalidate cached queries
      setLocationSessionId(prev => prev + 1);
      
      // Cancel any in-flight enrichment requests from previous GPS position
      if (enrichmentControllerRef.current) {
        console.log("🚫 Aborting stale enrichment request");
        enrichmentControllerRef.current.abort();
      }
      
      // Create new AbortController for this GPS position
      enrichmentControllerRef.current = new AbortController();
      const signal = enrichmentControllerRef.current.signal;
      
      setLocationState((prev: any) => ({
        ...prev,
        coords: coords, // Store the raw coords
        accuracy: coords.accuracy, // Store accuracy
        isLoading: false, // Set loading to false
        isUpdating: false, // Set updating to false
        error: null, // Clear any previous GPS errors
      }));

      // Resolve ALL context data in parallel: location, weather, and air quality
      Promise.all([
        fetch(`/api/location/resolve?lat=${coords.latitude}&lng=${coords.longitude}`, { signal }).then(r => r.json()),
        fetch(`/api/location/weather?lat=${coords.latitude}&lng=${coords.longitude}`, { signal }).then(r => r.json()).catch(() => null),
        fetch(`/api/location/airquality?lat=${coords.latitude}&lng=${coords.longitude}`, { signal }).then(r => r.json()).catch(() => null),
      ])
        .then(async ([locationData, weatherData, airQualityData]) => {
          // Format as "City, ST" if we have both city and state
          let locationName;
          if (locationData.city && locationData.state) {
            locationName = `${locationData.city}, ${locationData.state}`;
          } else if (locationData.city) {
            locationName = locationData.city;
          } else {
            locationName = `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`;
          }
          console.log("[Global App] Location resolved to:", locationName);
          console.log("[Global App] Weather:", weatherData?.available ? `${weatherData.temperature}°F` : 'unavailable');
          console.log("[Global App] Air Quality:", airQualityData?.available ? `AQI ${airQualityData.aqi}` : 'unavailable');

          // Build time context with timezone
          const timeContext = buildTimeContext(locationData.timeZone);
          
          // Build baseline context for snapshot
          const baselineContext = {
            reason: "app_open" as const,
            timestampIso: new Date().toISOString(),
            coords: { lat: coords.latitude, lng: coords.longitude },
            geo: {
              city: locationData.city,
              state: locationData.state,
              country: locationData.country,
              formattedAddress: locationData.formattedAddress,
            },
            time: timeContext,
            weather: weatherData?.available ? {
              temperature: weatherData.temperature,
              feelsLike: weatherData.feelsLike,
              conditions: weatherData.conditions,
              description: weatherData.description,
              humidity: weatherData.humidity,
              windSpeed: weatherData.windSpeed,
              precipitation: weatherData.precipitation,
            } : undefined,
            airQuality: airQualityData?.available ? {
              aqi: airQualityData.aqi,
              category: airQualityData.category,
              dominantPollutant: airQualityData.dominantPollutant,
              healthRecommendations: airQualityData.healthRecommendations,
            } : undefined,
          };

          // Build SnapshotV1 format for backend with ALL data
          const snapshotV1 = createSnapshot({
            coord: {
              lat: coords.latitude,
              lng: coords.longitude,
              accuracyMeters: coords.accuracy,
              source: 'gps' as const
            },
            resolved: {
              city: locationData.city,
              state: locationData.state,
              country: locationData.country,
              timezone: locationData.timeZone,
              formattedAddress: locationData.formattedAddress,
            },
            timeContext: (() => {
              const tz = locationData.timeZone || 'America/Chicago';
              const now = new Date();
              
              // Get day of week (0=Sunday, 6=Saturday) in the user's timezone
              const dowFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
              const dayName = dowFormatter.format(now);
              const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
              const dow = dowMap[dayName] ?? 0;
              
              // Get hour (0-23) in the user's timezone
              const hourFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false });
              const hourStr = hourFormatter.format(now);
              const hour = parseInt(hourStr, 10) || 0;
              
              return {
                local_iso: now.toISOString(),
                dow,
                hour,
                is_weekend: timeContext.isWeekend,
                day_part_key: timeContext.dayPartKey
              };
            })(),
            weather: weatherData?.available ? {
              tempF: weatherData.temperature,
              conditions: weatherData.conditions,
              description: weatherData.description,
            } : undefined,
            air: airQualityData?.available ? {
              aqi: airQualityData.aqi,
              category: airQualityData.category,
            } : undefined,
          });

          // Save context snapshot for ML/analytics
          try {
            const snapshotResponse = await fetch("/api/location/snapshot", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(snapshotV1),
              signal, // Use same AbortController to prevent stale snapshot saves
            });
            
            if (snapshotResponse.ok) {
              const snapshotData = await snapshotResponse.json();
              const snapshotId = snapshotData.snapshot_id || snapshotV1.snapshot_id;
              
              // Dispatch event to notify UI that snapshot is complete and ready
              window.dispatchEvent(
                new CustomEvent("vecto-snapshot-saved", {
                  detail: {
                    snapshotId,
                    lat: coords.latitude,
                    lng: coords.longitude,
                  },
                })
              );
              console.log("✅ Snapshot complete and ready! ID:", snapshotId);
            }
            
            // Broadcast snapshot event for other components
            window.dispatchEvent(
              new CustomEvent("vecto-context-snapshot", {
                detail: baselineContext,
              })
            );
            
            console.log("📸 Context snapshot saved:", {
              city: locationData.city,
              dayPart: timeContext.dayPartLabel,
              isWeekend: timeContext.isWeekend,
              weather: weatherData?.available ? `${weatherData.temperature}°F` : 'none',
              airQuality: airQualityData?.available ? `AQI ${airQualityData.aqi}` : 'none',
            });
          } catch (err) {
            console.warn("Failed to save context snapshot:", err);
          }

          // Update location state ONCE with both coordinates and resolved name
          setLocationState((prev: any) => ({
            ...prev,
            latitude: coords.latitude,
            longitude: coords.longitude,
            currentLocation: locationName,
            lastUpdated: new Date(),
            city: locationData.city,
            state: locationData.state,
            country: locationData.country,
            timeZone: locationData.timeZone,
            dayPart: timeContext.dayPartLabel,
          }));
        })
        .catch((err) => {
          // Don't log errors for intentional aborts (new GPS position arrived)
          if (err.name === 'AbortError') {
            console.log("⏭️ Enrichment aborted - new GPS position received");
            return;
          }
          
          console.error("[Global App] Location resolve error:", err);
          // Fall back to coordinates if resolution fails
          setLocationState((prev: any) => ({
            ...prev,
            latitude: coords.latitude,
            longitude: coords.longitude,
            currentLocation: `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`,
            lastUpdated: new Date(),
          }));
        });
    } else if (gpsError) {
      console.error("[Global App] GPS error:", gpsError);
      setLocationState((prev: any) => ({
        ...prev,
        currentLocation: "Location unavailable",
        isUpdating: false,
        isLoading: false,
        error: gpsError, // Store the GPS error
        latitude: undefined, // Clear coordinates on error
        longitude: undefined, // Clear coordinates on error
      }));
    }
  }, [coords, loading, gpsError]); // Depend on gpsError as well

  // Load saved location from localStorage and setup GPS detection
  useEffect(() => {
    const savedLocation = localStorage.getItem("rideshare-location");
    const savedNoGoZones = localStorage.getItem("driver-no-go-zones");

    let noGoZones: NoGoZone[] = getDefaultNoGoZones();
    if (savedNoGoZones) {
      try {
        const parsedZones = JSON.parse(savedNoGoZones);
        if (Array.isArray(parsedZones)) {
          if (parsedZones.length > 0 && typeof parsedZones[0] === "string") {
            noGoZones = parsedZones.map((zone: string, index: number) => ({
              id: `zone-${index}`,
              name: zone,
              reason: "User defined",
              enabled: true,
            }));
          } else if (
            parsedZones.length > 0 &&
            typeof parsedZones[0] === "object"
          ) {
            noGoZones = parsedZones;
          }
        }
      } catch (error) {
        console.error("Failed to parse saved no-go zones:", error);
      }
    }

    let initialLocationState = {
      currentLocation: "Getting location...",
      latitude: undefined,
      longitude: undefined,
      vehicleTypes: ["Standard"],
      minEarningsPerHour: 25,
      noGoZones,
      manualLocation: null,
      settings: {
        // Initialize settings
        vehicleTypes: ["Standard"],
        minEarningsPerHour: 25,
      },
      // Initialize other state properties from the context value interface
      coords: null,
      accuracy: null,
      error: null,
      isLoading: true, // Start as loading
      hasPermission: null,
    };

    if (savedLocation) {
      try {
        const parsed = JSON.parse(savedLocation);
        initialLocationState = {
          ...initialLocationState,
          vehicleTypes: parsed.vehicleTypes || ["Standard"],
          minEarningsPerHour: parsed.minEarningsPerHour || 25,
          currentLocation: parsed.currentLocation || "Getting location...",
          latitude: parsed.latitude,
          longitude: parsed.longitude,
          manualLocation: parsed.manualLocation || null,
          settings: {
            // Merge saved settings
            vehicleTypes: parsed.vehicleTypes || ["Standard"],
            minEarningsPerHour: parsed.minEarningsPerHour || 25,
          },
        };
      } catch (error) {
        console.error("Failed to parse saved location:", error);
      }
    }

    setLocationState(initialLocationState);
    refreshLocation(); // Trigger initial GPS fetch
    console.log(
      "📍 Location context initialized - Initial GPS fetch triggered",
    );

    const handleManualLocationUpdate = async (event: Event) => {
      const { location: manualLocation } = (event as CustomEvent).detail;
      console.log("📍 Manual location update received:", manualLocation);

      if (!manualLocation?.trim()) return;

      try {
        // Forward-geocode to coords
        const res = await fetch(`/api/location/resolve?query=${encodeURIComponent(manualLocation.trim())}`);
        const data = await res.json();

        // Increment session ID to invalidate cached queries
        setLocationSessionId(prev => prev + 1);
        
        // Cancel any in-flight enrichment from GPS
        if (enrichmentControllerRef.current) {
          console.log("🚫 Aborting stale enrichment request");
          enrichmentControllerRef.current.abort();
        }

        // Source of truth for override used by Header & Co-Pilot
        setOverrideCoords({
          latitude: data.latitude,
          longitude: data.longitude,
          city: data.city || manualLocation.trim(),
          source: 'manual_city_search',
        });

        // Reflect in human string for display/localStorage
        updateLocation({
          currentLocation: data.city || manualLocation.trim(),
          latitude: undefined,
          longitude: undefined,
          manualLocation: manualLocation.trim(),
        });
        console.log("✅ Manual city search - overrideCoords set:", data.city);
      } catch (error) {
        console.error("❌ Manual location geocoding failed:", error);
      }
    };

    const handleGPSPermissionGranted = (event: Event) => {
      const { latitude, longitude } = (event as CustomEvent).detail;
      console.log(
        "🎯 GPS permission granted event received:",
        latitude,
        longitude,
      );
      console.log("🔄 Updating location context with GPS coordinates...");

      // Cancel stale enrichment and create new AbortController
      if (enrichmentControllerRef.current) {
        enrichmentControllerRef.current.abort();
      }
      enrichmentControllerRef.current = new AbortController();
      const { signal } = enrichmentControllerRef.current;

      fetch(`/api/location/resolve?lat=${latitude}&lng=${longitude}`, { signal })
        .then((response) => response.json())
        .then((data) => {
          console.log("📍 Location resolved to:", data);
          const locationName =
            data.city ||
            data.address ||
            `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
          updateLocation({
            currentLocation: locationName,
            latitude,
            longitude,
            manualLocation: null,
          }); // Clear manual location on GPS update
        })
        .catch((err) => {
          console.error("Failed to resolve location name:", err);
          updateLocation({
            currentLocation: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
            latitude,
            longitude,
            manualLocation: null,
          });
        });
    };

    console.log("🔌 Setting up event listeners for location updates...");
    window.addEventListener(
      "manual-location-update",
      handleManualLocationUpdate,
    );
    window.addEventListener(
      "gps-permission-granted",
      handleGPSPermissionGranted,
    );
    console.log("✅ Event listeners registered successfully");

    return () => {
      window.removeEventListener(
        "manual-location-update",
        handleManualLocationUpdate,
      );
      window.removeEventListener(
        "gps-permission-granted",
        handleGPSPermissionGranted,
      );
    };
  }, []);

  // Save location to localStorage whenever relevant parts of locationState change
  useEffect(() => {
    localStorage.setItem(
      "rideshare-location",
      JSON.stringify({
        currentLocation: locationState.currentLocation,
        latitude: locationState.latitude,
        longitude: locationState.longitude,
        lastUpdated: locationState.lastUpdated?.toISOString() || new Date().toISOString(),
        vehicleTypes: locationState.vehicleTypes,
        minEarningsPerHour: locationState.minEarningsPerHour,
        manualLocation: locationState.manualLocation,
      }),
    );

    // Dispatch custom event to notify other components
    window.dispatchEvent(
      new CustomEvent("location-changed", {
        detail: locationState,
      }),
    );
  }, [
    locationState.currentLocation,
    locationState.latitude,
    locationState.longitude,
    locationState.lastUpdated,
    locationState.vehicleTypes,
    locationState.minEarningsPerHour,
    locationState.manualLocation,
  ]);

  const updateSettings = async (newSettings: Partial<DriverSettings>) => {
    console.log("Updating settings:", newSettings);
    setLocationState((prev: any) => {
      const updatedSettings = { ...prev.settings, ...newSettings };
      // Also update the top-level location state properties if they exist in newSettings
      const updatedLocationState = { ...prev };
      if (newSettings.vehicleTypes !== undefined) {
        updatedLocationState.vehicleTypes = newSettings.vehicleTypes;
      }
      if (newSettings.minEarningsPerHour !== undefined) {
        updatedLocationState.minEarningsPerHour =
          newSettings.minEarningsPerHour;
      }
      return {
        ...updatedLocationState,
        settings: updatedSettings,
        lastUpdated: new Date(),
      };
    });
  };

  const setManualLocation = (location: string) => {
    console.log(`📍 Setting manual location: ${location}`);
    setLocationState((prev: any) => ({
      ...prev,
      manualLocation: location,
      currentLocation: location, // Update currentLocation as well
      latitude: undefined, // Clear GPS coordinates
      longitude: undefined,
      lastUpdated: new Date(),
      isUpdating: false,
    }));
  };

  const clearManualLocation = () => {
    console.log("📍 Clearing manual location override.");
    setLocationState((prev: any) => ({
      ...prev,
      manualLocation: null,
      // Reset currentLocation to something indicative of GPS detection, or keep as is if GPS is already active
      // For now, let's keep it as is and rely on refreshLocation to get actual GPS data if available.
      lastUpdated: new Date(),
      isUpdating: false, // Ensure isUpdating is false
    }));
    refreshLocation(); // Attempt to refresh GPS after clearing manual location
  };

  const clearLocation = () => {
    console.log("Clearing location state.");
    setLocationState({
      currentLocation: "Location detection required",
      latitude: undefined,
      longitude: undefined,
      lastUpdated: new Date(),
      isUpdating: false,
      vehicleTypes: ["Standard"],
      minEarningsPerHour: 25,
      noGoZones: getDefaultNoGoZones(),
      manualLocation: null,
      settings: {
        vehicleTypes: ["Standard"],
        minEarningsPerHour: 25,
      },
      coords: null,
      accuracy: null,
      error: null,
      isLoading: false,
      hasPermission: null,
    });
  };

  const updateLocation = (locationData: any) => {
    // Accepts partial updates
    console.log("Updating location state with:", locationData);
    setLocationState((prev: any) => ({
      ...prev,
      ...locationData,
      lastUpdated: new Date(),
      isUpdating: false, // Assume update is complete
    }));
  };

  const updateVehicleTypes = (types: string[]) => {
    console.log(`🚗 Updating vehicle types: ${types.join(", ")}`);
    updateSettings({ vehicleTypes: types });
  };

  const updateMinEarnings = (amount: number) => {
    console.log(`💰 Updating minimum earnings per hour: $${amount}`);
    updateSettings({ minEarningsPerHour: amount });
  };

  const requestPermission = async () => {
    console.log("Requesting location permission...");
    setLocationState((prev: any) => ({ ...prev, isLoading: true, error: null }));
    try {
      const permissionStatus = await navigator.permissions.query({
        name: "geolocation",
      });
      if (
        permissionStatus.state === "granted" ||
        permissionStatus.state === "prompt"
      ) {
        // If granted or prompt, try to get position
        await refreshLocation();
        setLocationState((prev: any) => ({
          ...prev,
          hasPermission: permissionStatus.state === "granted",
          isLoading: false,
        }));
      } else if (permissionStatus.state === "denied") {
        console.error("Geolocation permission denied by user.");
        setLocationState((prev: any) => ({
          ...prev,
          error: "Location permission denied.",
          hasPermission: false,
          isLoading: false,
        }));
      }
      permissionStatus.onchange = async () => {
        console.log(
          `Geolocation permission state changed to: ${permissionStatus.state}`,
        );
        if (permissionStatus.state === "granted") {
          await refreshLocation();
          setLocationState((prev: any) => ({
            ...prev,
            hasPermission: true,
            isLoading: false,
          }));
        } else if (permissionStatus.state === "denied") {
          setLocationState((prev: any) => ({
            ...prev,
            error: "Location permission denied.",
            hasPermission: false,
            isLoading: false,
          }));
        }
      };
    } catch (err) {
      console.error("Error requesting location permission:", err);
      setLocationState((prev: any) => ({
        ...prev,
        error: "Failed to request location permission.",
        hasPermission: false,
        isLoading: false,
      }));
    }
  };

  const value: LocationContextValue = {
    isLoading: locationState.isLoading,
    error: locationState.error,
    hasPermission: locationState.hasPermission,
    requestPermission,

    // GPS and location data
    currentCoords: locationState.coords,
    currentLocationString: locationState.currentLocation,
    lastUpdated: locationState.lastUpdated,
    accuracy: locationState.accuracy,
    location: locationState as any,
    timeZone: locationState.timeZone,

    // Location session tracking (increments on GPS refresh or city search)
    locationSessionId,

    // Override coordinates (for manual city search)
    overrideCoords,
    setOverrideCoords: (coords: OverrideCoordinates | null) => {
      setOverrideCoords(coords);
      // Increment session ID when city search happens
      if (coords) {
        setLocationSessionId(prev => prev + 1);
      }
    },

    // User preferences and settings
    manualLocationOverride: locationState.manualLocation,
    settings: locationState.settings,
    updateSettings,

    // Location management
    refreshLocation,
    refreshGPS: refreshLocation,
    setManualLocation,
    clearManualLocation,
    updateLocation: (location: any) => {
      setLocationState((prev: any) => ({ ...prev, ...location }));
    },
    updateVehicleTypes: (types: string[]) => {
      updateSettings({ vehicleTypes: types });
    },
    updateMinEarnings: (amount: number) => {
      updateSettings({ minEarningsPerHour: amount });
    },
  };

  return (
    <LocationContext.Provider value={value}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation(): any {
  const context = useContext(LocationContext);
  if (context === undefined) {
    throw new Error("useLocation must be used within a LocationProvider");
  }
  return context as any;
}

// Custom hook for components that need to react to location changes
export function useLocationUpdates() {
  const locationContext = useLocation();
  const location = locationContext?.location;
  const [updateKey, setUpdateKey] = useState(0);

  useEffect(() => {
    const handleLocationChange = () => {
      setUpdateKey((prev) => prev + 1);
    };

    window.addEventListener("location-changed", handleLocationChange);
    return () =>
      window.removeEventListener("location-changed", handleLocationChange);
  }, []);

  return { location, updateKey };
}