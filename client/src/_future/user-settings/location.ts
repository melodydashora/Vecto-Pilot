export interface LocationResult {
  city: string;
  state: string;
  country: string;
  formattedAddress: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  accuracy: 'precise' | 'approximate' | 'fallback';
}

export interface Location {
  city: string;
  state: string;
  zip?: string;
  lat: number;
  lng: number;
  source: 'GPS' | 'Uber' | 'LastTrip' | 'Manual';
}