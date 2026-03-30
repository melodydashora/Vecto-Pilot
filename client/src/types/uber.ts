// Uber Integration Types

export interface UberDriverProfile {
  driver_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  picture: string;
  rating: number;
  activation_status: string;
  partner_type: string;
}

export interface UberPayment {
  payment_id: string;
  category: string;
  event_time: number;
  trip_id: string;
  amount: number;
  currency_code: string;
  breakdown: {
    other: number;
    toll: number;
    service_fee: number;
  };
}

export interface UberTrip {
  trip_id: string;
  fare: number;
  distance: number;
  duration: number;
  status: string;
  start_city: {
    latitude: number;
    longitude: number;
    display_name: string;
  };
  dropoff: { timestamp: number };
  pickup: { timestamp: number };
  vehicle_id: string;
  status_changes: Array<{
    status: string;
    timestamp: number;
  }>;
}

export interface UberAuthState {
  isConnected: boolean;
  isLoading: boolean;
  error?: string;
  profile?: UberDriverProfile;
  lastSync?: string;
}
