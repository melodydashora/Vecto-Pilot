/**
 * Location Service for fetching latest driver location from database
 */

export interface LatestLocationResponse {
  success: boolean;
  location?: {
    latitude: number;
    longitude: number;
    resolvedLocation?: string;
    timestamp: string;
  };
  error?: string;
}

export async function getLatestLocationFromDB(): Promise<{ lat: number; lng: number } | null> {
  try {
    const response = await fetch('/api/location/latest');
    
    if (!response.ok) {
      console.warn('No location data available in database');
      return null;
    }
    
    const data: LatestLocationResponse = await response.json();
    
    if (!data.success || !data.location) {
      console.warn('Invalid location data received');
      return null;
    }
    
    console.log(`📍 Latest location from DB: ${data.location.latitude}, ${data.location.longitude}`);
    return {
      lat: data.location.latitude,
      lng: data.location.longitude
    };
    
  } catch (error) {
    console.warn('Failed to fetch location from database:', error);
    return null;
  }
}