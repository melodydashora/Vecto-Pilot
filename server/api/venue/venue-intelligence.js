// Independent nearby Bars/Lounges and venue traffic routes; not MAIN Strategy Venues.
import { Router } from 'express';
import { discoverNearbyVenues, getTrafficIntelligence, getSmartBlocksIntelligence } from '../../lib/venue/venue-intelligence.js';
import { toApiVenueData, toApiVenue } from '../../validation/transformers.js';
import { normalizeCoordinates } from '../../../shared/coordinates.js';
import { requireAuth } from '../../middleware/auth.js';
const router = Router();
router.use(requireAuth);

function inputs(query, defaultRadius) {
  const coordinates = normalizeCoordinates(query.lat, query.lng);
  if (!coordinates) throw new TypeError('Valid latitude and longitude are required');
  if (typeof query.city !== 'string' || !query.city.trim()) throw new TypeError('City is required');
  if (typeof query.timezone !== 'string' || !query.timezone) throw new TypeError('Timezone is required');
  try { new Intl.DateTimeFormat('en-US', { timeZone: query.timezone }); } catch { throw new TypeError('Valid IANA timezone is required'); }
  const radiusMiles = query.radius === undefined ? defaultRadius : Number(query.radius);
  if (!Number.isFinite(radiusMiles) || radiusMiles <= 0 || (query.radius !== undefined && typeof query.radius !== 'string')) {
    throw new TypeError('Radius must be a positive number of miles');
  }
  return { ...coordinates, city: query.city.trim(), state: typeof query.state === 'string' ? query.state.trim() : '', timezone: query.timezone, radiusMiles };
}
function handler(operation, radius, transform = value => value) {
  return async (req, res) => {
    let args;
    try { args = inputs(req.query, radius); }
    catch (error) { return res.status(400).json({ success: false, error: error.message }); }
    try { return res.json({ success: true, data: transform(await operation(args)) }); }
    catch { return res.status(503).json({ success: false, error: 'Venue intelligence is temporarily unavailable' }); }
  };
}
router.get('/nearby', handler(discoverNearbyVenues, 25, toApiVenueData));
router.get('/traffic', handler(getTrafficIntelligence, 5));
router.get('/smart-blocks', handler(getSmartBlocksIntelligence, 5));
router.get('/last-call', handler(discoverNearbyVenues, 5, result => ({
  query_time: result.query_time, location: result.location,
  last_call_count: result.last_call_venues.length, venues: result.last_call_venues.map(toApiVenue),
})));
export default router;
