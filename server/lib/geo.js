import { haversineMeters } from '../utils/eta.js';

export function haversineKm(a, b) {
  return haversineMeters(a, b) / 1000;
}
