// 2026-05-02: Workstream 6 Step 1 — extracted from briefing-service.js (commit 4/11).
// Owns: weather_current + weather_forecast sections of the briefings row + briefing_weather_ready
// pg_notify channel.
//
// Special case among the 6 pipelines: weather is the only DUAL-section pipeline. One pg_notify
// fires; the orchestrator atomically reconciles BOTH fields in the final write.
//
// Live path: Google Weather API (currentConditions:lookup + forecast/hours:lookup).
// 2026-05-02: The legacy LLM-based fetchWeatherForecast was deleted in this commit —
// it had zero callers and violated the "Coordinates from Google APIs or DB, never AI"
// principle (CLAUDE.md ABSOLUTE PRECISION). The BRIEFING_WEATHER AI registry role
// was pruned alongside it (server/lib/ai/model-registry.js).
//
// Logging tag: [BRIEFING][WEATHER] (per the 9-stage taxonomy enforcement principle —
// the file location IS the taxonomy declaration).

import { briefingLog, OP } from '../../../logger/workflow.js';
import { writeSectionAndNotify, CHANNELS, errorMarker } from '../briefing-notify.js';
import { normalizeCoordinates } from '../../../../shared/coordinates.js';

const WEATHER_TIMEOUT_MS = 15_000;
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const validTimestamp = value => hasText(value) && Number.isFinite(Date.parse(value));

/**
 * Determine whether a country uses the metric system.
 * Imperial holdouts: US, UK overseas territories, Liberia, Myanmar, etc.
 * @param {string} country - country name or code
 * @returns {boolean} true if metric, false if imperial
 */
function usesMetric(country) {
  const imperialCountries = new Set(['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA',
    'BS', 'BAHAMAS', 'KY', 'CAYMAN ISLANDS', 'PW', 'PALAU', 'MH', 'MARSHALL ISLANDS', 'MM', 'MYANMAR']);
  return !imperialCountries.has(typeof country === 'string' ? country.trim().toUpperCase() : '');
}

/**
 * Format temperature with both metric/imperial values + a country-appropriate display value.
 * @param {{ degrees: number, unit: string }} temperature - Google typed measurement
 * @param {string} country - country name/code (drives display unit)
 * @returns {{ tempC: number, tempF: number, displayTemp: number, unit: string }}
 */
function formatTemperature(temperature, country) {
  if (!Number.isFinite(temperature?.degrees)) return undefined;
  const tempC = temperature.unit === 'CELSIUS' ? temperature.degrees
    : temperature.unit === 'FAHRENHEIT' ? (temperature.degrees - 32) * 5 / 9 : undefined;
  if (!Number.isFinite(tempC)) return undefined;
  const metric = usesMetric(country);
  if (metric) {
    return {
      tempC: Math.round(tempC),
      tempF: Math.round((tempC * 9/5) + 32),
      displayTemp: Math.round(tempC),
      unit: '°C'
    };
  } else {
    const tempF = Math.round((tempC * 9/5) + 32);
    return {
      tempC: Math.round(tempC),
      tempF: tempF,
      displayTemp: tempF,
      unit: '°F'
    };
  }
}

/**
 * Convert Google's declared speed unit; Weather API does not return m/s.
 * @param {{ value: number, unit: string }} speed - Google wind.speed measurement
 * @param {string} country - country name/code
 * @returns {number|undefined} converted speed, or undefined when unavailable
 */
function formatWindSpeed(speed, country) {
  if (!Number.isFinite(speed?.value) || speed.value < 0) return undefined;
  const kmh = speed.unit === 'KILOMETERS_PER_HOUR' ? speed.value
    : speed.unit === 'MILES_PER_HOUR' ? speed.value * 1.609344 : undefined;
  if (!Number.isFinite(kmh)) return undefined;
  return Math.round(usesMetric(country) ? kmh : kmh / 1.609344);
}

/**
 * 2026-02-26: Generate a driver-relevant weather summary string.
 * Deterministic — based on current conditions + 6-hour forecast.
 * The strategist receives this instead of the full weather JSON blob.
 *
 * @param {Object} current - Current weather data { tempF, conditions, conditionType, windSpeed, humidity }
 * @param {Array} forecast - 6-hour forecast array
 * @returns {string} 1-2 sentence driver-relevant summary
 */
function generateWeatherDriverImpact(current, forecast = []) {
  const parts = [];

  const temp = current.tempF ?? current.temperature;
  const conditions = (current.conditions || '').toLowerCase();
  const condType = (current.conditionType || '').toLowerCase();

  const isSevere = condType.includes('thunder') || condType.includes('tornado') ||
                   condType.includes('ice') || condType.includes('blizzard') ||
                   conditions.includes('thunder') || conditions.includes('tornado');
  const isRain = condType.includes('rain') || condType.includes('drizzle') ||
                 conditions.includes('rain') || conditions.includes('shower');
  const isSnow = condType.includes('snow') || condType.includes('sleet') ||
                 conditions.includes('snow') || conditions.includes('sleet');
  const isFog = condType.includes('fog') || conditions.includes('fog') || conditions.includes('mist');

  if (isSevere) {
    parts.push(`Severe weather (${current.conditions}) — dangerous driving, expect surge from riders avoiding transit`);
  } else if (isSnow) {
    parts.push(`Snow/ice conditions — high risk driving, reduced demand but strong surge pricing`);
  } else if (isRain) {
    parts.push(`Rain — expect surge, riders avoid walking`);
  } else if (isFog) {
    parts.push(`Foggy — reduced visibility, drive carefully`);
  } else if (Number.isFinite(temp) && temp > 100) {
    parts.push(`Extreme heat ${temp}°F — normal demand`);
  } else if (Number.isFinite(temp) && temp < 32) {
    parts.push(`Freezing ${temp}°F — surge likely, riders avoid cold waits`);
  } else {
    parts.push(`${current.conditions}, ${Number.isFinite(temp) ? temp + '°F' : ''} — good driving conditions`);
  }

  const upcomingRain = forecast.slice(0, 3).find(h =>
    (h.precipitationProbability && h.precipitationProbability > 50) ||
    (h.conditionType || '').toLowerCase().includes('rain') ||
    (h.conditions || '').toLowerCase().includes('rain')
  );

  if (upcomingRain && !isRain && !isSevere) {
    const hours = Math.max(0, Math.ceil((Date.parse(upcomingRain.time) - Date.parse(current.observedAt)) / 3_600_000));
    parts.push(hours === 0 ? 'Rain expected in the current forecast hour — surge incoming'
      : `Rain expected in ~${hours} hour${hours > 1 ? 's' : ''} — surge incoming`);
  }

  return parts.join('. ') + '.';
}

/**
 * Fetch current weather + 6-hour forecast from Google Weather API.
 *
 * This is the raw fetch — no SSE write, no orchestration. Callers that need
 * the full pipeline behavior (write + notify) should use `discoverWeather`.
 *
 * @param {{ snapshot: object }} args
 * @returns {Promise<{ current: object, forecast: Array, fetchedAt?: string, reason?: string }>}
 */
export async function fetchWeatherConditions({ snapshot, signal }) {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    briefingLog.warn(1, `GOOGLE_MAPS_API_KEY not set - skipping weather`, OP.API);
    throw new Error('Weather provider not configured');
  }

  const coords = normalizeCoordinates(snapshot?.lat, snapshot?.lng);
  if (!coords) throw new Error('Weather snapshot has missing or invalid GPS coordinates');

  const { lat, lng } = coords;
  const { country } = snapshot;
  const metric = usesMetric(country);
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const controller = new AbortController();
  const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const timeout = setTimeout(() => controller.abort(new Error('Weather provider timed out')), WEATHER_TIMEOUT_MS);
  const request = async endpoint => {
    const url = new URL(`https://weather.googleapis.com/v1/${endpoint}:lookup`);
    url.searchParams.set('location.latitude', String(lat));
    url.searchParams.set('location.longitude', String(lng));
    url.searchParams.set('unitsSystem', 'METRIC');
    url.searchParams.set('key', apiKey);
    if (endpoint === 'forecast/hours') url.searchParams.set('hours', '6');
    return fetch(url.toString(), { signal: requestSignal });
  };

  try {
    requestSignal.throwIfAborted();
    const [currentRes, forecastRes] = await Promise.all([request('currentConditions'), request('forecast/hours')]);

    if (!currentRes.ok || !forecastRes.ok) {
      throw new Error(`Weather API request failed (current HTTP ${currentRes.status}, forecast HTTP ${forecastRes.status})`);
    }
    let current = null;
    let forecast = [];

    if (currentRes.ok) {
      const currentData = await currentRes.json();
      const tempData = formatTemperature(currentData.temperature, country);
      if (!tempData || !hasText(currentData.weatherCondition?.description?.text) || !validTimestamp(currentData.currentTime)) {
        throw new Error('Weather API returned invalid current conditions');
      }
      const feelsData = formatTemperature(currentData.feelsLikeTemperature, country);
      const windSpeedDisplay = formatWindSpeed(currentData.wind?.speed, country);

      current = {
        temperature: tempData.displayTemp,
        tempF: tempData.tempF,
        tempC: tempData.tempC,
        tempUnit: tempData.unit,
        feelsLike: feelsData?.displayTemp,
        feelsLikeF: feelsData?.tempF,
        feelsLikeC: feelsData?.tempC,
        conditions: currentData.weatherCondition?.description?.text,
        conditionType: currentData.weatherCondition?.type,
        humidity: currentData.relativeHumidity?.value ?? currentData.relativeHumidity,
        windSpeed: windSpeedDisplay,
        windSpeedUnit: metric ? 'km/h' : 'mph',
        windDirection: currentData.wind?.direction?.cardinal,
        uvIndex: currentData.uvIndex,
        precipitation: currentData.precipitation,
        visibility: currentData.visibility,
        isDaytime: currentData.isDaytime,
        observedAt: currentData.currentTime,
        country: country
      };
    }

    if (forecastRes.ok) {
      const forecastData = await forecastRes.json();
      if (!Array.isArray(forecastData.forecastHours) || forecastData.forecastHours.length === 0) {
        throw new Error('Weather API returned no forecast hours');
      }
      forecast = forecastData.forecastHours.map(hour => {
        const tempData = formatTemperature(hour?.temperature, country);
        const timeValue = hour?.interval?.startTime;
        if (!tempData || !validTimestamp(timeValue) || !hasText(hour?.weatherCondition?.description?.text)) {
          throw new Error('Weather API returned an invalid forecast hour');
        }
        const windSpeedDisplay = formatWindSpeed(hour.wind?.speed, country);

        return {
          time: timeValue,
          temperature: tempData.displayTemp,
          tempF: tempData.tempF,
          tempC: tempData.tempC,
          tempUnit: tempData.unit,
          conditions: hour.weatherCondition.description.text,
          conditionType: hour.weatherCondition?.type,
          precipitationProbability: hour.precipitationProbability?.value ?? hour.precipitation?.probability?.percent,
          windSpeed: windSpeedDisplay,
          windSpeedUnit: metric ? 'km/h' : 'mph',
          isDaytime: hour.isDaytime
        };
      });
    }

    if (current) {
      current.driverImpact = generateWeatherDriverImpact(current, forecast);
    }

    requestSignal.throwIfAborted();
    return { current, forecast, fetchedAt: new Date().toISOString() };
  } catch (error) {
    briefingLog.error(1, `Weather API error`, error, OP.API);
    throw error;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

/**
 * Pipeline contract: discover weather conditions for a snapshot.
 *
 * Calls Google Weather API, writes the dual `weather_current` + `weather_forecast`
 * sections to the briefings row, fires the CHANNELS.WEATHER pg_notify, and returns
 * the data plus a reason string for the orchestrator's final atomic reconciliation write.
 *
 * Special case: this is the only pipeline that writes TWO sections in a single
 * `writeSectionAndNotify` call. Other pipelines write one section.
 *
 * HTTP/configuration/parse failures throw and remain failures through the final
 * reconciliation. An unavailable weather provider is not a verified empty sky.
 *
 * @param {object} args
 * @param {object} args.snapshot - snapshot row (lat/lng/country drive the API call)
 * @param {string} args.snapshotId - snapshot UUID
 * @returns {Promise<{ weather_current: object, weather_forecast: Array, reason: string|null }>}
 */
export async function discoverWeather({ snapshot, snapshotId }) {
  let weather_current;
  let weather_forecast;
  let reason = null;

  try {
    const result = await fetchWeatherConditions({ snapshot });
    if (!result?.current || !Array.isArray(result.forecast)) {
      throw new Error('Weather provider returned an invalid response');
    }
    weather_current = result.current;
    weather_forecast = result.forecast;
    reason = result?.reason || null;

    await writeSectionAndNotify(snapshotId, {
      weather_current,
      weather_forecast,
    }, CHANNELS.WEATHER);
  } catch (err) {
    weather_current = errorMarker(err);
    weather_forecast = errorMarker(err);
    reason = err.message;
    await writeSectionAndNotify(snapshotId, { weather_current, weather_forecast }, CHANNELS.WEATHER);
    throw err;
  }

  return { weather_current, weather_forecast, reason };
}
