// 📦 Location Update Debounce – Phase 13 & 14: GPS Stability
// 📂 File: src/utils/shouldUpdateLocation.ts
// 👤 Owner: VectoPilot Driver Intelligence Layer
// 🔒 Prevents constant re-fetching and UI flicker

let lastCoords: { lat: number; lng: number } | null = null;
let lastUpdate = 0;
const MIN_DISTANCE_KM = 0.32; // ~0.2 miles
const MIN_TIME_MS = 3 * 60 * 1000; // 3 minutes

export const shouldUpdateLocation = (newCoords: { lat: number; lng: number }) => {
  const now = Date.now();

  const distance = lastCoords
    ? getDistanceInKm(lastCoords, newCoords)
    : MIN_DISTANCE_KM + 1;

  const enoughTime = now - lastUpdate > MIN_TIME_MS;

  if (distance > MIN_DISTANCE_KM || enoughTime) {
    lastCoords = newCoords;
    lastUpdate = now;
    return true;
  }
  return false;
};

function getDistanceInKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const R = 6371; // Earth's radius in km
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const aCalc =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(aCalc), Math.sqrt(1 - aCalc));
  return R * c;
}