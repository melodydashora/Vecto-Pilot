// client/src/pages/concierge/PublicConciergePage.tsx
// 2026-02-13: Public page for passengers who scan a driver's QR code
// Shows driver's business card, location header, event discovery, map, and concierge chat
// NO authentication required — uses browser GPS for location
// 2026-02-13: Added ConciergeMap + AskConcierge (Concierge Chat)
//             Map and chat appear after first search, both are independently viewable

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, MapPinOff, Map, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConciergeHeader } from '@/components/concierge/ConciergeHeader';
import { DriverCard } from '@/components/concierge/DriverCard';
import { EventsExplorer, VenueItem, EventItem } from '@/components/concierge/EventsExplorer';
import { ConciergeMap } from '@/components/concierge/ConciergeMap';
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

  // 2026-02-13: Shared search results for map + chat context
  const [venues, setVenues] = useState<VenueItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  // 2026-02-13: Toggle state for map and chat sections
  const [showMap, setShowMap] = useState(false);
  const [showChat, setShowChat] = useState(false);

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Callback from EventsExplorer when new search results arrive
  const handleDataLoaded = useCallback((newVenues: VenueItem[], newEvents: EventItem[]) => {
    setVenues(newVenues);
    setEvents(newEvents);
    setHasSearched(true);
  }, []);

  // Build context strings for the chat AI
  const venueContext = venues.map(v => `${v.title} (${v.type || 'venue'}) - ${v.address || 'no address'}`).join('\n');
  const eventContext = events.map(e => `${e.title} at ${e.venue || 'unknown venue'} - ${e.time || 'time TBD'} - ${e.address || 'no address'}`).join('\n');

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
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
      </div>
    );
  }

  // Driver not found
  if (driverError) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Link Not Found</h2>
          <p className="text-gray-500">{driverError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <ConciergeHeader
        locationString={locationString}
        weather={weather}
        airQuality={airQuality}
      />

      {/* Content */}
      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Driver card (with interactive star rating on public page) */}
        {driver && (
          <DriverCard
            name={driver.name}
            phone={driver.phone}
            vehicle={driver.vehicle}
            token={token}
          />
        )}

        {/* Location denied message */}
        {locationError && (
          <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <MapPinOff className="h-5 w-5 text-amber-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800">Location access needed</p>
              <p className="text-xs text-amber-600 mt-0.5">
                Enable location in your browser settings to see events near you.
              </p>
            </div>
          </div>
        )}

        {/* Events explorer (only if we have location) */}
        {coords && token && (
          <EventsExplorer
            token={token}
            lat={coords.lat}
            lng={coords.lng}
            timezone={timezone}
            onDataLoaded={handleDataLoaded}
          />
        )}

        {/* ═══ Toggle buttons for Map and Chat (appear after first search) ═══ */}
        {hasSearched && coords && token && (
          <div className="flex gap-2">
            <Button
              variant={showMap ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowMap(prev => !prev)}
              className={`flex-1 gap-1.5 ${
                showMap
                  ? 'bg-teal-600 hover:bg-teal-700 text-white'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Map className="h-3.5 w-3.5" />
              {showMap ? 'Hide Map' : 'Show Map'}
            </Button>
            <Button
              variant={showChat ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowChat(prev => !prev)}
              className={`flex-1 gap-1.5 ${
                showChat
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              {showChat ? 'Hide Chat' : 'Concierge Chat'}
            </Button>
          </div>
        )}

        {/* ═══ MAP SECTION (collapsible) ═══ */}
        {showMap && coords && (
          <div className="space-y-2">
            <ConciergeMap
              lat={coords.lat}
              lng={coords.lng}
              venues={venues}
              events={events}
            />
          </div>
        )}

        {/* ═══ CONCIERGE CHAT SECTION (collapsible) ═══ */}
        {showChat && coords && token && (
          <AskConcierge
            token={token}
            lat={coords.lat}
            lng={coords.lng}
            timezone={timezone}
            venueContext={venueContext}
            eventContext={eventContext}
          />
        )}

        {/* Bottom spacing for mobile */}
        <div className="h-8" />
      </div>
    </div>
  );
}
