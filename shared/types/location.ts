// 2026-01-15: Removed "unknown" source - NO FALLBACKS rule
// If we don't know where coords came from, that's a bug
export type Coord = {
  lat: number;
  lng: number;
  accuracyMeters?: number | null;
  source: "gps" | "manual_city_search" | "manual_pin" | "ip";
};
