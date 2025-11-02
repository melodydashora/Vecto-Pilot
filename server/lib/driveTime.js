import { haversineKm } from "./geo.js";
import { predictDriveMinutesWithTraffic } from "./routes-api.js";

const BASE_KMH = {
  "America/New_York": 65,
  "America/Chicago": 70,
  "America/Los_Angeles": 60,
  "default": 65
};

function speedFor(tz, dow, hour) {
  const base = BASE_KMH[tz ?? ""] ?? BASE_KMH.default;
  let k = base;
  
  const isWeekend = dow === 6 || dow === 0;
  
  if (!isWeekend) {
    if (hour >= 7 && hour <= 9) k *= 0.65;
    if (hour >= 16 && hour <= 19) k *= 0.65;
  } else {
    k *= 1.1;
  }
  
  return Math.max(15, k);
}

/**
 * Fallback: Calculate drive time using haversine + road factor
 */
function predictDriveMinutesHaversine(user, block, ctx) {
  const straightLineKm = haversineKm(user, block);
  const roadKm = straightLineKm * 1.25; // Urban grid road factor (accounts for street layout vs straight-line distance)
  const kmh = speedFor(ctx.tz, ctx.dow, ctx.hour);
  const minutes = (roadKm / kmh) * 60;
  return Math.round(minutes);
}

/**
 * Primary: Use Routes API for traffic-aware ETAs
 * Fallback: Use haversine if Routes API fails
 */
export async function predictDriveMinutes(user, block, ctx) {
  try {
    // Try Routes API with real-time traffic
    const result = await predictDriveMinutesWithTraffic(user, block);
    return result.minutes;
  } catch (error) {
    // Fallback to haversine estimate
    console.warn('[driveTime] Routes API failed, using haversine fallback:', error.message);
    return predictDriveMinutesHaversine(user, block, ctx);
  }
}
