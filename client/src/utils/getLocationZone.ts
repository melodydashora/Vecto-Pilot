
export const getLocationZone = async (): Promise<string> => {
  try {
    // First, try to get location from localStorage (already detected)
    const storedLocation = localStorage.getItem('rideshare-last-location');
    let latitude: number | null = null;
    let longitude: number | null = null;
    
    if (storedLocation) {
      try {
        const location = JSON.parse(storedLocation);
        latitude = location.latitude;
        longitude = location.longitude;
      } catch (e) {
        console.error('Failed to parse stored location:', e);
      }
    }
    
    // If no stored location, return early with fallback
    if (!latitude || !longitude) {
      return 'Location context is currently unavailable.';
    }

    // Use coordinates only - no hardcoded zone mapping
    let zone = `lat ${latitude.toFixed(4)}, long ${longitude.toFixed(4)}`;

    // No hardcoded traffic context - use actual location data
    let trafficContext = '';

    return `User is in ${zone}.${trafficContext}`;
  } catch (error) {
    // Check if we have stored location from the location context
    const storedLocation = localStorage.getItem('rideshare-last-location');
    if (storedLocation) {
      try {
        const location = JSON.parse(storedLocation);
        return `User is near ${location.currentLocation || 'unknown location'}.`;
      } catch {
        return 'Location context is currently unavailable.';
      }
    }
    return 'Location context is currently unavailable.';
  }
};
