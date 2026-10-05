const AIRPORT_EVENTS_URL = 'https://nasstatus.faa.gov/api/airport-events';
const REQUEST_TIMEOUT_MS = 15000;
const EVENT_FIELDS = ['groundStop', 'groundDelay', 'arrivalDelay', 'departureDelay', 'airportClosure', 'freeForm', 'deicing'];
let inFlightFeed = null;

// The FAA website uses this national JSON feed (verified 2026-10-05). Share only
// overlapping reads, so nearby airports do not each fetch the same national data.
// An absent advisory is not evidence of normal operations or airport coverage.
export async function fetchFAADelayData(airportCode = null, { strict = false } = {}) {
  try {
    if (airportCode !== null && (typeof airportCode !== 'string' || !/^[A-Z]{3}$/i.test(airportCode))) {
      throw new Error('FAA airport code must be a three-letter IATA code');
    }
    const feed = await sharedNationalFeed();
    if (airportCode === null) return structuredClone(feed.airports);
    const code = airportCode.toUpperCase();
    return structuredClone(feed.airports.find(airport => airport.airport_code === code)
      ?? unknownAirport(code, feed.fetched_at));
  } catch (error) {
    if (strict) throw error;
    console.error('[FAA NAS] Fetch error:', error.message);
    return null;
  }
}

function sharedNationalFeed() {
  if (inFlightFeed) return inFlightFeed;
  const pending = fetchNationalFeed();
  inFlightFeed = pending;
  const release = () => { if (inFlightFeed === pending) inFlightFeed = null; };
  pending.then(release, release);
  return pending;
}

async function fetchNationalFeed() {
  try {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await fetch(AIRPORT_EVENTS_URL, {
      headers: { Accept: 'application/json' },
      signal,
    });
    signal.throwIfAborted();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = await response.json();
    signal.throwIfAborted();
    if (!Array.isArray(rows)) throw new Error('Invalid airport-events response: expected an array');
    const fetchedAt = new Date().toISOString();
    const seen = new Set();
    const airports = rows.map(row => {
      if (!isObject(row) || typeof row.airportId !== 'string' || !/^[A-Z0-9]{3,4}$/.test(row.airportId)) {
        throw new Error('Invalid airport-events airport identity');
      }
      if (!EVENT_FIELDS.some(field => Object.hasOwn(row, field))) throw new Error('Invalid airport-events event fields');
      if (seen.has(row.airportId)) throw new Error('Duplicate airport-events airport identity');
      seen.add(row.airportId);
      return parseAirportEvents(row, fetchedAt);
    });
    return { airports, fetched_at: fetchedAt };
  } catch (error) {
    throw new Error(`FAA airport-events feed unavailable: ${error.message}`);
  }
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const minutes = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

// Keep the supplied advisory instant distinct from HTTP fetch time. Zoned,
// calendar-valid timestamps are required; no host-zone or current-time default.
function timestamp(value) {
  if (value == null) return null;
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) throw new Error('Invalid FAA advisory timestamp');
  const [, year, month, day, hour, minute, second, offsetHour = '0', offsetMinute = '0'] = match;
  if (+month < 1 || +month > 12 || +day < 1 || +day > new Date(Date.UTC(+year, +month, 0)).getUTCDate()
      || +hour > 23 || +minute > 59 || +second > 59 || +offsetHour > 23 || +offsetMinute > 59
      || !Number.isFinite(Date.parse(value))) throw new Error('Invalid FAA advisory timestamp');
  return value;
}

function unknownAirport(code, fetchedAt) {
  return {
    airport_code: code, airport_name: code, city: null, state: null,
    delay_minutes: null, has_delays: null, supported: null,
    ground_stops: [], ground_delay_programs: [], closure_status: 'unknown',
    delay_reason: 'No FAA airport events are listed; normal operations are not verified.',
    closure_start: null, closure_end: null, weather: null,
    source_updated_at: null, last_updated: null, fetched_at: fetchedAt,
  };
}

function parseAirportEvents(row, fetchedAt) {
  const result = unknownAirport(row.airportId, fetchedAt);
  result.airport_name = text(row.airportLongName) ?? row.airportId;
  const reasons = new Set(), observedTimes = [], durations = [], restrictions = [];
  for (const field of EVENT_FIELDS) {
    const event = row[field];
    if (event == null) continue;
    if (!isObject(event) || event.airportId !== row.airportId) {
      throw new Error(`Invalid or mismatched FAA ${field} payload`);
    }
    const times = Object.fromEntries(['updatedAt', 'updateTime', 'issuedDate', 'startTime', 'endTime', 'eventTime']
      .map(key => [key, timestamp(event[key])]));
    observedTimes.push(...['updatedAt', 'updateTime', 'issuedDate'].map(key => times[key]).filter(Boolean));
    if (field === 'groundStop') {
      const reason = text(event.impactingCondition);
      result.ground_stops.push({ reason, end_time: times.endTime });
      result.has_delays = true;
      reasons.add(reason ?? 'FAA ground stop reported');
    } else if (['groundDelay', 'arrivalDelay', 'departureDelay'].includes(field)) {
      const groundDelay = field === 'groundDelay';
      const duration = minutes(groundDelay ? event.avgDelay : event.averageDelay);
      const reason = text(groundDelay ? event.impactingCondition : event.reason);
      const type = groundDelay ? 'Ground Delay Program' : field === 'arrivalDelay' ? 'Arrival Delay' : 'Departure Delay';
      result.ground_delay_programs.push({ reason, min_delay: null, max_delay: null,
        average_delay: duration, trend: text(event.trend), type });
      if (duration !== null) durations.push(duration);
      result.has_delays = true;
      reasons.add(reason ?? `FAA ${type.toLowerCase()} reported`);
    } else if (field === 'airportClosure' || field === 'freeForm') {
      // Preserve the restriction's full wording, including exceptions and scope.
      // A closure notice may apply only to particular aircraft or operations.
      const reason = text(event.simpleText) ?? text(event.text);
      restrictions.push({ reason, start_time: times.startTime, end_time: times.endTime });
      reasons.add(reason ?? 'FAA airport closure or restriction reported');
    } else if (field === 'deicing') {
      reasons.add('FAA deicing reported; delay duration is unknown.');
    }
  }
  result.delay_minutes = durations.length ? Math.max(...durations) : null;
  if (restrictions.length) {
    result.closure_status = 'restricted';
    result.closure_start = restrictions[0].start_time;
    result.closure_end = restrictions[0].end_time;
    result.restrictions = restrictions;
  } else if (result.ground_stops.length) result.closure_status = 'ground-stop';
  if (reasons.size) result.delay_reason = [...reasons].sort().join('; ');
  result.source_updated_at = observedTimes.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  result.last_updated = result.source_updated_at;
  return result;
}
