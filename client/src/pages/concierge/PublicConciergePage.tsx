// client/src/pages/concierge/PublicConciergePage.tsx
// 2026-02-13: Public page for passengers who scan a driver's QR code
// 2026-04-02: Redesigned — chat-first layout. Driver info collapsed to a slim banner.
//             AskConcierge is the primary full-height experience.
// NO authentication required — uses browser GPS for location

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, MapPin, Cloud, Wind, MapPinOff, Sparkles } from 'lucide-react';
import { DriverCard } from '@/components/concierge/DriverCard';
import { AskConcierge } from '@/components/concierge/AskConcierge';
import { API_ROUTES } from '@/constants/apiRoutes';

interface DriverProfile {
  name: string;
  phone?: string | null;
  vehicle?: {
    year: number;
    make: string;
    model: string;
    seatbelts: number;
  } | null;
}

interface WeatherData {
  temp: number;
  conditions: string;
}

interface AirQualityData {
  aqi: number;
  category: string;
}

export default function PublicConciergePage() {
  const { token } = useParams<{ token: string }>();

  // State
  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [driverError, setDriverError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationString, setLocationString] = useState('Getting location...');
  const [locationError, setLocationError] = useState(false);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [airQuality, setAirQuality] = useState<AirQualityData | null>(null);
  const [isLoadingDriver, setIsLoadingDriver] = useState(true);
  const [showDriverDetails, setShowDriverDetails] = useState(false);

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Fetch driver profile
  useEffect(() => {
    if (!token) return;

    fetch(API_ROUTES.CONCIERGE.PUBLIC_PROFILE(token))
      .then(res => res.json())
      .then(data => {
        if (data.ok && data.driver) {
          setDriver(data.driver);
        } else {
          setDriverError(data.error || 'Driver not found');
        }
      })
      .catch(() => setDriverError('Failed to load driver info'))
      .finally(() => setIsLoadingDriver(false));
  }, [token]);

  // Request browser GPS
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationError(true);
      setLocationString('Location not supported');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setCoords({ lat: latitude, lng: longitude });
        setLocationString(`${latitude.toFixed(4)}°N, ${Math.abs(longitude).toFixed(4)}°W`);
      },
      () => {
        setLocationError(true);
        setLocationString('Location access denied');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  // Fetch weather once we have coords
  useEffect(() => {
    if (!coords || !token) return;

    fetch(API_ROUTES.CONCIERGE.PUBLIC_WEATHER(token, coords.lat, coords.lng))
      .then(res => res.json())
      .then(data => {
        if (data.weather?.available) {
          setWeather({
            temp: data.weather.tempF,
            conditions: data.weather.conditions,
          });
        }
        if (data.airQuality) {
          setAirQuality(data.airQuality);
        }
      })
      .catch(() => {
        // Weather is optional — don't block the page
      });
  }, [coords, token]);

  // Try to reverse geocode for a nicer location string
  useEffect(() => {
    if (!coords) return;

    const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!MAPS_KEY) return;

    fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${coords.lat},${coords.lng}&key=${MAPS_KEY}&result_type=locality|sublocality`)
      .then(res => res.json())
      .then(data => {
        if (data.results?.[0]) {
          const components = data.results[0].address_components;
          const city = components?.find((c: { types: string[] }) => c.types.includes('locality'))?.long_name;
          const state = components?.find((c: { types: string[] }) => c.types.includes('administrative_area_level_1'))?.short_name;
          if (city && state) {
            setLocationString(`${city}, ${state}`);
          }
        }
      })
      .catch(() => {
        // Keep the coords-based string
      });
  }, [coords]);

  // Loading state
  if (isLoadingDriver) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
      </div>
    );
  }

  // Driver not found
  if (driverError) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950 p-4">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-white mb-2">Link Not Found</h2>
          <p className="text-slate-400">{driverError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* ═══ GRADIENT HEADER BAR (matches Coach styling) ═══ */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="flex items-center justify-center h-9 w-9 rounded-full bg-white/20 flex-shrink-0">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-sm text-white">Concierge</h1>
            <p className="text-xs text-white/70">Powered by Vecto</p>
          </div>
          {driver && (
            <button
              onClick={() => setShowDriverDetails(!showDriverDetails)}
              className="flex items-center gap-2 hover:bg-white/10 rounded-full pl-3 pr-1.5 py-1 transition-colors"
            >
              <span className="text-sm text-white/90 font-medium truncate max-w-[120px]">{driver.name}</span>
              <div className="h-7 w-7 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-white">
                  {driver.name.charAt(0).toUpperCase()}
                </span>
              </div>
            </button>
          )}
        </div>
      </div>

      {/* ═══ CONTEXT BAR: weather + location (slim secondary strip) ═══ */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-1.5">
        <div className="max-w-lg mx-auto flex items-center justify-center gap-4 text-[11px] text-slate-500">
          {weather && (
            <span className="flex items-center gap-1">
              <Cloud className="h-3 w-3" />
              {weather.temp}°F
            </span>
          )}
          {airQuality && (
            <span className="flex items-center gap-1">
              <Wind className="h-3 w-3" />
              AQI {airQuality.aqi}
            </span>
          )}
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            <span className="truncate max-w-[140px]">{locationString}</span>
          </span>
        </div>
      </div>

      {/* ═══ DRIVER DETAILS (expandable from header avatar tap) ═══ */}
      {driver && showDriverDetails && (
        <div className="bg-slate-900/50 border-b border-slate-800">
          <div className="max-w-lg mx-auto px-4 py-3">
            <DriverCard
              name={driver.name}
              phone={driver.phone}
              vehicle={driver.vehicle}
              token={token}
            />
          </div>
        </div>
      )}

      {/* ═══ MAIN CONTENT: AI Concierge fills remaining space ═══ */}
      <div className="flex-1 flex flex-col max-w-lg mx-auto w-full">
        {/* Location denied message */}
        {locationError && (
          <div className="mx-4 mt-3">
            <div className="flex items-center gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <MapPinOff className="h-4 w-4 text-amber-400 flex-shrink-0" />
              <p className="text-xs text-amber-300">
                Enable location access for personalized recommendations.
              </p>
            </div>
          </div>
        )}

        {/* ═══ AI CONCIERGE ASSISTANT (primary experience, fills screen) ═══ */}
        {coords && token ? (
          <AskConcierge
            token={token}
            lat={coords.lat}
            lng={coords.lng}
            timezone={timezone}
          />
        ) : !locationError && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
              <p className="text-xs">Getting your location...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
