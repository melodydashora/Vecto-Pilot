/* global URL, URLSearchParams */
// Directions URLs use only supplied destination evidence. Websites and bare
// venue names are not substitutes for a known destination.
// https://developers.google.com/maps/documentation/urls/get-started#directions
const text = value => typeof value === 'string' ? value.trim() : '';
const addressText = value => {
  const result = text(value);
  return !result || /^(?:https?:\/\/|unknown$|n\/?a$|unavailable$)/i.test(result) ? '' : result;
};
function coordinates({ lat, lng }) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? `${lat},${lng}` : '';
}

export function googleDirectionsUrl(options = {}) {
  const point = coordinates(options);
  const address = addressText(options.address);
  const placeId = text(options.placeId);
  const destination = point || address || (placeId ? addressText(options.name) : '');
  if (!destination) return null;
  const params = new URLSearchParams({ api: '1', destination, travelmode: 'driving', dir_action: 'navigate' });
  if (placeId) params.set('destination_place_id', placeId);
  const url = `https://www.google.com/maps/dir/?${params}`;
  return url.length <= 2048 ? url : null;
}

// Classification changes labels, never infers a destination from a website URL.
export function navigationLinkKind(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return 'website';
    if (['google.com', 'www.google.com', 'maps.google.com'].includes(url.hostname)
        && url.pathname.startsWith('/maps')) {
      return (/^\/maps\/dir(?:\/|$)/.test(url.pathname) && url.searchParams.get('api') === '1'
        && url.searchParams.get('destination')?.trim()) || url.searchParams.get('daddr')?.trim()
        ? 'directions' : 'map';
    }
    if (url.hostname === 'maps.apple.com') return url.searchParams.get('daddr')?.trim() ? 'directions' : 'map';
  } catch { /* Invalid URL is not a directions link. */ }
  return 'website';
}
