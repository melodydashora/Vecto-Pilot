/** Google Routes distance/time measurements. Missing routes never become zeroes. */
import { normalizeCoordinates } from '../../../shared/coordinates.js';

const ROUTES_API_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const MATRIX_API_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
const routeCache = new Map();
const inFlight = new Map();
const ROUTE_CACHE_TTL = 600000;
const ROUTE_CACHE_MAX_SIZE = 500;
const REQUEST_TIMEOUT_MS = 15000;

function coordinates(point) {
  const valid = normalizeCoordinates(point?.lat, point?.lng);
  if (!valid) throw new Error('Routes requires valid origin and destination coordinates');
  return valid;
}
function waypoint(point) {
  return { location: { latLng: { latitude: point.lat, longitude: point.lng } } };
}
function settings(options) {
  const travelMode = options.travelMode || 'DRIVE';
  const routingPreference = options.trafficModel || 'TRAFFIC_AWARE';
  // Omitted departureTime means now per Google; do not shift the trip into the future.
  return { travelMode, routingPreference, ...(options.departureTime && { departureTime: options.departureTime }) };
}
function duration(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,9})?s$/.test(value)) return null;
  const seconds = Number(value.slice(0, -1));
  return Number.isFinite(seconds) ? seconds : null;
}
function metrics(route) {
  const durationSeconds = duration(route?.duration);
  if (!Number.isFinite(route?.distanceMeters) || route.distanceMeters < 0 || durationSeconds === null) {
    throw new Error('Routes API returned invalid or missing distance/duration');
  }
  return { distanceMeters: route.distanceMeters, durationSeconds };
}
async function request(url, body, fields, signal) {
  if (!process.env.GOOGLE_MAPS_API_KEY) throw new Error('Routes provider is not configured');
  const controller = new AbortController();
  const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(new Error('Routes provider timed out')), REQUEST_TIMEOUT_MS);
  try {
    requestSignal.throwIfAborted();
    const response = await fetch(url, { method: 'POST', signal: requestSignal,
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY, 'X-Goog-FieldMask': fields },
      body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Routes API failed: HTTP ${response.status}`);
    const text = await response.text();
    requestSignal.throwIfAborted();
    try { return JSON.parse(text); }
    catch {
      // A streamed NDJSON response must be wholly parseable; never accept a
      // partial response while silently dropping corrupt matrix elements.
      try { return text.trim().split('\n').map(line => JSON.parse(line)); }
      catch { throw new Error('Routes API returned invalid JSON'); }
    }
  } finally { clearTimeout(timer); controller.abort(); }
}
function share(key, options, operation) {
  // An independently cancellable caller must not own another caller's request.
  if (options.signal) return operation();
  if (inFlight.has(key)) return inFlight.get(key).then(structuredClone);
  const pending = operation();
  inFlight.set(key, pending);
  return pending.finally(() => { if (inFlight.get(key) === pending) inFlight.delete(key); }).then(structuredClone);
}

export async function getRouteWithTraffic(rawOrigin, rawDestination, options = {}) {
  const origin = coordinates(rawOrigin), destination = coordinates(rawDestination);
  const routing = settings(options);
  // Preserve exact coordinates and every semantic request option in the cache key.
  const key = JSON.stringify(['route', origin, destination, routing]);
  const cached = routeCache.get(key);
  if (!options.signal?.aborted && cached && Date.now() - cached.timestamp < ROUTE_CACHE_TTL) return structuredClone(cached.data);
  return share(key, options, async () => {
    const data = await request(ROUTES_API_URL, { origin: waypoint(origin), destination: waypoint(destination), ...routing,
      computeAlternativeRoutes: false, routeModifiers: { avoidTolls: false, avoidHighways: false, avoidFerries: false } },
    'routes.duration,routes.distanceMeters,routes.staticDuration', options.signal);
    const route = data?.routes?.[0];
    if (!route) throw new Error('Routes API returned no route');
    const result = metrics(route);
    const staticDurationSeconds = duration(route.staticDuration);
    Object.assign(result, { staticDurationSeconds,
      trafficDelaySeconds: staticDurationSeconds === null ? null : result.durationSeconds - staticDurationSeconds });
    routeCache.set(key, { timestamp: Date.now(), data: result });
    if (routeCache.size > ROUTE_CACHE_MAX_SIZE) routeCache.delete(routeCache.keys().next().value);
    return result;
  });
}

export async function getRouteMatrix(rawOrigins, rawDestinations, options = {}) {
  if (!Array.isArray(rawOrigins) || !rawOrigins.length || !Array.isArray(rawDestinations) || !rawDestinations.length) {
    throw new Error('Route Matrix requires origins and destinations');
  }
  const origins = rawOrigins.map(coordinates), destinations = rawDestinations.map(coordinates);
  const routing = settings(options);
  const key = JSON.stringify(['matrix', origins, destinations, routing]);
  return share(key, options, async () => {
    const data = await request(MATRIX_API_URL, { origins: origins.map(point => ({ waypoint: waypoint(point) })),
      destinations: destinations.map(point => ({ waypoint: waypoint(point) })), ...routing },
    'originIndex,destinationIndex,duration,distanceMeters,staticDuration,status,condition', options.signal);
    const items = Array.isArray(data) ? data : [data];
    if (!items.length) throw new Error('Route Matrix API returned no results');
    const seen = new Set();
    return items.map(item => {
      // Proto JSON may omit zero-valued indices; all nonzero indices must be explicit.
      const originIndex = item?.originIndex ?? 0, destinationIndex = item?.destinationIndex ?? 0;
      if (!Number.isInteger(originIndex) || originIndex < 0 || originIndex >= origins.length ||
          !Number.isInteger(destinationIndex) || destinationIndex < 0 || destinationIndex >= destinations.length) {
        throw new Error('Route Matrix returned an invalid index');
      }
      const index = `${originIndex}:${destinationIndex}`;
      if (seen.has(index)) throw new Error('Route Matrix returned a duplicate index');
      seen.add(index);
      const statusCode = item?.status?.code ?? 0;
      const routeAvailable = statusCode === 0 && item?.condition === 'ROUTE_EXISTS';
      const result = { originIndex, destinationIndex, status: statusCode || item?.condition || 'UNKNOWN',
        condition: item?.condition || null, routeAvailable, distanceMeters: null, durationSeconds: null,
        staticDurationSeconds: null, trafficDelaySeconds: null };
      if (routeAvailable) {
        Object.assign(result, metrics(item));
        result.staticDurationSeconds = duration(item.staticDuration);
        result.trafficDelaySeconds = result.staticDurationSeconds === null ? null : result.durationSeconds - result.staticDurationSeconds;
      }
      return result;
    });
  });
}

export async function predictDriveMinutesWithTraffic(origin, destination) {
  const result = await getRouteWithTraffic(origin, destination);
  return { minutes: Math.round(result.durationSeconds / 60), distanceMiles: (result.distanceMeters / 1609.344).toFixed(1),
    trafficDelayMinutes: result.trafficDelaySeconds === null ? null : Math.round(result.trafficDelaySeconds / 60), distanceMeters: result.distanceMeters };
}
