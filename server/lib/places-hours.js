/**
 * PLACES API - Business Hours (Regular + Holiday Hours)
 * 
 * Retrieves real-time business hours including:
 * - Regular weekly schedule
 * - Holiday hours (via current_opening_hours)
 * - Open/closed status
 * 
 * Cost: Contact category billing (higher rate)
 */

const PLACE_DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

/**
 * Get business hours for a place
 * @param {string} placeId - Google Place ID
 * @returns {Promise<{openNow, weekdayText, currentHours, periods}>}
 */
export async function getPlaceHours(placeId) {
  try {
    const url = new URL(PLACE_DETAILS_URL);
    url.searchParams.set('place_id', placeId);
    url.searchParams.set('fields', 'opening_hours,current_opening_hours,name,formatted_address,geometry');
    url.searchParams.set('key', process.env.GOOGLE_MAPS_API_KEY);

    const response = await fetch(url.toString());

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Places API] Error ${response.status}: ${errorText}`);
      throw new Error(`Places API failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.status !== 'OK') {
      throw new Error(`Places API status: ${data.status}`);
    }

    const result = data.result;
    
    return {
      name: result.name,
      address: result.formatted_address || null,
      lat: result.geometry?.location?.lat || null,
      lng: result.geometry?.location?.lng || null,
      openNow: result.opening_hours?.open_now || false,
      weekdayText: result.opening_hours?.weekday_text || [],
      periods: result.opening_hours?.periods || [],
      currentHours: result.current_opening_hours?.weekday_text || null, // Holiday-adjusted hours
      hasHolidayHours: !!result.current_opening_hours
    };
  } catch (error) {
    console.error('[Places API] getPlaceHours failed:', error.message);
    throw error;
  }
}

/**
 * Search for place ID by name and location
 * @param {string} name - Business name
 * @param {Object} location - {lat, lng}
 * @returns {Promise<string>} Place ID
 */
export async function findPlaceId(name, location) {
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/findplacefromtext/json');
    url.searchParams.set('input', name);
    url.searchParams.set('inputtype', 'textquery');
    url.searchParams.set('fields', 'place_id,name');
    url.searchParams.set('locationbias', `point:${location.lat},${location.lng}`);
    url.searchParams.set('key', process.env.GOOGLE_MAPS_API_KEY);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status !== 'OK' || !data.candidates || data.candidates.length === 0) {
      throw new Error(`No place found for: ${name}`);
    }

    return data.candidates[0].place_id;
  } catch (error) {
    console.error('[Places API] findPlaceId failed:', error.message);
    throw error;
  }
}

/**
 * Check if a place is currently open
 * @param {string} placeId - Google Place ID
 * @returns {Promise<boolean>}
 */
export async function isPlaceOpen(placeId) {
  try {
    const hours = await getPlaceHours(placeId);
    return hours.openNow;
  } catch (error) {
    console.error('[Places API] isPlaceOpen failed:', error.message);
    return null; // Unknown status
  }
}

/**
 * Format hours array into concise human-readable format
 * @param {string[]} hoursArray - Array like ["Monday: 10:00 AM – 10:00 PM", ...]
 * @returns {string} - Formatted like "Mon-Sun: 11am-10pm"
 */
function formatHoursCompact(hoursArray) {
  if (!hoursArray || hoursArray.length === 0) return null;
  
  // Handle "Open 24 hours" case
  if (hoursArray[0].includes('Open 24 hours')) {
    return 'Open 24 hours';
  }
  
  // Extract day and hours
  const schedule = hoursArray.map(line => {
    const [day, hours] = line.split(': ');
    return { day, hours: hours || 'Closed' };
  });
  
  // Group consecutive days with same hours
  const groups = [];
  let currentGroup = { days: [schedule[0].day], hours: schedule[0].hours };
  
  for (let i = 1; i < schedule.length; i++) {
    if (schedule[i].hours === currentGroup.hours) {
      currentGroup.days.push(schedule[i].day);
    } else {
      groups.push(currentGroup);
      currentGroup = { days: [schedule[i].day], hours: schedule[i].hours };
    }
  }
  groups.push(currentGroup);
  
  // Format each group
  const formatted = groups.map(group => {
    const dayRange = group.days.length === 1 
      ? group.days[0].slice(0, 3) 
      : `${group.days[0].slice(0, 3)}-${group.days[group.days.length - 1].slice(0, 3)}`;
    
    // Simplify hours (remove AM/PM, use lowercase)
    const simpleHours = group.hours
      .replace(/ AM/g, 'am')
      .replace(/ PM/g, 'pm')
      .replace(':00', '')
      .replace(' – ', '-');
    
    return `${dayRange}: ${simpleHours}`;
  }).join(', ');
  
  return formatted;
}

/**
 * Get formatted hours for display
 * @param {string} placeId - Google Place ID
 * @returns {Promise<{status, hours, address}>}
 */
export async function getFormattedHours(placeId) {
  try {
    const data = await getPlaceHours(placeId);
    const hoursArray = data.currentHours || data.weekdayText;
    
    return {
      status: data.openNow ? 'open' : 'closed',
      hours: formatHoursCompact(hoursArray), // Format to concise string
      hasSpecialHours: data.hasHolidayHours,
      address: data.address,
      lat: data.lat,
      lng: data.lng
    };
  } catch (error) {
    console.error('[Places API] getFormattedHours failed:', error.message);
    return {
      status: 'unknown',
      hours: null,
      hasSpecialHours: false,
      address: null,
      lat: null,
      lng: null
    };
  }
}
