import { haversineMeters } from '../../util/eta.js';

export function haversineKm(a, b) {
  return haversineMeters(a, b) / 1000;
}

export function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  return haversineMeters({ lat: lat1, lng: lon1 }, { lat: lat2, lng: lon2 });
}

export function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  return haversineDistanceMeters(lat1, lon1, lat2, lon2) / 1000;
}

export function haversineDistanceMiles(lat1, lon1, lat2, lon2) {
  return haversineDistanceKm(lat1, lon1, lat2, lon2) * 0.621371;
}

/**
 * Great-circle miles for event filtering and home-distance context.
 * Missing coordinates return Infinity so distance filters exclude unknown locations.
 * Preserve the callers' 3958.7613-mile radius; haversineDistanceMiles above uses
 * the meter-based ETA helper and has a different radius and missing-value contract.
 */
export function haversineMiles(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
  const R = 3958.7613; // Earth radius in miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 2026-07-03 (todo #10): bearing math for the offer geography rules
// ("trip heads toward <avoid place>"). Initial great-circle bearing, 0-360° from north.
export function bearingDegrees(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1), φ2 = toRad(lat2), Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Smallest absolute difference between two bearings, 0-180°. */
export function bearingDiffDegrees(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
