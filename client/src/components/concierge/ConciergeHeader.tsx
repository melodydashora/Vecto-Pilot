// client/src/components/concierge/ConciergeHeader.tsx
// 2026-02-13: Simplified version of GlobalHeader for public concierge page
// Shows location, time, weather — no auth-dependent features

import { useState, useEffect } from 'react';
import { MapPin, Cloud, Wind } from 'lucide-react';

interface ConciergeHeaderProps {
  locationString: string;
  weather: { temp: number; conditions: string } | null;
  airQuality: { aqi: number; category: string } | null;
}

export function ConciergeHeader({ locationString, weather, airQuality }: ConciergeHeaderProps) {
  const [time, setTime] = useState(new Date());

  // Ticking clock
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const timeStr = time.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const dateStr = time.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="bg-gradient-to-r from-teal-600 to-teal-700 text-white px-4 py-3 shadow-md">
      {/* Top row: branding + time */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight">Vecto Pilot</span>
          <span className="text-xs bg-teal-500/50 px-2 py-0.5 rounded-full">Concierge</span>
        </div>
        <div className="text-right">
          <span className="text-lg font-semibold tabular-nums">{timeStr}</span>
          <span className="text-xs text-teal-200 ml-2">{dateStr}</span>
        </div>
      </div>

      {/* Bottom row: location + weather */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-1.5 text-teal-100">
          <MapPin className="h-3.5 w-3.5" />
          <span className="truncate max-w-[200px]">{locationString || 'Getting location...'}</span>
        </div>
        <div className="flex items-center gap-3">
          {weather && (
            <div className="flex items-center gap-1 text-teal-100">
              <Cloud className="h-3.5 w-3.5" />
              <span>{weather.temp}°F</span>
              <span className="text-xs hidden sm:inline">{weather.conditions}</span>
            </div>
          )}
          {airQuality && (
            <div className="flex items-center gap-1 text-teal-100">
              <Wind className="h-3.5 w-3.5" />
              <span className="text-xs">AQI {airQuality.aqi}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
