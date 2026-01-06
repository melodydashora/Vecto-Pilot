import React, { useState, useEffect, useCallback, useContext, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  MapPin,
  Clock,
  Settings,
  RefreshCw,
  Car,
  CloudRain,
  Cloud,
  Sun,
  CloudSnow,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { LocationContext } from "@/contexts/location-context-clean";
import { useQuery } from "@tanstack/react-query";

// helpers (add these files from sections 2 and 3 below)
import { classifyDayPart } from "@/lib/daypart";

// Optional server endpoints this file calls:
//   POST /api/context/snapshot      -> store the snapshot (db learning)
//   GET  /api/geocode/reverse?lat=..&lng=..  -> { city, state, country }
//   GET  /api/timezone?lat=..&lng=.. -> { timeZone }  (fallbacks included)

// Extended type to support legacy location context shapes (backwards compatibility)
type ExtendedLocationContext = {
  currentCoords?: { latitude: number; longitude: number } | null;
  currentLocationString?: string;
  city?: string | null;
  state?: string | null;
  timeZone?: string | null;
  isUpdating?: boolean;
  lastUpdated?: string | null;
  refreshGPS?: () => Promise<void>;
  overrideCoords?: { latitude: number; longitude: number; city?: string } | null;
  weather?: { temp: number; conditions: string; description?: string } | null;
  airQuality?: { aqi: number; category: string } | null;
  isLocationResolved?: boolean;
  lastSnapshotId?: string | null;
  isLoading?: boolean;
  setOverrideCoords?: (coords: { latitude: number; longitude: number; city?: string } | null) => void;
  // Legacy nested location shape
  location?: {
    currentCoords?: { latitude: number; longitude: number } | null;
    currentLocation?: string;
    currentLocationString?: string;
    city?: string | null;
    state?: string | null;
    timeZone?: string | null;
    isUpdating?: boolean;
    lastUpdated?: string | null;
    refreshGPS?: () => Promise<void>;
  };
  // Direct coordinate properties (another legacy shape)
  latitude?: number;
  longitude?: number;
};

/**
 * GlobalHeader - Real-time driver location and context display
 * - Polls fresh location from users table every 2 seconds
 * - Displays resolved address, time, weather, air quality
 * - Handles snapshot creation with validation gates
 * Memoized to prevent unnecessary re-renders from parent context updates
 */
const GlobalHeaderComponent: React.FC = () => {
  // CRITICAL FIX Issue #3: Removed incorrect useLocation hook and used useContext for LocationContext
  const loc = useContext(LocationContext) as ExtendedLocationContext | null;
  const { toast } = useToast();
  const navigate = useNavigate();

  // state for display
  const [now, setNow] = useState<Date>(new Date());
  const [timeString, setTimeString] = useState<string>("");
  const [dateString, setDateString] = useState<string>("");
  const [dayOfWeek, setDayOfWeek] = useState<string>("");
  const [timeContextLabel, setTimeContextLabel] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<number>(0);
  // Weather and air quality from context (fetched once in LocationContext, no duplicate calls)
  const weather = loc?.weather ?? null;
  const airQuality = loc?.airQuality ?? null;
  const [holiday, setHoliday] = useState<string | null>(null);
  const [isHoliday, setIsHoliday] = useState(false);

  // CRITICAL FIX Issue #5: Get device_id from localStorage for database query
  const deviceId =
    typeof window !== "undefined"
      ? localStorage.getItem("vecto_device_id")
      : null;

  // Query /api/auth/me for registered users only (anonymous users use snapshot ownership)
  // This is disabled for anonymous users who don't have auth tokens
  const authToken = typeof window !== "undefined" ? localStorage.getItem("vectopilot_auth_token") : null;
  const { data: dbUserLocation } = useQuery({
    queryKey: ["/api/auth/me", deviceId],
    queryFn: async () => {
      if (!deviceId || !authToken) return null;
      const res = await fetch(
        `/api/auth/me`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60000, // Keep data fresh for 1 minute
    refetchInterval: false, // DISABLED: No polling. Location updates flow through context.
    enabled: !!deviceId && !!authToken, // Only for registered users with auth token
  });

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

  // CRITICAL FIX Issue #5 & #8: PRIORITY - Use database location, then override city, then context city/state
  const currentLocationString =
    overrideCoords?.city ??
    (dbUserLocation?.ok && dbUserLocation?.city ? dbUserLocation.city : null) ??
    (loc?.city && loc?.state ? `${loc.city}, ${loc.state}` : null) ??
    (loc?.location?.city && loc?.location?.state
      ? `${loc.location.city}, ${loc.location.state}`
      : null) ??
    loc?.currentLocationString ??
    loc?.location?.currentLocation ?? // Try currentLocation (the actual state key)
    loc?.location?.currentLocationString ??
    "";

  // Debug: Log location resolution only when it changes to a resolved value
  // 2026-01-06: Reduced excessive logging by tracking previous resolved location
  const prevResolvedLocationRef = useRef<string | null>(null);
  useEffect(() => {
    // Only log when location resolves (not during "Getting location..." state)
    const isResolved = currentLocationString &&
      currentLocationString !== "Getting location..." &&
      currentLocationString !== "Detecting...";

    if (isResolved && currentLocationString !== prevResolvedLocationRef.current) {
      prevResolvedLocationRef.current = currentLocationString;
      console.log("[GlobalHeader] Location resolved:", currentLocationString);
    }
  }, [currentLocationString]);

  // Header is "resolved" as soon as we have coords + city (don't wait for weather/AQ/events)
  const isLocationResolved = Boolean(
    coords?.latitude &&
      coords?.longitude &&
      currentLocationString &&
      currentLocationString !== "Getting location..." &&
      currentLocationString !== "Detecting...",
  );
  // CRITICAL FIX Issue #3: Get refreshGPS from the correctly imported context
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

  // Listen for snapshot saved event to update indicator (and holiday info)
  useEffect(() => {
    const handleSnapshotSaved = (e: Event) => {
      const customEvent = e as CustomEvent;
      const holidayName = customEvent.detail?.holiday;
      const holidayFlag = customEvent.detail?.is_holiday;
      // Update holiday state if provided (exclude 'none' as it means no holiday)
      if (holidayName && holidayName !== 'none') {
        setHoliday(holidayName);
        setIsHoliday(true);
      } else if (holidayFlag === false || holidayName === 'none') {
        setHoliday(null);
        setIsHoliday(false);
      }
    };
    window.addEventListener(
      "vecto-snapshot-saved",
      handleSnapshotSaved as EventListener,
    );
    return () =>
      window.removeEventListener(
        "vecto-snapshot-saved",
        handleSnapshotSaved as EventListener,
      );
  }, []);

  // Compute local time fields for display with timezone
  // CRITICAL FIX Issue #5: PRIORITY database timezone over context
  useEffect(() => {
    const tz =
      dbUserLocation?.ok && dbUserLocation?.timezone
        ? dbUserLocation.timezone
        : loc?.timeZone || loc?.location?.timeZone;

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

    // Format date with timezone awareness (e.g., "Dec 17")
    const dateFmt = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      ...(tz && { timeZone: tz }),
    });

    setTimeString(formatter.format(now));
    setDateString(dateFmt.format(now));
    const day = dayFmt.format(now);
    const { label } = classifyDayPart(now, tz);

    // Just show day and context label separately (avoid duplicate)
    setDayOfWeek(day);
    setTimeContextLabel(label);
  }, [now, dbUserLocation, loc?.timeZone, loc?.location?.timeZone]);

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
    // CRITICAL FIX Issue #5: Show resolved city from database (freshest source)
    if (
      currentLocationString &&
      currentLocationString !== "Getting location..." &&
      currentLocationString !== "Detecting..."
    ) {
      // If database location, show with formatted_address for precision
      if (dbUserLocation?.ok && dbUserLocation?.formatted_address) {
        return `📍 ${dbUserLocation.formatted_address}`;
      }
      return currentLocationString;
    }
    // Show "Resolving..." instead of raw coordinates (less scary for users)
    // Coordinates are available but city/state haven't resolved yet
    if (coords?.latitude != null && coords?.longitude != null) {
      return "Resolving location...";
    }
    return "Detecting...";
  };

  const getAqiIndicator = (aqi: number) => {
    // EPA Air Quality Index colors
    if (aqi <= 50)
      return { emoji: "🟢", color: "text-green-300", label: "Good" };
    if (aqi <= 100)
      return { emoji: "🟡", color: "text-yellow-300", label: "Moderate" };
    if (aqi <= 150)
      return {
        emoji: "🟠",
        color: "text-orange-300",
        label: "Unhealthy for Sensitive",
      };
    if (aqi <= 200)
      return { emoji: "🔴", color: "text-red-300", label: "Unhealthy" };
    if (aqi <= 300)
      return { emoji: "🟣", color: "text-purple-300", label: "Very Unhealthy" };
    return { emoji: "🟤", color: "text-red-500", label: "Hazardous" };
  };

  // NOTE: Weather and air quality are fetched ONCE in location-context-clean.tsx
  // during enrichment and exposed via context. GlobalHeader reads from context only.
  // This prevents duplicate API calls and billing.

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
    } catch (_err) {
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
                  {/* Prioritize holiday name over day part label when available */}
                  {isHoliday && holiday ? (
                    <span className="text-amber-300 font-semibold">
                      {dayOfWeek}, {dateString} • {holiday}
                    </span>
                  ) : (
                    <>
                      {dayOfWeek}, {dateString} • {timeContextLabel}
                    </>
                  )}
                </span>
                {weather ? (
                  <span
                    className="flex items-center gap-1 bg-white/15 rounded-full px-2 py-0.5 transition-opacity"
                    title={
                      weather.description ||
                      `${weather.conditions}, ${weather.temp}°`
                    }
                  >
                    {weather.conditions.toLowerCase().includes("rain") ? (
                      <CloudRain className="h-3.5 w-3.5" />
                    ) : weather.conditions.toLowerCase().includes("cloud") ? (
                      <Cloud className="h-3.5 w-3.5" />
                    ) : weather.conditions.toLowerCase().includes("snow") ? (
                      <CloudSnow className="h-3.5 w-3.5" />
                    ) : (
                      <Sun className="h-3.5 w-3.5" />
                    )}
                    <span className="font-semibold">
                      {Math.round(weather.temp)}°
                    </span>
                  </span>
                ) : null}
                {airQuality ? (
                  <span
                    className="flex items-center gap-1 bg-white/15 rounded-full px-2 py-0.5 transition-opacity"
                    title={`Air Quality: ${airQuality.category} (AQI ${airQuality.aqi})`}
                  >
                    <span>{getAqiIndicator(airQuality.aqi).emoji}</span>
                    <span className="font-semibold text-xs">
                      AQI {airQuality.aqi}
                    </span>
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
              onClick={() => navigate('/co-pilot/settings')}
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
              {/* Location Resolution Indicator - shows when coords + city are available */}
              {!isLocationResolved ? (
                <div className="flex items-center gap-1.5 text-xs text-white/70">
                  <div className="w-2 h-2 bg-orange-400 rounded-full animate-pulse" />
                  <span>getting location...</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-green-400 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>location ready</span>
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

// Memoize to prevent unnecessary re-renders when parent context updates
export default React.memo(GlobalHeaderComponent);
