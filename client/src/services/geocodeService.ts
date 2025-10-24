/**
 * Geocoding service - handles address lookups via backend proxy
 * SECURITY: Never expose API keys in client code - all external API calls proxied through backend
 */

export interface ReverseGeocodeResponse {
  success: boolean;
  address?: string;
  city?: string;
  state?: string;
  coordinates?: { lat: number; lng: number };
  error?: string;
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    console.log(`🔍 Reverse geocoding ${lat.toFixed(6)}, ${lng.toFixed(6)}`);

    const response = await fetch(`/api/geocode/reverse?lat=${lat}&lng=${lng}`);

    if (!response.ok) {
      console.warn(`Reverse geocoding failed: ${response.status}`);
      return null;
    }

    const data: ReverseGeocodeResponse = await response.json();

    if (!data.success || !data.address) {
      console.warn('Invalid geocoding response');
      return null;
    }

    console.log(`✅ Reverse geocoded to: ${data.address}`);
    return data.address;

  } catch (error) {
    console.warn('Reverse geocoding error:', error);
    return null;
  }
}