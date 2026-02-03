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
