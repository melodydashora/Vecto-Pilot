
export interface AppSettings {
  userId: number;
  manualLocation?: string;
  minEarningsPerHour?: number;
  vehicleTypes?: string[];
  homeZone?: {
    lat: number;
    lng: number;
    radius: number;
  };
  preferredAreas?: string[];
  avoidedAreas?: string[];
  workingHours?: {
    start: string;
    end: string;
  };
}

export interface Alert {
  id: string;
  title: string;
  message?: string;
  type?: 'info' | 'warning' | 'error' | 'success';
  createdAt?: string;
  dismissed?: boolean;
}

export interface LocationState {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp?: number;
  coordinates?: { lat: number; lng: number };
  address?: string;
  zone?: string;
}

export interface EarningsData {
  id?: string;
  timestamp: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  dayOfWeek?: number;
  hourOfDay?: number;
  surgeMultiplier?: number;
  earnings: number;
  trips: number;
  duration?: number;
  platform?: string;
  vehicleType?: string;
}

export interface RealSnapshotData {
  earnings: number;
  trips: number;
  hoursWorked: number;
  avgEarningsPerHour: number;
  currentSurge?: number;
  activeZone?: string;
  lastUpdate?: string;
}

// Legend component types
export type LegendItem = {
  value: string | number;
  type?: string;
  color?: string;
  payload?: any;
};

export interface LegendProps {
  payload?: LegendItem[];
  className?: string;
  label?: string;
}

// Trip form data
export type TripFormData = {
  startLocation: string;
  endLocation: string;
  fare: string;
  rideType: string;
  duration?: number;
  pickupLocation?: string;
  dropoffLocation?: string;
  notes?: string;
};
