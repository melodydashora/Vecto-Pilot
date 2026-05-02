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

/**
 * Determine whether a country uses the metric system.
 * Imperial holdouts: US, UK overseas territories, Liberia, Myanmar, etc.
 * @param {string} country - country name or code
 * @returns {boolean} true if metric, false if imperial
 */
function usesMetric(country) {
  const imperialCountries = ['US', 'United States', 'Bahamas', 'Cayman Islands', 'Palau', 'Marshall Islands', 'Myanmar'];
  return !country || !imperialCountries.some(c => country?.toUpperCase().includes(c.toUpperCase()));
}

/**
 * Format temperature with both metric/imperial values + a country-appropriate display value.
 * @param {number} tempC - temperature in Celsius
 * @param {string} country - country name/code (drives display unit)
 * @returns {{ tempC: number, tempF: number, displayTemp: number, unit: string }}
 */
function formatTemperature(tempC, country) {
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
 * Convert wind speed from m/s to km/h (metric) or mph (imperial).
 * @param {number} windSpeedMs - wind speed in meters per second
 * @param {string} country - country name/code
 * @returns {number|undefined} converted speed, or undefined if input is falsy
 */
function formatWindSpeed(windSpeedMs, country) {
  if (!windSpeedMs) return undefined;
  const metric = usesMetric(country);
  if (metric) {
    return Math.round(windSpeedMs * 3.6);
  } else {
    return Math.round(windSpeedMs * 2.237);
  }
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

  const temp = current.tempF || current.temperature;
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
  } else if (temp && temp > 100) {
    parts.push(`Extreme heat ${temp}°F — normal demand`);
  } else if (temp && temp < 32) {
    parts.push(`Freezing ${temp}°F — surge likely, riders avoid cold waits`);
  } else {
    parts.push(`${current.conditions || 'Clear'}, ${temp ? temp + '°F' : ''} — good driving conditions`);
  }

  const upcomingRain = forecast.slice(0, 3).find(h =>
    (h.precipitationProbability && h.precipitationProbability > 50) ||
    (h.conditionType || '').toLowerCase().includes('rain') ||
    (h.conditions || '').toLowerCase().includes('rain')
  );

  if (upcomingRain && !isRain && !isSevere) {
    const idx = forecast.indexOf(upcomingRain);
    parts.push(`Rain expected in ~${idx + 1} hour${idx > 0 ? 's' : ''} — surge incoming`);
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
export async function fetchWeatherConditions({ snapshot }) {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    briefingLog.warn(1, `GOOGLE_MAPS_API_KEY not set - skipping weather`, OP.API);
    return {
      current: { temperature: 'N/A', conditions: 'Weather unavailable', reason: 'GOOGLE_MAPS_API_KEY not configured' },
      forecast: [],
      reason: 'GOOGLE_MAPS_API_KEY not configured'
    };
  }

  if (!snapshot?.lat || !snapshot?.lng) {
    return {
      current: { temperature: 'N/A', conditions: 'Weather unavailable', reason: 'Snapshot missing GPS coordinates' },
      forecast: [],
      reason: 'Snapshot missing GPS coordinates (lat/lng)'
    };
  }

  const { lat, lng, country } = snapshot;
  const metric = usesMetric(country);
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  try {
    const [currentRes, forecastRes] = await Promise.all([
      fetch(`https://weather.googleapis.com/v1/currentConditions:lookup?location.latitude=${lat}&location.longitude=${lng}&key=${apiKey}`),
      fetch(`https://weather.googleapis.com/v1/forecast/hours:lookup?location.latitude=${lat}&location.longitude=${lng}&hours=6&key=${apiKey}`)
    ]);

    let current = null;
    let forecast = [];

    if (currentRes.ok) {
      const currentData = await currentRes.json();
      const tempC = currentData.temperature?.degrees ?? currentData.temperature;
      const feelsLikeC = currentData.feelsLikeTemperature?.degrees ?? currentData.feelsLikeTemperature;
      const windSpeedMs = currentData.windSpeed?.value ?? currentData.windSpeed;

      const tempData = formatTemperature(tempC, country);
      const feelsData = formatTemperature(feelsLikeC, country);
      const windSpeedDisplay = formatWindSpeed(windSpeedMs, country);

      current = {
        temperature: tempData.displayTemp,
        tempF: tempData.tempF,
        tempC: tempData.tempC,
        tempUnit: tempData.unit,
        feelsLike: feelsData.displayTemp,
        feelsLikeF: feelsData.tempF,
        feelsLikeC: feelsData.tempC,
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
      forecast = (forecastData.forecastHours || []).map((hour, idx) => {
        const tempC = hour.temperature?.degrees ?? hour.temperature;
        const windSpeedMs = hour.windSpeed?.value ?? hour.wind?.speed;
        const tempData = formatTemperature(tempC, country);
        const windSpeedDisplay = formatWindSpeed(windSpeedMs, country);

        let timeValue = hour.time;
        if (!timeValue || isNaN(new Date(timeValue).getTime())) {
          const forecastTime = new Date();
          forecastTime.setHours(forecastTime.getHours() + idx);
          timeValue = forecastTime.toISOString();
        }

        return {
          time: timeValue,
          temperature: tempData.displayTemp,
          tempF: tempData.tempF,
          tempC: tempData.tempC,
          tempUnit: tempData.unit,
          conditions: hour.condition?.text ?? hour.weatherCondition?.description?.text,
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

    return { current, forecast, fetchedAt: new Date().toISOString() };
  } catch (error) {
    briefingLog.error(1, `Weather API error`, error, OP.API);
    return {
      current: { temperature: 'N/A', conditions: 'Weather unavailable', reason: `Weather API error: ${error.message}` },
      forecast: [],
      reason: `Google Weather API error: ${error.message}`
    };
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
 * Two error pathways are preserved:
 *   - Pathway A (thrown): synchronous/async failure inside fetchWeatherConditions →
 *     errorMarker is written to weather_current, then re-thrown so the orchestrator's
 *     Promise.allSettled captures it as `failedReasons.weather`.
 *   - Pathway B (graceful): API returns no data (e.g., GOOGLE_MAPS_API_KEY missing,
 *     bad coordinates, API 5xx) → returns `{ weather_current: { temperature: 'N/A',
 *     reason: '...' }, weather_forecast: [], reason: '<string>' }`. The orchestrator
 *     reads `weatherResult.weather_current` directly.
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
    weather_current = result?.current || {
      temperature: 'N/A',
      conditions: 'Weather data could not be retrieved',
      reason: 'Weather API returned no current conditions'
    };
    weather_forecast = result?.forecast || [];
    reason = result?.reason || null;

    await writeSectionAndNotify(snapshotId, {
      weather_current,
      weather_forecast,
    }, CHANNELS.WEATHER);
  } catch (err) {
    weather_current = errorMarker(err);
    weather_forecast = [];
    reason = err.message;
    await writeSectionAndNotify(snapshotId, { weather_current }, CHANNELS.WEATHER);
    throw err;
  }

  return { weather_current, weather_forecast, reason };
}
