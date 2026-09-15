import { latLngToCell } from 'h3-js';
import { getLocalHour, getLocalDow, getLocalDateString, getLocalIso, getDayPartKey } from '../../shared/dayparts.js';
import { coordsKey } from '../../server/lib/location/coords-key.js';

// Synthetic fixture only. Use createdAt/timezone/lat/lng options to derive a
// coherent row; remaining overrides let a test deliberately corrupt one field.
export function completeSnapshot({ timezone = 'America/New_York', lat = 0, lng = 0, createdAt = '2026-09-13T04:00:00.000Z', ...overrides } = {}) {
  const created = new Date(createdAt);
  const hour = getLocalHour(created, timezone);
  return {
    snapshot_id: '00000000-0000-4000-8000-000000000001', user_id: '00000000-0000-4000-8000-000000000002',
    session_id: '00000000-0000-4000-8000-000000000003', created_at: created, lat, lng,
    coord_key: coordsKey(lat, lng), h3_r8: latLngToCell(lat, lng, 8),
    city: 'Fixture city', state: 'Fixture region', country: 'Fixture country', market: 'Fixture current market',
    formatted_address: 'Fixture resolved address', timezone, date: getLocalDateString(created, timezone),
    local_iso: new Date(`${getLocalIso(created, timezone)}Z`), hour, dow: getLocalDow(created, timezone),
    day_part_key: getDayPartKey(hour), weather: { tempF: 0, conditions: 'Clear', source: {
      provider: 'google-weather', coord_key: coordsKey(lat, lng), fetched_at: created.toISOString(), observed_at: created.toISOString(),
    } },
    air: { aqi: 0, category: 'Good', source: {
      provider: 'google-air-quality', coord_key: coordsKey(lat, lng), fetched_at: created.toISOString(), observed_at: created.toISOString(),
    } }, permissions: { geolocation: 'granted' }, status: 'ok',
    ...overrides,
  };
}
