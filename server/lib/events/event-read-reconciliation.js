// Presentation only: original discovery rows and their storage identities stay intact.
// No fuzzy title containment, venue-name fallback, or time-window matching belongs here.

function textKey(value) {
  return typeof value === 'string'
    ? value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
    : '';
}

function timeKey(value) {
  const match = textKey(value).match(/^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23)) return null;
  if (match[3]) hour = hour % 12 + (match[3] === 'pm' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function venueKey(event) {
  // A discovered-event ID identifies a report, never its venue. Names/addresses alone
  // are not proof of a resolved venue (legacy snapshots without IDs remain separate).
  if (typeof event.venue_id === 'string' && event.venue_id.trim()) return `venue:${event.venue_id}`;
  const placeId = event.place_id || event.vc_place_id;
  return typeof placeId === 'string' && placeId.trim() ? `place:${placeId}` : null;
}

function slotKey(event) {
  const venue = venueKey(event);
  const start = event.event_start_date;
  const end = event.event_end_date || start;
  const time = timeKey(event.event_start_time);
  if (!venue || !/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '') || !time) return null;
  return JSON.stringify([venue, start, end, time]);
}

function concertParts(event) {
  const category = textKey(event.subtype || event.event_type || event.category);
  if (!/^(concerts?|music|live music)$/.test(category)) return null;
  const parts = String(event.title || '').split(':');
  if (parts.length !== 2 || parts.filter(part => part.includes(',')).length > 1) return null;
  const normalized = parts.map(part => {
    const [first, ...support] = part.split(',');
    return { name: textKey(first), support: support.map(textKey).filter(Boolean).join(',') };
  });
  if (normalized.some(part => part.name.length < 3)) return null;
  // Only exact colon-segment reversal and an omitted comma-delimited supporting
  // lineup are accepted. Different explicit lineups cannot bridge through a short title.
  return normalized.sort((a, b) => a.name.localeCompare(b.name));
}

function sameTitle(a, b) {
  const title = textKey(a.title);
  if (title && title === textKey(b.title)) return true;
  const left = concertParts(a);
  const right = concertParts(b);
  return !!(left && right && left.every((part, index) =>
    part.name === right[index].name &&
    (!part.support || !right[index].support || part.support === right[index].support)));
}

function projectGroup(group) {
  if (group.length === 1) return { ...group[0].event };
  const variants = group.map(({ event }) => ({ ...event }));
  const ends = new Set(variants.map(event => timeKey(event.event_end_time)));
  const event = {
    ...group[0].event,
    event_variants: variants,
    source_event_ids: [...new Set(variants.map(item => item.id).filter(id => typeof id === 'string' && id))],
    event_end_conflict: ends.size > 1,
  };
  // A representative end would look resolved to consumers. Preserve it only when
  // all reports agree; the original values remain available in event_variants.
  if (event.event_end_conflict) delete event.event_end_time;
  return event;
}

/**
 * Reconcile local/market reports for display without changing or discarding sources.
 * isVisible runs on ORIGINAL reports, never the projection with an unresolved end.
 * A group survives while any report is visible, retaining even expired conflicting
 * reports for explanation. Once all reports expire, the group disappears normally.
 * Missing venue/date/start identity is deliberately not reconciled.
 * @param {Array<object>} local
 * @param {Array<object>} market
 * @param {{isVisible?: (event: object, scope: string) => boolean}} options
 * @returns {{local: Array<object>, market: Array<object>}}
 */
export function reconcileEventLists(local = [], market = [], { isVisible = () => true } = {}) {
  const groups = [];
  for (const [scope, events] of [['local', local], ['market', market]]) {
    for (const event of Array.isArray(events) ? events : []) {
      if (!event || typeof event !== 'object') continue;
      const slot = slotKey(event);
      // Pairwise agreement prevents a sparse title joining two incompatible lineups.
      const group = slot && groups.find(candidate => candidate.slot === slot && candidate.entries.every(entry => sameTitle(entry.event, event)));
      if (group) group.entries.push({ event, scope });
      else groups.push({ slot, entries: [{ event, scope }] });
    }
  }
  const result = { local: [], market: [] };
  for (const { entries } of groups) {
    const visible = entries.filter(entry => isVisible(entry.event, entry.scope));
    if (!visible.length) continue;
    // Avoid a second market card while a local report is visible. Both reports remain
    // in the one card; if only the market report is visible, keep it in the market list.
    const scope = visible.some(entry => entry.scope === 'local') ? 'local' : 'market';
    result[scope].push(projectGroup(entries));
  }
  return result;
}
