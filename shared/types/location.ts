export type Coord = {
  lat: number;
  lng: number;
  accuracyMeters?: number | null;
  source: "gps" | "manual_city_search" | "manual_pin" | "ip" | "unknown";
};
