# Workstream 6 Commit 4: Extract Weather Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract weather logic from `briefing-service.js` into a focused pipeline module (`pipelines/weather.js`) with the canonical `{ <section>, reason }` contract, AND delete one provably dead code path (LLM-based `fetchWeatherForecast` + `BRIEFING_WEATHER` AI registry role).

**Architecture:** Single pipeline module owns `weather_current` + `weather_forecast` (the only DUAL-section pipeline among the six). Public API: `discoverWeather({ snapshot, snapshotId })` for the orchestrator + re-exported `fetchWeatherConditions({ snapshot })` for direct callers. Helpers (`usesMetric`, `formatTemperature`, `formatWindSpeed`, `generateWeatherDriverImpact`) become module-private. Live path uses Google Weather API only — superseded LLM path removed.

**Tech Stack:** Node.js ESM, `briefing-notify` primitives (`writeSectionAndNotify`, `CHANNELS`, `errorMarker`), Google Weather API (`weather.googleapis.com/v1/currentConditions:lookup` + `forecast/hours:lookup`).

---

## Context references

- **Architecture spec:** `docs/review-queue/PLAN_workstream6_briefing_split.md` (approved 2026-05-02)
- **Execution lessons + remaining commits:** `docs/review-queue/PLAN_workstream6_remaining-2026-05-02.md`
- **Pilot precedent:** `server/lib/briefing/pipelines/schools.js` (commit `5fd74087`) — established the wider `{ <section>, reason }` contract and the legacy re-export pattern
- **Drift signal resolution:** `fetchWeatherForecast` had ZERO callers across `server/`, `client/`, `shared/`. It was an LLM-based weather implementation superseded by the deterministic Google Weather API path. `BRIEFING_WEATHER` role in `model-registry.js` was used only by this dead function. Resolution: delete both, preserving `fetchWeatherConditions` as the live path.

## File structure

| File | Action | Responsibility |
|---|---|---|
| `server/lib/briefing/pipelines/weather.js` | CREATE | New pipeline module owning weather sections + Google Weather API call + driver-impact summarizer |
| `server/lib/briefing/briefing-service.js` | MODIFY | Add imports, re-export `fetchWeatherConditions`, replace orchestrator weatherPromise block, update final-assembly field reads, delete dead weather block (~270 lines) |
| `server/lib/ai/model-registry.js` | MODIFY | Delete `BRIEFING_WEATHER` entry (no live caller after this commit); update JSDoc example at line 460 if it references the deleted role |
| `server/lib/ai/adapters/README.md` | MODIFY | Delete `BRIEFING_WEATHER` row from registry table |
| `claude_memory` (Postgres row, INSERT) | INSERT | Log drift resolution per Rule 15 + handoff directive |

## Out of scope (this commit)

- Behavioral change: this is a refactor — same input, same output, same SSE write events
- Per-pipeline unit tests: deferred to commit 11 (parity test suite)
- Migrating `server/api/briefing/briefing.js` to import directly from `pipelines/weather.js`: that's Phase 2 (post ≥7-day soak)
- Touching `briefing-aggregator.js`: that's commit 9
- Other 5 pipelines (events, traffic, news, airport): commits 5-8

## Verification approach (this commit)

This is a refactor with no behavior change, so traditional unit-test TDD doesn't fit (and would be premature given commit 11's parity-test plan). The verification gate is the §4 pre-commit checklist from `PLAN_workstream6_remaining-2026-05-02.md`:

1. `node --check` on both files (syntax)
2. Dynamic-import smoke test on the new module (loads cleanly)
3. Grep audits: no orphan local definitions, no orphan literal channel strings, no broken external imports
4. Final-assembly shape consistency: every `weatherResult?.X` reference uses the new field names

If parity is tested manually by hitting `/api/blocks-fast`, the briefings row's `weather_current` and `weather_forecast` columns must be populated identically before-and-after.

---

## Tasks

### Task 1: Create `pipelines/weather.js` skeleton with imports + private helpers

**Files:**
- Create: `server/lib/briefing/pipelines/weather.js`

- [ ] **Step 1: Create the file with header and imports**

Write to `server/lib/briefing/pipelines/weather.js`:

```js
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
// was pruned alongside it (model-registry.js).
//
// Logging tag: [BRIEFING][WEATHER] (per the 9-stage taxonomy enforcement principle —
// the file location IS the taxonomy declaration).

import { briefingLog, OP } from '../../../logger/workflow.js';
import { writeSectionAndNotify, CHANNELS, errorMarker } from '../briefing-notify.js';
```

- [ ] **Step 2: Append the private formatting helpers**

Append to `server/lib/briefing/pipelines/weather.js`:

```js

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
```

- [ ] **Step 3: Append `generateWeatherDriverImpact` (deterministic summary)**

Append to `server/lib/briefing/pipelines/weather.js`:

```js

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
```

- [ ] **Step 4: Run syntax check**

Run: `node --check server/lib/briefing/pipelines/weather.js`
Expected: no output (silent success). Failure indicates a transcription error in steps 1-3 — re-check brace balance.

---

### Task 2: Add `fetchWeatherConditions` (the live path)

**Files:**
- Modify: `server/lib/briefing/pipelines/weather.js` (append exported function)

- [ ] **Step 1: Append the exported `fetchWeatherConditions`**

Append to `server/lib/briefing/pipelines/weather.js`:

```js

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
```

- [ ] **Step 2: Verify syntax**

Run: `node --check server/lib/briefing/pipelines/weather.js`
Expected: silent success.

---

### Task 3: Add the `discoverWeather` pipeline contract

**Files:**
- Modify: `server/lib/briefing/pipelines/weather.js` (append the exported pipeline entry)

- [ ] **Step 1: Append `discoverWeather`**

Append to `server/lib/briefing/pipelines/weather.js`:

```js

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
```

- [ ] **Step 2: Verify syntax**

Run: `node --check server/lib/briefing/pipelines/weather.js`
Expected: silent success.

- [ ] **Step 3: Dynamic-import smoke test**

Run:
```bash
timeout 8 node -e "import('./server/lib/briefing/pipelines/weather.js').then(m => console.log('exports:', Object.keys(m).join(', ')))"
```
Expected: `exports: fetchWeatherConditions, discoverWeather` printed before timer fires (exit 124 from timeout is fine — drizzle holds the pool open in this codebase). If the line doesn't print, the import failed — re-check imports in step 1 of Task 1.

---

### Task 4: Wire `briefing-service.js` to the new module

**Files:**
- Modify: `server/lib/briefing/briefing-service.js` (add imports, replace orchestrator block, update final-assembly field reads)

- [ ] **Step 1: Add the import + re-export, just below the schools import block**

Find the schools import block (currently around line 28-31):
```js
// 2026-05-02: Workstream 6 Step 1 — schools pipeline extracted as the pilot (commit 3/11).
// fetchSchoolClosures re-exported below to preserve the public API surface.
import { discoverSchools, fetchSchoolClosures } from './pipelines/schools.js';
export { fetchSchoolClosures };
```

Insert immediately after this block:
```js

// 2026-05-02: Workstream 6 Step 1 — weather pipeline extracted (commit 4/11).
// fetchWeatherConditions re-exported below to preserve the public API surface
// (server/api/briefing/briefing.js imports it directly for refresh endpoints).
import { discoverWeather, fetchWeatherConditions } from './pipelines/weather.js';
export { fetchWeatherConditions };
```

Use Edit with `old_string` matching the schools block exactly (including final newline) and `new_string` containing the schools block + the new weather block.

- [ ] **Step 2: Replace the orchestrator's `weatherPromise` block**

Find current code at briefing-service.js (grep first to confirm line):
```bash
grep -nE "const weatherPromise = fetchWeatherConditions" server/lib/briefing/briefing-service.js
```

Replace the entire `.then(...).catch(...)` chain (currently lines 2701-2712) using Edit.

`old_string` (current code):
```js
  const weatherPromise = fetchWeatherConditions({ snapshot })
    .then(async (r) => {
      await writeSectionAndNotify(snapshotId, {
        weather_current: r?.current || { temperature: 'N/A', conditions: 'Weather data could not be retrieved', reason: 'Weather API returned no current conditions' },
        weather_forecast: r?.forecast || [],
      }, CHANNELS.WEATHER);
      return r;
    })
    .catch(async (err) => {
      await writeSectionAndNotify(snapshotId, { weather_current: errorMarker(err) }, CHANNELS.WEATHER);
      throw err;
    });
```

`new_string` (replacement):
```js
  // 2026-05-02: Workstream 6 commit 4 — discoverWeather owns its writeSectionAndNotify
  // (single dual-section call) and its errorMarker .catch. Returns
  // { weather_current, weather_forecast, reason }; the final-assembly block below
  // reads from the new shape.
  const weatherPromise = discoverWeather({ snapshot, snapshotId });
```

- [ ] **Step 3: Update the final-assembly field reads (3 references)**

Find references with grep:
```bash
grep -nE "weatherResult\?\.(current|forecast)" server/lib/briefing/briefing-service.js
```

Three references should be found. Update each via Edit:

**3a — `forecastHours` derivation (around line 2831):**
- `old_string`: `const forecastHours = weatherResult?.forecast?.length || 0;`
- `new_string`: `const forecastHours = weatherResult?.weather_forecast?.length || 0;`

**3b — `weatherCurrent` fallback derivation (around line 2843):**
- `old_string`:
  ```js
  const weatherCurrent = weatherResult?.current || {
  ```
- `new_string`:
  ```js
  const weatherCurrent = weatherResult?.weather_current || {
  ```

**3c — `weather_forecast` in `briefingData` (around line 2863):**
- `old_string`: `    weather_forecast: weatherResult?.forecast || [],`
- `new_string`: `    weather_forecast: weatherResult?.weather_forecast || [],`

- [ ] **Step 4: Verify syntax + grep for remaining old-shape references**

Run:
```bash
node --check server/lib/briefing/briefing-service.js
```
Expected: silent success.

Run:
```bash
grep -nE "weatherResult\?\.(current|forecast)\b" server/lib/briefing/briefing-service.js
```
Expected: zero hits (all migrated to `weather_current`/`weather_forecast`).

---

### Task 5: Delete dead weather code from `briefing-service.js`

**Files:**
- Modify: `server/lib/briefing/briefing-service.js` (delete ~270 lines)

- [ ] **Step 1: Find current line ranges with grep**

Run:
```bash
grep -nE "^export async function fetchWeather(Forecast|Conditions)|^function (usesMetric|formatTemperature|formatWindSpeed|generateWeatherDriverImpact)|^export async function fetchTrafficConditions" server/lib/briefing/briefing-service.js
```

Expected output (line numbers will have shifted slightly from initial reads — that's fine):
```
NNNN:export async function fetchWeatherForecast({ snapshot }) {
NNNN:function usesMetric(country) {
NNNN:function formatTemperature(tempC, country) {
NNNN:function formatWindSpeed(windSpeedMs, country) {
NNNN:export async function fetchWeatherConditions({ snapshot }) {
NNNN:function generateWeatherDriverImpact(current, forecast = []) {
NNNN:export async function fetchTrafficConditions({ snapshot }) {
```

Capture **START** = line number of `fetchWeatherForecast` declaration.
Capture **END** = (line number of `fetchTrafficConditions` declaration) − 1.
The range to delete is `START` to `END` inclusive.

- [ ] **Step 2: Verify the START boundary by reading 3 lines before it**

Run: `sed -n "$((START - 3)),$((START + 1))p" server/lib/briefing/briefing-service.js`
Expected: a blank line or a closing brace from the previous function, then the `export async function fetchWeatherForecast` line.

- [ ] **Step 3: Verify the END boundary**

Run: `sed -n "$((END - 1)),$((END + 2))p" server/lib/briefing/briefing-service.js`
Expected: the closing `}` of `generateWeatherDriverImpact`, possibly a blank line, then `export async function fetchTrafficConditions`. The END line should be a blank line (or the `}` of `generateWeatherDriverImpact` if there's no trailing blank).

- [ ] **Step 4: Delete the line range**

Run: `sed -i "${START},${END}d" server/lib/briefing/briefing-service.js`

- [ ] **Step 5: Verify the seam looks clean**

Run: `sed -n "$((START - 3)),$((START + 3))p" server/lib/briefing/briefing-service.js`
Expected: previous function's `}`, one blank line, then `export async function fetchTrafficConditions`. If two blank lines, that's tolerable (matches existing spacing). If zero blank lines, add one with: `sed -i "$((START - 1))a\\" server/lib/briefing/briefing-service.js`.

- [ ] **Step 6: Verify syntax + audit for orphans**

Run:
```bash
node --check server/lib/briefing/briefing-service.js
```
Expected: silent success.

Run:
```bash
grep -nE "^(export async )?function (fetchWeather(Forecast|Conditions)|usesMetric|formatTemperature|formatWindSpeed|generateWeatherDriverImpact)\b" server/lib/briefing/briefing-service.js
```
Expected: zero hits (all definitions removed).

Run (only orphan call sites are concerning — imports are fine):
```bash
grep -nE "\bfetchWeatherForecast\b|\busesMetric\b|\bformatTemperature\b|\bformatWindSpeed\b|\bgenerateWeatherDriverImpact\b" server/lib/briefing/briefing-service.js
```
Expected: zero hits (all callers were inside the deleted block).

Run (call sites for `fetchWeatherConditions` should now resolve via the import added in Task 4 step 1):
```bash
grep -nE "\bfetchWeatherConditions\b" server/lib/briefing/briefing-service.js
```
Expected: 2 hits — one in the import line, one in the export line. The orchestrator no longer calls it directly (it calls `discoverWeather`).

---

### Task 6: Prune `BRIEFING_WEATHER` from the AI registry

**Files:**
- Modify: `server/lib/ai/model-registry.js`
- Modify: `server/lib/ai/adapters/README.md`

- [ ] **Step 1: Delete the `BRIEFING_WEATHER` entry from `model-registry.js`**

Use Edit on `server/lib/ai/model-registry.js`:

`old_string`:
```js
  BRIEFING_WEATHER: {
    envKey: 'BRIEFING_WEATHER_MODEL',
    default: 'gemini-3.1-pro-preview',
    purpose: 'Weather intelligence with web search',
    maxTokens: 4096,
    temperature: 0.1,
    features: ['google_search'],
  },
```

`new_string`: (empty — pure deletion)

- [ ] **Step 2: Check JSDoc example references to BRIEFING_WEATHER**

Run:
```bash
grep -nE "BRIEFING_WEATHER" server/lib/ai/model-registry.js
```

Expected hits AFTER step 1:
- A historical changelog comment (e.g., "2026-04-04: FIX H-3 — Added BRIEFING_WEATHER, BRIEFING_TRAFFIC...") — KEEP, it's history
- A historical changelog comment about a partial revert — KEEP
- Possibly a JSDoc `@param` example using `'BRIEFING_WEATHER'` as a sample role key — UPDATE to `'BRIEFING_TRAFFIC'`

For the JSDoc example update (if present), use Edit:
- `old_string`: `'BRIEFING_WEATHER' or legacy 'strategist'`
- `new_string`: `'BRIEFING_TRAFFIC' or legacy 'strategist'`

If grep shows the JSDoc example uses different exact wording, adjust the Edit accordingly. If only the historical comments remain, skip this step.

- [ ] **Step 3: Delete the row from `adapters/README.md`**

Use Edit on `server/lib/ai/adapters/README.md`:

`old_string`:
```
| **BRIEFINGS TABLE** |||
| `BRIEFING_WEATHER` | Weather intelligence | Gemini 3 Pro |
| `BRIEFING_TRAFFIC` | Traffic conditions | Gemini 3 Flash |
```

`new_string`:
```
| **BRIEFINGS TABLE** |||
| `BRIEFING_TRAFFIC` | Traffic conditions | Gemini 3 Flash |
```

- [ ] **Step 4: Verify model-registry.js still parses**

Run:
```bash
node --check server/lib/ai/model-registry.js
```
Expected: silent success.

---

### Task 7: §4 Pre-commit checklist (the verification gate)

**Files:**
- No file changes; only audits.

- [ ] **Step 1: Both files parse**

Run (in parallel via shell):
```bash
node --check server/lib/briefing/briefing-service.js && \
node --check server/lib/briefing/pipelines/weather.js && \
node --check server/lib/ai/model-registry.js && \
echo "ALL PARSE OK"
```
Expected: `ALL PARSE OK` printed.

- [ ] **Step 2: No orphan local function definitions in briefing-service.js**

Run:
```bash
grep -nE "^(export async )?function (fetchWeather|usesMetric|formatTemperature|formatWindSpeed|generateWeatherDriverImpact)" server/lib/briefing/briefing-service.js
```
Expected: zero hits.

- [ ] **Step 3: No literal channel string for weather (must use `CHANNELS.WEATHER`)**

Run:
```bash
grep -nE "'briefing_weather_ready'" server/lib/briefing/briefing-service.js server/lib/briefing/pipelines/weather.js
```
Expected: zero hits in both files.

- [ ] **Step 4: External callers of weather still resolve**

Run:
```bash
grep -rn "from.*briefing-service" server/ client/ 2>/dev/null | grep -v node_modules | grep -i weather
```
Expected: shows `server/api/briefing/briefing.js` importing `fetchWeatherConditions` from `briefing-service` — this still resolves via the re-export added in Task 4 step 1.

Then run a paranoia check that the re-export chain works:
```bash
timeout 8 node -e "import('./server/lib/briefing/briefing-service.js').then(m => console.log('fetchWeatherConditions present:', typeof m.fetchWeatherConditions))"
```
Expected: `fetchWeatherConditions present: function` printed before timer fires.

- [ ] **Step 5: Dynamic-import the new pipeline module**

Run:
```bash
timeout 8 node -e "import('./server/lib/briefing/pipelines/weather.js').then(m => console.log('exports:', Object.keys(m).join(', ')))"
```
Expected: `exports: fetchWeatherConditions, discoverWeather` printed.

- [ ] **Step 6: Final-assembly shape consistency in briefing-service.js**

Run:
```bash
grep -nE "weatherResult\?\." server/lib/briefing/briefing-service.js
```
Expected: every match references `weather_current` or `weather_forecast` (NOT `current` or `forecast` directly — those would be the old shape).

---

### Task 8: Log resolution to `claude_memory` + commit

**Files:**
- Insert: row in `claude_memory` table (Postgres, dev DB)
- Commit: `git commit` covering all modified files

- [ ] **Step 1: Insert the resolution row into `claude_memory`**

Run:
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO claude_memory (category, priority, status, title, content, source, tags, related_files)
VALUES (
  'engineering-pattern',
  'high',
  'active',
  'Weather entry-point drift resolved — fetchWeatherForecast was dead code',
  $$Drift signal from PLAN_workstream6_remaining-2026-05-02.md §3 commit 4: are fetchWeatherForecast and fetchWeatherConditions distinct concerns or duplicates?

Resolution (Workstream 6 commit 4, 2026-05-02):

- fetchWeatherForecast (LLM-based via callModel('BRIEFING_WEATHER')) had ZERO callers across server/, client/, shared/. Last functional change Dec 10 2025; only May 2026 touch was matrixLog telemetry tags.
- fetchWeatherConditions (Google Weather API, deterministic) is the live path with 3 callers: orchestrator's weatherPromise + 2 in server/api/briefing/briefing.js (refresh endpoints).
- The two were not "distinct" or "one-wraps-the-other" — they were two implementations of the same concept; the LLM version was superseded and never deleted.

Action taken:
1. Deleted fetchWeatherForecast + the four formatter helpers (now private inside pipelines/weather.js)
2. Pruned BRIEFING_WEATHER from server/lib/ai/model-registry.js (no remaining caller)
3. Removed the BRIEFING_WEATHER row from server/lib/ai/adapters/README.md
4. Created server/lib/briefing/pipelines/weather.js exporting discoverWeather (pipeline contract) and fetchWeatherConditions (re-exported live path)

Principle reaffirmed (CLAUDE.md ABSOLUTE PRECISION): "Coordinates always from Google APIs or DB, never from AI." Same principle applies to weather data — Google's deterministic API is authoritative; an LLM guessing temperatures is anti-pattern.

Anti-pattern recorded: keeping superseded LLM implementations as silent dead-code "fallbacks" that no caller invokes. If a fallback is real, it must be wired up; if not, delete it. Re-export shims for the live path are fine (preserves Phase 1 caller compatibility); shims for dead paths are not.$$,
  'claude-code',
  '["workstream6", "briefing-split", "commit-4", "weather", "dead-code-removal"]'::jsonb,
  '["server/lib/briefing/pipelines/weather.js", "server/lib/briefing/briefing-service.js", "server/lib/ai/model-registry.js", "server/lib/ai/adapters/README.md"]'::jsonb
);
SQL
```

Expected: `INSERT 0 1` printed.

- [ ] **Step 2: Stage the affected files**

Run:
```bash
git add \
  server/lib/briefing/pipelines/weather.js \
  server/lib/briefing/briefing-service.js \
  server/lib/ai/model-registry.js \
  server/lib/ai/adapters/README.md
```

Verify only those four are staged:
```bash
git status --short
```
Expected: 4 lines beginning with `A ` or `M `, plus possibly unrelated changes (`.claude/settings.local.json`, `sent-to-strategist.txt`) which should NOT be staged.

- [ ] **Step 3: Commit**

Run (use HEREDOC per CLAUDE.md commit-message rules):
```bash
git commit -m "$(cat <<'EOF'
feat(briefing): extract weather pipeline (commit 4/11)

Workstream 6 Step 1 — extracts the weather pipeline from briefing-service.js
into a focused module + deletes one dead code path along the way.

NEW: server/lib/briefing/pipelines/weather.js
  - discoverWeather({ snapshot, snapshotId }) — pipeline contract entry,
    returns { weather_current, weather_forecast, reason }. Owns the dual-section
    writeSectionAndNotify (the only pipeline that writes two sections in one
    notify) and the errorMarker .catch wrapper.
  - fetchWeatherConditions({ snapshot }) — re-exported live path
    (Google Weather API). Preserves the import surface for
    server/api/briefing/briefing.js.
  - usesMetric, formatTemperature, formatWindSpeed,
    generateWeatherDriverImpact — now module-private.

DRIFT RESOLUTION: fetchWeatherForecast was dead code.
  - Zero callers across server/, client/, shared/.
  - Last functional change Dec 10 2025; only recent touch was matrixLog tags.
  - LLM-based weather violated CLAUDE.md ABSOLUTE PRECISION ("Coordinates
    from Google APIs or DB, never from AI").
  - Deleted along with the BRIEFING_WEATHER role in model-registry.js
    (no remaining caller) and the corresponding row in adapters/README.md.
  - Resolution logged to claude_memory (category=engineering-pattern).

briefing-service.js delta:
  - import { discoverWeather, fetchWeatherConditions } from pipelines/weather.js
  - export { fetchWeatherConditions } (re-export for external surface)
  - orchestrator weatherPromise: replaced .then/.catch chain with direct
    discoverWeather() call (~10 line shrink)
  - final-assembly: weatherResult?.current → weather_current,
    weatherResult?.forecast → weather_forecast (3 references)
  - deleted ~270 lines of weather code (1 dead function, 4 helpers, 1 live)

Verification:
  - node --check on briefing-service.js, pipelines/weather.js, model-registry.js
  - Dynamic import smoke test: weather.js exports
    { fetchWeatherConditions, discoverWeather }
  - grep audits: zero orphan local definitions, zero literal channel strings,
    re-export chain resolves for external callers
  - All 6 SSE channels intact; CHANNELS.WEATHER fires from new pipeline

Per PLAN_workstream6_remaining-2026-05-02.md §2.1 (wider contract),
§2.5 (re-export pattern), §2.3 (sed for line-range deletes).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify commit landed**

Run:
```bash
git log --oneline -3
```
Expected first line: `<hash> feat(briefing): extract weather pipeline (commit 4/11)`

Run:
```bash
git status --short
```
Expected: only `.claude/settings.local.json` and `sent-to-strategist.txt` (unrelated) remain modified.

---

## Self-review checklist (the plan author runs this before handing off)

1. **Spec coverage:** Every section of `PLAN_workstream6_remaining-2026-05-02.md` §3 commit 4 is addressed:
   - ✓ Functions to extract (Tasks 1-2)
   - ✓ §2.6 drift signal resolved (deletion in Task 5 + claude_memory log in Task 8)
   - ✓ Dual-section write special case (Task 3)
   - ✓ Orchestrator block replacement (Task 4 step 2)
   - ✓ Final-assembly shape change (Task 4 step 3)
   - ✓ Caller compat via re-export (Task 4 step 1)
   - ✓ §4 pre-commit checklist (Task 7)
   - ✓ §2.1 wider contract (Task 3 — `{ weather_current, weather_forecast, reason }`)
   - ✓ §2.5 re-export pattern (Task 4 step 1)
   - ✓ §2.3 sed for line-range deletes (Task 5)

2. **Placeholder scan:** No `TBD`, `TODO`, `implement later`, "fill in details", or "similar to Task N" references. Code blocks are complete.

3. **Type consistency:** `discoverWeather` returns `{ weather_current, weather_forecast, reason }` consistently across Tasks 3, 4, 7. The orchestrator's final assembly uses the same field names.

4. **Out-of-scope items:** Phase 2 caller migration, parity test suite (commit 11), other 5 pipelines — explicitly listed in "Out of scope" section.

5. **Reversibility:** All changes are git-tracked; `git revert <hash>` restores all 4 files in one operation. Registry deletion is recoverable.
