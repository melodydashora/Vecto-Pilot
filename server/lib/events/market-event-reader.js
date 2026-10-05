// Shared saved-event reader for Briefing views and event moderation.
// Market membership is country + canonical market_slug, not a city/name match.
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../../db/drizzle.js';
import { discovered_events, venue_catalog, market_cities } from '../../../shared/schema.js';
import { resolveTimezoneFromMarket } from '../location/resolveTimezone.js';
import { getEventStartTime, getEventEndTime } from '../strategy/strategy-utils.js';

async function marketScope(snapshot, location = {
  city: discovered_events.city, state: discovered_events.state, country: venue_catalog.country,
}) {
  if (typeof snapshot?.country !== 'string' || !/^[A-Za-z]{2}$/.test(snapshot.country) ||
      !snapshot.city || !snapshot.state) throw new Error('Event market location is incomplete');
  const country = snapshot.country.toUpperCase();
  const market = await resolveTimezoneFromMarket(snapshot.city, snapshot.state, country);
  // A local match is still useful if the catalog has no metro mapping. It must
  // match all address dimensions; an unknown country cannot imply US.
  const local = sql`lower(${location.city}) = lower(${snapshot.city})
    AND lower(${location.state}) = lower(${snapshot.state})`;
  const metro = market?.market_slug ? sql`EXISTS (
    SELECT 1 FROM ${market_cities} mc
    WHERE mc.market_slug = ${market.market_slug} AND upper(mc.country_code) = ${country}
      AND lower(mc.city) = lower(${location.city})
      AND (lower(mc.state) = lower(${location.state}) OR lower(mc.state_abbr) = lower(${location.state}))
  )` : sql`false`;
  return { market, predicate: sql`upper(${location.country}) = ${country} AND ((${local}) OR (${metro}))` };
}

// Apply the same saved-read scope before publishing a verified candidate. No
// discovered_events insert is necessary to establish its venue's membership.
export async function venueInSnapshotMarket(venue, snapshot) {
  if (!venue?.city || !venue?.state || !/^[A-Za-z]{2}$/.test(venue.country || '')) return false;
  const { predicate } = await marketScope(snapshot, { city: sql`${venue.city}`, state: sql`${venue.state}`,
    country: sql`${venue.country}` });
  const result = await db.execute(sql`SELECT ${predicate} AS included`);
  return result.rows[0]?.included === true;
}

function shiftDate(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function eventOverlapsDisplayDays(event, today, endDate, timezone) {
  const day = { event_start_date: today, event_end_date: endDate, all_day: true };
  const windowStart = getEventStartTime(day, timezone), windowEnd = getEventEndTime(day, timezone);
  if (!windowStart || !windowEnd) throw new Error('Invalid event display window');
  const eventTimezone = Object.hasOwn(event, 'timezone') ? event.timezone : timezone;
  let start, end;
  try { start = getEventStartTime(event, eventTimezone); end = getEventEndTime(event, eventTimezone); } catch { return null; }
  if (!start || !end || end < start) return null;
  return start <= windowEnd && end >= windowStart;
}

export async function readMarketEvents(snapshot, { today, endDate = today, highValueOtherCities = false, limit = 100 } = {}) {
  const { market, predicate } = await marketScope(snapshot);
  const rows = await db.select({ event: discovered_events, venue: venue_catalog })
    .from(discovered_events).innerJoin(venue_catalog, eq(discovered_events.venue_id, venue_catalog.venue_id))
    .where(and(predicate, eq(discovered_events.is_active, true),
      // Broad calendar prefilter only: venue and viewer may be on different
      // dates. Absolute venue-local instants below decide actual overlap.
      lte(discovered_events.event_start_date, shiftDate(endDate, 2)), gte(discovered_events.event_end_date, shiftDate(today, -2)),
      highValueOtherCities ? sql`lower(${discovered_events.city}) <> lower(${snapshot.city}) AND
        ${discovered_events.expected_attendance} = 'high'` : undefined))
    .orderBy(discovered_events.event_start_date);
  let unresolvedCount = 0;
  const visible = rows.filter(row => {
    const overlaps = eventOverlapsDisplayDays(toBriefingEvent(row), today, endDate, snapshot.timezone);
    if (overlaps === null) unresolvedCount++;
    return overlaps === true;
  }).slice(0, limit);
  return { marketName: market?.market_name || null, rows: visible, unresolvedCount };

}

export async function eventInSnapshotMarket(eventId, snapshot) {
  if (!snapshot?.city || !snapshot?.state || !/^[A-Za-z]{2}$/.test(snapshot?.country || '')) return false;
  const { predicate } = await marketScope(snapshot);
  const rows = await db.select({ id: discovered_events.id }).from(discovered_events)
    .innerJoin(venue_catalog, eq(discovered_events.venue_id, venue_catalog.venue_id))
    .where(and(eq(discovered_events.id, eventId), predicate)).limit(1);
  return rows.length === 1;
}

export function toBriefingEvent({ event: e, venue: v }) {
  // Convert verified venue-local clock values to absolute instants. Readers can
  // retain the display clocks without reinterpreting them in the driver's zone.
  let start = null, end = null;
  if (v.timezone) {
    try { start = getEventStartTime(e, v.timezone); end = getEventEndTime(e, v.timezone); } catch { /* invalid saved zone */ }
  }
  return {
    ...e, venue: v.venue_name || e.venue_name, address: v.formatted_address || e.address,
    summary: [e.title, v.venue_name || e.venue_name, e.event_start_date, e.event_start_time].filter(Boolean).join(' • '),
    impact: e.expected_attendance === 'high' ? 'high' : e.expected_attendance === 'low' ? 'low' : e.expected_attendance === 'medium' ? 'medium' : null,
    source: 'discovered', event_type: e.category, subtype: e.category,
    location: v.formatted_address || e.address, latitude: v.lat, longitude: v.lng,
    timezone: v.timezone || null, start_time_iso: start?.toISOString() ?? '', end_time_iso: end?.toISOString() ?? '',
    capacity_info: Number.isFinite(v.capacity_estimate) ? `Capacity: ${v.capacity_estimate.toLocaleString()}` : null,
  };
}
