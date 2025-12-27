// client/src/types/driver.ts
export interface DriverSettings {
  // keep fields optional so partial updates are easy and non-breaking
  preferredHours?: string;        // e.g. "10AM-10PM"
  rideTypes?: string[];           // e.g. ["uber_x", "comfort"]
  baseLocation?: string;          // human-readable home base
  baseLatitude?: string;          // store as string if that’s what your forms use
  baseLongitude?: string;
  vehicleTypes?: string[];        // e.g. ["car", "suv"]
  minEarningsPerHour?: number;    // target hourly minimum
  noGoZones?: string[];           // optional list of zone names/ids
}
