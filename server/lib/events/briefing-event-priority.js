import { normalizeCoordinates } from '../../../shared/coordinates.js';
import { haversineMiles } from '../location/geo.js';

// Keep the discovery prompt's established nearby preference. This selects
// Briefing context, not a driving recommendation or a change to saved records.
export const NEARBY_EVENT_MILES = 15;

export function prioritizeBriefingEvents(events, snapshot) {
  const origin = normalizeCoordinates(snapshot?.lat, snapshot?.lng);
  return events.flatMap(event => {
    const destination = normalizeCoordinates(event.latitude, event.longitude);
    const distance = origin && destination
      ? haversineMiles(origin.lat, origin.lng, destination.lat, destination.lng) : null;
    const nearby = distance !== null && distance <= NEARBY_EVENT_MILES;
    const impact = event.impact ?? event.expected_attendance;
    // A medium draw can matter nearby. Wider-market context requires a
    // supported high-impact assessment; a category or capacity is not proof.
    if (impact !== 'high' && !(nearby && impact === 'medium')) return [];
    return [{ ...event, event_scope: nearby ? 'nearby' : 'market',
      straight_line_distance_miles: distance }];
  }).sort((a, b) => {
    const scope = Number(a.event_scope !== 'nearby') - Number(b.event_scope !== 'nearby');
    const impact = Number(b.impact === 'high' || b.expected_attendance === 'high') - Number(a.impact === 'high' || a.expected_attendance === 'high');
    const distanceA = a.straight_line_distance_miles ?? Infinity;
    const distanceB = b.straight_line_distance_miles ?? Infinity;
    return scope || impact || (distanceA === distanceB ? 0 : distanceA - distanceB);
  });
}
