import { normalizeCoordinates } from '../../../shared/coordinates.js';
import { coordsKey } from './coords-key.js';
import { makeCircuit } from '../../util/circuit.js';
import { SNAPSHOT_OBSERVATION_MAX_AGE_MS } from './snapshot-readiness.js';

// Server-only results shared by the header GETs and snapshot enrichment. Entries
// expire after one minute; failures are never cached or replaced by stale values.
const CACHE_MS = 60_000;
const CACHE_LIMIT = 256;
const text = value => typeof value === 'string' && value.trim().length > 0;
const measuredAt = value => text(value) && Number.isFinite(Date.parse(value)) ? value : undefined;
const fahrenheit = value => {
  const degrees = typeof value === 'number' ? value : value?.degrees;
  if (!Number.isFinite(degrees)) return undefined;
  if (value?.unit === 'FAHRENHEIT') return Math.round(degrees);
  if (value?.unit && value.unit !== 'CELSIUS') return undefined;
  return Math.round(degrees * 9 / 5 + 32);
};

export function createSnapshotEnvironment({ fetchImpl = (...args) => fetch(...args), now = () => Date.now(), env = process.env } = {}) {
  const cache = new Map();
  const inFlight = new Map();
  const weatherCircuit = makeCircuit({ name: 'snapshot-weather', failureThreshold: 3, resetAfterMs: 30_000, timeoutMs: 5_000 });
  const airCircuit = makeCircuit({ name: 'snapshot-air', failureThreshold: 3, resetAfterMs: 30_000, timeoutMs: 3_000 });

  async function load(section, rawLat, rawLng) {
    const coords = normalizeCoordinates(rawLat, rawLng);
    if (!coords) throw new Error('Snapshot environment requires valid coordinates');
    const coordKey = coordsKey(coords.lat, coords.lng);
    const key = `${section}:${coordKey}`;
    const existing = cache.get(key);
    if (existing && now() >= existing.fetchedMs && now() - existing.fetchedMs < CACHE_MS) return structuredClone(existing.value);
    cache.delete(key);
    if (inFlight.has(key)) return structuredClone(await inFlight.get(key));

    const pending = (async () => {
      const apiKey = section === 'weather' ? env.GOOGLE_MAPS_API_KEY : env.GOOGLEAQ_API_KEY;
      if (!apiKey) throw new Error(`Snapshot ${section} provider is not configured`);
      const circuit = section === 'weather' ? weatherCircuit : airCircuit;
      const data = await circuit(async signal => {
        const url = new URL(section === 'weather'
          ? 'https://weather.googleapis.com/v1/currentConditions:lookup'
          : 'https://airquality.googleapis.com/v1/currentConditions:lookup');
        url.searchParams.set('key', apiKey);
        const options = { signal };
        if (section === 'weather') {
          url.searchParams.set('location.latitude', String(coords.lat));
          url.searchParams.set('location.longitude', String(coords.lng));
          url.searchParams.set('unitsSystem', 'METRIC');
        } else {
          options.method = 'POST';
          options.headers = { 'Content-Type': 'application/json' };
          options.body = JSON.stringify({ location: { latitude: coords.lat, longitude: coords.lng }, universalAqi: true });
        }
        const response = await fetchImpl(url.toString(), options);
        if (!response.ok) throw new Error(`Snapshot ${section} provider returned HTTP ${response.status}`);
        return response.json();
      });

      const fetchedMs = now();
      const source = { provider: section === 'weather' ? 'google-weather' : 'google-air-quality', coord_key: coordKey, fetched_at: new Date(fetchedMs).toISOString() };
      let value;
      if (section === 'weather') {
        const tempF = fahrenheit(data?.temperature);
        const conditions = data?.weatherCondition?.description?.text;
        const observedAt = measuredAt(data?.currentTime);
        if (!Number.isFinite(tempF) || !text(conditions) || !observedAt) throw new Error('Snapshot weather provider returned incomplete measurements');
        value = { available: true, temperature: tempF, tempF, conditions, description: conditions,
          feelsLike: fahrenheit(data.feelsLikeTemperature), humidity: data.relativeHumidity?.value ?? data.relativeHumidity,
          windSpeed: data.wind?.speed, windDirection: data.wind?.direction?.cardinal,
          uvIndex: data.uvIndex, precipitation: data.precipitation, visibility: data.visibility,
          isDaytime: data.isDaytime, observedAt, source: { ...source, observed_at: observedAt } };
      } else {
        const index = data?.indexes?.find(item => item.code === 'uaqi');
        const observedAt = measuredAt(data?.dateTime);
        if (!Number.isFinite(index?.aqi) || index.aqi < 0 || !text(index?.category) || !observedAt) throw new Error('Snapshot air provider returned incomplete measurements');
        value = { available: true, aqi: index.aqi, category: index.category, indexCode: index.code,
          dominantPollutant: index.dominantPollutant, healthRecommendations: data.healthRecommendations,
          dateTime: observedAt, regionCode: data.regionCode, source: { ...source, observed_at: observedAt } };
      }
      const observationMs = Date.parse(value.source.observed_at);
      if (observationMs > fetchedMs + 5_000 || fetchedMs - observationMs > SNAPSHOT_OBSERVATION_MAX_AGE_MS[section]) {
        throw new Error(`Snapshot ${section} observation is stale or future-dated`);
      }
      cache.set(key, { fetchedMs, value });
      while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
      return value;
    })();
    inFlight.set(key, pending);
    try { return structuredClone(await pending); }
    finally { if (inFlight.get(key) === pending) inFlight.delete(key); }
  }
  return {
    weather: (lat, lng) => load('weather', lat, lng),
    air: (lat, lng) => load('air', lat, lng),
    async both(lat, lng) {
      const [weather, air] = await Promise.all([load('weather', lat, lng), load('air', lat, lng)]);
      return { weather, air };
    },
  };
}

export const snapshotEnvironment = createSnapshotEnvironment();
