
import type { DayPart } from "@/lib/daypart";

export type BaselineContext = {
  reason: "app_open" | "manual_refresh";
  timestampIso: string;
  coords: { lat: number; lng: number };
  geo: { city?: string; state?: string; country?: string; formattedAddress?: string };
  time: {
    timeZone: string;
    dayOfWeek: string;
    isWeekend: boolean;
    dayPartKey: DayPart;
    dayPartLabel: string;
    localTime: string;
  };
  weather?: {
    temperature: number;
    feelsLike: number;
    conditions: string;
    description: string;
    humidity: number;
    windSpeed: number;
    precipitation: number;
  };
  airQuality?: {
    aqi: number;
    category: string;
    dominantPollutant: string;
    healthRecommendations?: any;
  };
  driver?: {
    id?: string | number;
    name?: string;
    vehicle?: string;
    platforms?: string[]; // e.g. ["Uber","Lyft","Private"]
  };
};

export function buildBaselinePrompt(ctx: BaselineContext) {
  // This is what Pilot / Smart Shift / AI Tools can feed to the model.
  // Send precise context: day name + exact time lets model understand strategic timing
  // (e.g. "Friday 4:23 PM" = weekend excitement starting, not "weekday mindset")
  return {
    when: ctx.timestampIso,
    where: {
      lat: ctx.coords.lat,
      lng: ctx.coords.lng,
      city: ctx.geo.city,
      state: ctx.geo.state,
      country: ctx.geo.country,
      timeZone: ctx.time.timeZone,
      dayOfWeek: ctx.time.dayOfWeek,
      localTime: ctx.time.localTime,
    },
    weather: ctx.weather,
    airQuality: ctx.airQuality,
    driver: ctx.driver,
  };
}
