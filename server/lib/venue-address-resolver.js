// server/lib/venue-address-resolver.js
// Resolve venue coordinates to addresses using Google Geocoding + Places API fallback

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;

/**
 * Resolve venue coordinates to a formatted address
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {string} venueName - Venue name (used for Places search fallback)
 * @returns {Promise<string|null>} - Formatted address or null
 */
export async function resolveVenueAddress(lat, lng, venueName = null) {
  if (!lat || !lng) return null;
  
  try {
    // Step 1: Try reverse geocoding (coordinates → address)
    const geocodeUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    geocodeUrl.searchParams.set('latlng', `${lat},${lng}`);
    geocodeUrl.searchParams.set('key', GOOGLE_MAPS_API_KEY);
    
    const geocodeRes = await fetch(geocodeUrl.toString()).catch(() => null);
    if (geocodeRes?.ok) {
      const data = await geocodeRes.json();
      if (data.status === 'OK' && data.results?.[0]?.formatted_address) {
        return data.results[0].formatted_address;
      }
    }
    
    // Step 2: Fallback to Places API search if we have venue name
    if (venueName && GOOGLE_MAPS_API_KEY) {
      const placesUrl = new URL('https://maps.googleapis.com/maps/api/place/findplacefromtext/json');
      placesUrl.searchParams.set('input', venueName);
      placesUrl.searchParams.set('locationbias', `circle:5000@${lat},${lng}`); // 5km radius
      placesUrl.searchParams.set('fields', 'formatted_address,place_id');
      placesUrl.searchParams.set('key', GOOGLE_MAPS_API_KEY);
      
      const placesRes = await fetch(placesUrl.toString()).catch(() => null);
      if (placesRes?.ok) {
        const data = await placesRes.json();
        if (data.candidates?.[0]?.formatted_address) {
          return data.candidates[0].formatted_address;
        }
      }
    }
    
    return null;
  } catch (err) {
    console.warn('[venue-address-resolver] Error resolving address:', err.message);
    return null;
  }
}

/**
 * Batch resolve addresses for multiple venues (optimized for performance)
 * @param {Array} venues - Array of {lat, lng, name}
 * @returns {Promise<Object>} - Map of venue key → address
 */
export async function resolveVenueAddressesBatch(venues) {
  const results = {};
  
  // Resolve in parallel with Promise.all but limit concurrency to 5 simultaneous requests
  const chunks = [];
  for (let i = 0; i < venues.length; i += 5) {
    chunks.push(venues.slice(i, i + 5));
  }
  
  for (const chunk of chunks) {
    const promises = chunk.map(async (v) => {
      const key = `${v.lat},${v.lng}`;
      try {
        const addr = await resolveVenueAddress(v.lat, v.lng, v.name);
        return { key, addr };
      } catch (err) {
        console.warn(`[venue-resolver] Failed for ${v.name}:`, err.message);
        return { key, addr: null };
      }
    });
    
    const resolved = await Promise.all(promises);
    resolved.forEach(({ key, addr }) => {
      results[key] = addr;
    });
  }
  
  return results;
}
