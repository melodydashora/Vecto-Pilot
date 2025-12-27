
export type SettingsForm = {
  userId: number;
  minEarningsPerHour?: number;
  vehicleTypes?: string[];
  noGoZones?: { name: string; coordinates: number[][] }[];
  notifications?: { surge?: boolean; earnings?: boolean; traffic?: boolean };
  preferredAreas?: string[];
  coPilotUrgency?: number;
  breakSensitivity?: number;
  enabledFeatures?: string[];
  manualLocation?: string;
  preferredHours?: string;
  rideTypes?: string[];
  baseLocation?: string;
};

export type DriverProfile = {
  userId: number;
  preferredHours?: string;
  rideTypes?: string[];
  baseLocation?: string;
  baseLatitude?: string;
  baseLongitude?: string;
};

export type EarningsData = {
  timestamp?: string | number;
  location?: string;
  latitude?: number;
  longitude?: number;
  dayOfWeek?: number;
  hourOfDay?: number;
  surgeMultiplier?: number;
  earnings?: number;
  trips?: number;
};
