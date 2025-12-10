// server/lib/weather-traffic-validator.js
// Validate weather and traffic conditions using Gemini adapter
import { callGemini } from '../ai/adapters/gemini-adapter.js';

const MODEL = process.env.GEMINI_MODEL || 'gemini-3-pro-preview';

/**
 * Validate weather conditions from snapshot
 * Returns: { valid: boolean, reason?: string, conditions: string, severity: string }
 */
export async function validateWeather(snapshot) {
  if (!snapshot?.weather) {
    return { valid: true, conditions: 'no_data', reason: 'Weather data not available', severity: 'unknown' };
  }

  try {
    // Adapter detects "JSON" in prompt and sets responseMimeType: "application/json"
    const prompt = `Analyze this rideshare driver weather data and determine if it's safe/viable for work.

    Data:
    Location: ${snapshot.city}, ${snapshot.state}
    Temperature: ${snapshot.weather.tempF}°F
    Conditions: ${snapshot.weather.conditions}
    Description: ${snapshot.weather.description}
    Humidity: ${snapshot.weather.humidity}%
    Wind Speed: ${snapshot.weather.windSpeed} mph

    Return strict JSON matching this schema:
    {
      "valid": boolean, // true if safe to drive, false if hazardous
      "reason": string, // short explanation
      "severity": "safe" | "caution" | "hazardous"
    }`;

    const result = await callGemini({
      model: MODEL,
      system: 'You are a safety analyst for rideshare drivers. Return strict JSON.',
      user: prompt,
      maxTokens: 512,
      temperature: 0.1 // Low temp for deterministic validation
    });

    if (!result.ok) {
      console.warn('[weather-validator] Gemini failed:', result.error);
      return { valid: true, conditions: 'error', reason: 'Validation service unavailable', severity: 'unknown' };
    }

    // The adapter already handles cleanup, so we can parse directly
    let parsed;
    try {
      parsed = JSON.parse(result.output);
    } catch (e) {
      console.error('[weather-validator] JSON parse failed:', e.message);
      return { valid: true, conditions: 'parse_error', reason: 'Invalid AI response', severity: 'unknown' };
    }

    return {
      valid: parsed.valid === true,
      reason: parsed.reason || 'Weather analyzed',
      severity: parsed.severity || 'safe',
      conditions: `${snapshot.weather.tempF}°F, ${snapshot.weather.conditions}`
    };

  } catch (err) {
    console.error('[weather-validator] Error:', err.message);
    // Fail open (allow driving) if validator breaks, but log it
    return { valid: true, conditions: 'validation_error', reason: 'Validator crashed', severity: 'unknown' };
  }
}

/**
 * Validate traffic conditions from snapshot
 * Returns: { valid: boolean, reason?: string, impact: string }
 */
export async function validateTraffic(snapshot) {
  if (!snapshot?.airport_context) {
    return { valid: true, impact: 'normal', reason: 'No airport disruptions' };
  }

  try {
    const { airport_context } = snapshot;
    const prompt = `Analyze this airport/traffic data for rideshare viability.

    Data:
    Airport: ${airport_context.airport_code}
    Distance: ${airport_context.distance_miles} miles
    Delays: ${airport_context.delay_minutes} minutes
    Closure: ${airport_context.closure_status}

    Return strict JSON matching this schema:
    {
      "valid": boolean, // true if worthwhile to drive, false if gridlocked/closed
      "reason": string,
      "impact": "low" | "medium" | "high"
    }`;

    const result = await callGemini({
      model: MODEL,
      system: 'You are a traffic analyst. Return strict JSON.',
      user: prompt,
      maxTokens: 512,
      temperature: 0.1
    });

    if (!result.ok) {
        return { valid: true, impact: 'low', reason: 'Validation service unavailable' };
    }

    let parsed;
    try {
      parsed = JSON.parse(result.output);
    } catch (e) {
      console.error('[traffic-validator] JSON parse failed:', e.message);
      return { valid: true, impact: 'low', reason: 'Invalid AI response' };
    }

    return {
      valid: parsed.valid === true,
      reason: parsed.reason || 'Traffic analyzed',
      impact: parsed.impact || 'low'
    };

  } catch (err) {
    console.error('[traffic-validator] Error:', err.message);
    return { valid: true, impact: 'low', reason: 'Traffic validation skipped' };
  }
}

/**
 * Combined validation - returns true only if BOTH weather and traffic are acceptable
 */
export async function validateConditions(snapshot) {
  const [weather, traffic] = await Promise.all([
    validateWeather(snapshot),
    validateTraffic(snapshot)
  ]);

  const isValid = weather.valid && traffic.valid;

  // Construct a human-readable rejection reason if needed
  let rejectionReason = null;
  if (!isValid) {
    const reasons = [];
    if (!weather.valid) reasons.push(`Weather: ${weather.reason}`);
    if (!traffic.valid) reasons.push(`Traffic: ${traffic.reason}`);
    rejectionReason = reasons.join('; ');
  }

  console.log('[conditions-validator] Result:', {
    valid: isValid,
    weather_severity: weather.severity,
    traffic_impact: traffic.impact
  });

  return {
    valid: isValid,
    weather,
    traffic,
    rejectionReason
  };
}