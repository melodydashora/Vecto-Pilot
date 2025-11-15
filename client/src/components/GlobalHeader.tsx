import React, { useState, useEffect, useCallback } from "react";
import { MapPin, Clock, Settings, RefreshCw, Car, Droplet, Thermometer, CloudRain, Cloud, Sun, CloudSnow, CheckCircle2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "@/contexts/location-context-clean";

// helpers (add these files from sections 2 and 3 below)
import { classifyDayPart, buildTimeContext } from "@/lib/daypart";
import {
  buildBaselinePrompt,
  type BaselineContext,
} from "@/lib/prompt/baseline";
import { createSnapshot, persistSnapshot as saveSnapshotToDB } from "@/lib/snapshot";

// Optional server endpoints this file calls:
//   POST /api/context/snapshot      -> store the snapshot (db learning)
//   GET  /api/geocode/reverse?lat=..&lng=..  -> { city, state, country }
//   GET  /api/timezone?lat=..&lng=.. -> { timeZone }  (fallbacks included)

const GlobalHeader: React.FC = () => {
  const loc = useLocation() as any;
  const { toast } = useToast();

  // state for display
  const [now, setNow] = useState<Date>(new Date());
  const [timeString, setTimeString] = useState<string>("");
  const [dayOfWeek, setDayOfWeek] = useState<string>("");
  const [timeContextLabel, setTimeContextLabel] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<number>(0);
  const [weather, setWeather] = useState<{temp: number; conditions: string; description?: string} | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [airQuality, setAirQuality] = useState<{aqi: number; category: string} | null>(null);
  const [aqLoading, setAqLoading] = useState(false);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [latestSnapshotId, setLatestSnapshotId] = useState<string | null>(null);
  const [holiday, setHoliday] = useState<string | null>(null);
  const [isHoliday, setIsHoliday] = useState(false);

  // location from context, supporting both shapes
  // PRIORITY: Use override coords if available (manual city search), otherwise use GPS
  const overrideCoords = loc?.overrideCoords ?? null;
  const gpsCoords =
    loc?.currentCoords ??
    loc?.location?.currentCoords ??
    (loc?.latitude && loc?.longitude
      ? { latitude: loc.latitude, longitude: loc.longitude }
      : null);
  
  const coords = overrideCoords || gpsCoords;

  const currentLocationString =
    overrideCoords?.city ?? loc?.currentLocationString ?? loc?.location?.currentLocationString ?? "";

  // Header is "resolved" as soon as we have coords + city (don't wait for weather/AQ/events)
  const isLocationResolved = Boolean(
    coords?.latitude && 
    coords?.longitude && 
    currentLocationString && 
    currentLocationString !== "Getting location..." && 
    currentLocationString !== "Detecting..."
  );
  const refreshGPS: undefined | (() => Promise<void>) =
    loc?.refreshGPS ?? loc?.location?.refreshGPS;

  const isUpdating: boolean = Boolean(
    loc?.isUpdating ?? loc?.location?.isUpdating,
  );

  const lastUpdatedRaw = loc?.lastUpdated ?? loc?.location?.lastUpdated ?? null;
  const lastUpdated: Date | null = lastUpdatedRaw
    ? new Date(lastUpdatedRaw)
    : null;

  // We tick the on-screen clock every second for UX,
  // but we only WRITE a snapshot to the DB on app open and manual refresh.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Listen for snapshot saved event to update indicator
  useEffect(() => {
    const handleSnapshotSaved = (e: Event) => {
      const customEvent = e as CustomEvent;
      const snapshotId = customEvent.detail?.snapshotId;
      if (snapshotId) {
        setSnapshotReady(true);
        setLatestSnapshotId(snapshotId);
      }
    };
    window.addEventListener("vecto-snapshot-saved", handleSnapshotSaved as EventListener);
    return () => window.removeEventListener("vecto-snapshot-saved", handleSnapshotSaved as EventListener);
  }, []);


  // Compute local time fields for display with timezone
  useEffect(() => {
    const tz = loc?.timeZone || loc?.location?.timeZone;
    
    // Only pass timeZone if we have it, otherwise use browser's local timezone
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      ...(tz && { timeZone: tz }),
    });
    const dayFmt = new Intl.DateTimeFormat("en-US", { 
      weekday: "long",
      ...(tz && { timeZone: tz }),
    });

    setTimeString(formatter.format(now));
    const day = dayFmt.format(now);
    const { label } = classifyDayPart(now, tz);
    
    // Just show day and context label separately (avoid duplicate)
    setDayOfWeek(day);
    setTimeContextLabel(label);
  }, [now, loc?.timeZone, loc?.location?.timeZone]);

  // ---- helpers -------------------------------------------------------------

  const timeAgo = (d: Date) => {
    const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin === 1) return "1m ago";
    if (diffMin < 60) return `${diffMin}m ago`;
    const h = Math.floor(diffMin / 60);
    return h === 1 ? "1h ago" : `${h}h ago`;
  };

  const formatLocation = () => {
    // Prioritize showing the resolved city name over coordinates
    if (currentLocationString && currentLocationString !== "Getting location..." && currentLocationString !== "Detecting...") {
      return currentLocationString;
    }
    // Fall back to coordinates if city name not yet resolved
    if (coords?.latitude != null && coords?.longitude != null) {
      return `${Number(coords.latitude).toFixed(3)}, ${Number(
        coords.longitude,
      ).toFixed(3)}`;
    }
    return "Detecting...";
  };

  const getAqiIndicator = (aqi: number) => {
    // EPA Air Quality Index colors
    if (aqi <= 50) return { emoji: '🟢', color: 'text-green-300', label: 'Good' };
    if (aqi <= 100) return { emoji: '🟡', color: 'text-yellow-300', label: 'Moderate' };
    if (aqi <= 150) return { emoji: '🟠', color: 'text-orange-300', label: 'Unhealthy for Sensitive' };
    if (aqi <= 200) return { emoji: '🔴', color: 'text-red-300', label: 'Unhealthy' };
    if (aqi <= 300) return { emoji: '🟣', color: 'text-purple-300', label: 'Very Unhealthy' };
    return { emoji: '🟤', color: 'text-red-500', label: 'Hazardous' };
  };

  // Reverse geocode and timezone fetch (server preferred; fallbacks included)
  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const res = await fetch(`/api/geocode/reverse?lat=${lat}&lng=${lng}`, {
        credentials: "include",
      });
      if (res.ok)
        return (await res.json()) as {
          city?: string;
          state?: string;
          country?: string;
          formattedAddress?: string;  // Full street address
        };
    } catch (err) {
      console.error('[GlobalHeader] Reverse geocode failed:', err);
    }
    return {};
  };

  const getTimezone = async (lat: number, lng: number) => {
    try {
      const res = await fetch(`/api/timezone?lat=${lat}&lng=${lng}`, {
        credentials: "include",
      });
      if (res.ok) return (await res.json()) as { timeZone?: string };
    } catch (err) {
      console.error('[GlobalHeader] Timezone fetch failed:', err);
    }
    return { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  };

  const getWeather = async (lat: number, lng: number) => {
    setWeatherLoading(true);
    try {
      const res = await fetch(`/api/location/weather?lat=${lat}&lng=${lng}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.available) {
          setWeather({ 
            temp: data.temperature, 
            conditions: data.conditions,
            description: data.description 
          });
          return data;
        }
      }
    } catch {
      // Weather is optional, don't fail the snapshot
    } finally {
      setWeatherLoading(false);
    }
    return null;
  };

  const getAirQuality = async (lat: number, lng: number) => {
    setAqLoading(true);
    try {
      const res = await fetch(`/api/location/airquality?lat=${lat}&lng=${lng}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.available) {
          setAirQuality({ 
            aqi: data.aqi, 
            category: data.category 
          });
          return {
            aqi: data.aqi,
            category: data.category,
            dominantPollutant: data.dominantPollutant,
            healthRecommendations: data.healthRecommendations,
          };
        }
      }
    } catch {
      // Air quality is optional, don't fail the snapshot
    } finally {
      setAqLoading(false);
    }
    return null;
  };

  const persistSnapshot = async (payload: BaselineContext) => {
    // CRITICAL: Only persist snapshot if city is resolved (prevents "Unknown" city drift)
    if (!payload.geo.city || payload.geo.city === 'Unknown') {
      console.log('⏳ Skipping snapshot - waiting for city to resolve');
      return;
    }
    
    // Debug: Check dayPartKey
    console.log('🔍 payload.time:', payload.time);
    
    // Save snapshot in new ML format (SnapshotV1)
    try {
      const snapshotV1 = createSnapshot({
        coord: {
          lat: payload.coords.lat,
          lng: payload.coords.lng,
          accuracyMeters: null,
          source: overrideCoords ? 'manual_city_search' : 'gps',
        },
        resolved: {
          city: payload.geo.city,
          state: payload.geo.state,
          country: payload.geo.country,
          timezone: payload.time.timeZone,
          formattedAddress: payload.geo.formattedAddress,  // Full street address
        },
        timeContext: {
          local_iso: new Date().toISOString(),
          dow: new Date(new Date().toLocaleString('en-US', { timeZone: payload.time.timeZone })).getDay(),
          hour: new Date(new Date().toLocaleString('en-US', { timeZone: payload.time.timeZone })).getHours(),
          is_weekend: payload.time.isWeekend,
          day_part_key: payload.time.dayPartKey as any,
        },
        weather: payload.weather ? {
          tempF: payload.weather.temperature,
          conditions: payload.weather.conditions,
          description: payload.weather.description ?? null,
        } : undefined,
        air: payload.airQuality ? {
          aqi: payload.airQuality.aqi,
          category: payload.airQuality.category,
        } : undefined,
      });

      // Save to database and get snapshot_id
      const resp = await saveSnapshotToDB(snapshotV1);
      const snapshotId = resp?.snapshot_id ?? null;
      
      // Emit event for Co-Pilot to gate /api/blocks query
      if (snapshotId) {
        window.dispatchEvent(
          new CustomEvent("vecto-snapshot-saved", {
            detail: {
              snapshotId,
              lat: payload.coords.lat,
              lng: payload.coords.lng,
            },
          })
        );
        console.log("📸 Snapshot saved with ID:", snapshotId);
      }
      
      // Emit legacy event for downstream components (Smart Blocks, etc.)
      window.dispatchEvent(
        new CustomEvent("vecto-context-updated", {
          detail: {
            lat: payload.coords.lat,
            lng: payload.coords.lng,
            city: payload.geo.city,
            state: payload.geo.state,
            timeZone: payload.time.timeZone,
            dayPartKey: payload.time.dayPartKey,
            weekday: payload.time.dayOfWeek,
          },
        })
      );
    } catch {
      // ignore; keep app snappy
    }
  };

  const buildAndSaveSnapshot = useCallback(
    async (reason: "app_open" | "manual_refresh") => {
      // Use freshest coords we have (context already handles the GNSS permission flow)
      const lat =
        coords?.latitude ??
        loc?.latitude ??
        loc?.location?.currentCoords?.latitude;
      const lng =
        coords?.longitude ??
        loc?.longitude ??
        loc?.location?.currentCoords?.longitude;

      if (lat == null || lng == null) return;

      const [{ city, state, country, formattedAddress }, { timeZone }, weather, airQualityData] = await Promise.all([
        reverseGeocode(lat, lng),
        getTimezone(lat, lng),
        getWeather(lat, lng),
        getAirQuality(lat, lng),
      ]);

      // Compute *local* time context using the tz we just looked up
      const tCtx = buildTimeContext(timeZone);

      const snapshot: BaselineContext = {
        reason, // "app_open" | "manual_refresh"
        timestampIso: new Date().toISOString(),
        coords: { lat, lng },
        geo: { city, state, country, formattedAddress },
        time: tCtx,
        weather: weather ? {
          temperature: weather.temperature,
          feelsLike: weather.feelsLike,
          conditions: weather.conditions,
          description: weather.description,
          humidity: weather.humidity,
          windSpeed: weather.windSpeed,
          precipitation: weather.precipitation,
        } : undefined,
        airQuality: airQualityData ? {
          aqi: airQualityData.aqi,
          category: airQualityData.category,
          dominantPollutant: airQualityData.dominantPollutant,
          healthRecommendations: airQualityData.healthRecommendations,
        } : undefined,
        // room for header-level profile details if you fetch them here:
        driver: undefined, // fill from /api/me if you want greeting in header
      };

      // Broadcast for any listeners (Smart Blocks, Smart Shift, etc.)
      window.dispatchEvent(
        new CustomEvent("vecto-context-snapshot", { detail: snapshot }),
      );

      // Persist for learning (future density, ML/AI, user behavior)
      persistSnapshot(snapshot);
    },
    [coords, loc],
  );

  // NOTE: Snapshot creation is now handled by location-context-clean.tsx
  // which fetches ALL data (location, weather, air quality) in parallel
  // and saves a complete snapshot to the DB. This prevents duplicate API calls.
  
  // Fetch weather and air quality for header display only (not for snapshot)
  useEffect(() => {
    if (coords?.latitude && coords?.longitude) {
      getWeather(coords.latitude, coords.longitude);
      getAirQuality(coords.latitude, coords.longitude);
    }
  }, [coords?.latitude, coords?.longitude]);

  const handleRefreshLocation = useCallback(async () => {
    if (!refreshGPS) return;
    
    // Throttle: ignore clicks within 10 seconds of last refresh
    const now = Date.now();
    if (now - lastRefreshTime < 10000) {
      const remaining = Math.ceil((10000 - (now - lastRefreshTime)) / 1000);
      toast({
        title: "Please wait",
        description: `You can refresh again in ${remaining} seconds.`,
      });
      return;
    }
    
    setIsRefreshing(true);
    setLastRefreshTime(now);

    // Emit manual refresh event (location context will clear strategy when coords arrive)
    window.dispatchEvent(new CustomEvent("vecto-manual-refresh"));

    try {
      await refreshGPS();

      // Location context will automatically create snapshot when GPS updates
      window.dispatchEvent(new CustomEvent("vecto-location-refreshed"));

      toast({
        title: "Location updated",
        description: "Your current location has been refreshed.",
      });
    } catch (err) {
      toast({
        title: "Location update failed",
        description: "Unable to update your location. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshGPS, toast, lastRefreshTime]);

  // DEV ONLY: Force fresh session for testing
  const handleForceFreshSession = useCallback(() => {
    console.log("🧹 [DEV] Forcing fresh session - clearing all localStorage");
    
    // Clear all localStorage
    localStorage.clear();
    
    toast({
      title: "Fresh session initiated",
      description: "All data cleared. Reloading...",
    });
    
    // Reload page to trigger fresh location request
    setTimeout(() => {
      window.location.reload();
    }, 500);
  }, [toast]);

  return (
    <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg">
      {/* Main Header Row */}
      <div className="px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          {/* Branding */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm">
              <Car className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                Vecto Pilot™
              </h1>
              <p className="text-sm text-white/80 font-medium">
                Strategic Rideshare Assistant
              </p>
            </div>
          </div>

          {/* Time + Settings */}
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div 
                className="text-lg font-bold font-mono tabular-nums" 
                aria-live="off" 
                aria-hidden="true"
              >
                {timeString}
              </div>
              <div className="text-xs text-white/80 flex items-center gap-2">
                <span>
                  <Clock className="inline mr-1 h-3 w-3" />
                  {dayOfWeek} {timeContextLabel}
                </span>
                {weatherLoading ? (
                  <div className="h-5 w-14 rounded-full bg-white/10 animate-pulse" aria-hidden="true" />
                ) : weather ? (
                  <span 
                    className="flex items-center gap-1 bg-white/15 rounded-full px-2 py-0.5 transition-opacity"
                    title={weather.description || `${weather.conditions}, ${weather.temp}°`}
                  >
                    {weather.conditions.toLowerCase().includes('rain') ? (
                      <CloudRain className="h-3.5 w-3.5" />
                    ) : weather.conditions.toLowerCase().includes('cloud') ? (
                      <Cloud className="h-3.5 w-3.5" />
                    ) : weather.conditions.toLowerCase().includes('snow') ? (
                      <CloudSnow className="h-3.5 w-3.5" />
                    ) : (
                      <Sun className="h-3.5 w-3.5" />
                    )}
                    <span className="font-semibold">{Math.round(weather.temp)}°</span>
                  </span>
                ) : null}
                {aqLoading ? (
                  <div className="h-5 w-16 rounded-full bg-white/10 animate-pulse" aria-hidden="true" />
                ) : airQuality ? (
                  <span 
                    className="flex items-center gap-1 bg-white/15 rounded-full px-2 py-0.5 transition-opacity"
                    title={`Air Quality: ${airQuality.category} (AQI ${airQuality.aqi})`}
                  >
                    <span>{getAqiIndicator(airQuality.aqi).emoji}</span>
                    <span className="font-semibold text-xs">AQI {airQuality.aqi}</span>
                  </span>
                ) : null}
              </div>
            </div>
            
            <Button
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/20 p-2"
              title="Settings"
              aria-label="Open settings"
              data-testid="button-settings"
            >
              <Settings className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Location Strip */}
      <div className="bg-black/10 backdrop-blur-sm border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4" />
              <span className="font-medium">{formatLocation()}</span>
              <span className="text-white/70 ml-1">
                ({lastUpdated ? timeAgo(lastUpdated) : "just now"})
              </span>
            </div>
            <div className="flex items-center gap-3">
              {/* Location Resolution Indicator - shows "complete" as soon as coords + city are available */}
              {!isLocationResolved ? (
                <div className="flex items-center gap-1.5 text-xs text-white/70">
                  <div className="w-2 h-2 bg-orange-400 rounded-full animate-pulse" />
                  <span>resolving location info...</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-green-400 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>complete</span>
                </div>
              )}
              
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefreshLocation}
                disabled={isRefreshing || !refreshGPS || isUpdating}
                className="text-white hover:bg-white/20 p-1"
                aria-label="Refresh current GPS location"
                title={
                  !refreshGPS
                    ? "Location service unavailable"
                    : isUpdating
                      ? "Updating..."
                      : "Refresh location"
                }
                data-testid="button-refresh-location"
              >
                <RefreshCw
                  className={`h-4 w-4 ${
                    isRefreshing || isUpdating ? "animate-spin" : ""
                  }`}
                />
              </Button>
              
              {/* DEV ONLY: Force fresh session button */}
              {import.meta.env.DEV && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleForceFreshSession}
                  className="text-white hover:bg-red-500/30 p-1 border border-white/20"
                  aria-label="Force fresh session (clear all data)"
                  title="DEV: Clear all localStorage and reload (simulates new user)"
                  data-testid="button-force-fresh-session"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GlobalHeader;