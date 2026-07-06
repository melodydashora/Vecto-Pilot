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
