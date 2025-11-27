// server/lib/weather-traffic-validator.js
// Validate weather and traffic conditions using Gemini 2.5 Pro
import { callGeminiGenerateContent } from './adapters/gemini-2.5-pro.js';

/**
 * Validate weather conditions from snapshot
 * Returns: { valid: boolean, reason?: string, conditions: string }
 */
export async function validateWeather(snapshot) {
  if (!snapshot?.weather) {
    return { valid: true, conditions: 'no_data', reason: 'Weather data not available' };
  }

  try {
    const prompt = `Analyze this rideshare driver weather data and determine if it's safe/viable for work:
Location: ${snapshot.city}, ${snapshot.state}
Temperature: ${snapshot.weather.tempF}°F
Conditions: ${snapshot.weather.conditions}
Description: ${snapshot.weather.description}
Humidity: ${snapshot.weather.humidity}%
Wind Speed: ${snapshot.weather.windSpeed} mph

Respond with ONLY valid JSON (no markdown, no code blocks): { "valid": boolean, "reason": string, "severity": "safe"|"caution"|"hazardous" }
- valid=true if conditions are workable for rideshare
- valid=false if conditions are dangerous/impossible (severe snow, ice, floods, etc)
- severity: safe (normal), caution (rain/wind but workable), hazardous (dangerous)`;

    const result = await callGeminiGenerateContent({
      systemInstruction: 'You are a safety analyst for rideshare drivers. Evaluate if weather conditions are safe enough to work. Always respond with ONLY valid JSON, no markdown formatting.',
      userText: prompt,
      maxOutputTokens: 256,
      temperature: 0.1
    });

    // Extract JSON if wrapped in markdown code blocks
    const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, result];
    const jsonString = jsonMatch[1] || result;
    const parsed = JSON.parse(jsonString.trim());
    console.log('[weather-validator] Result:', parsed);
    
    return {
      valid: parsed.valid === true,
      reason: parsed.reason || 'No reason provided',
      severity: parsed.severity || 'safe',
      conditions: `${snapshot.weather.tempF}°F, ${snapshot.weather.conditions}`
    };
  } catch (err) {
    console.error('[weather-validator] Error:', err.message);
    return { 
      valid: true, 
      conditions: 'validation_error', 
      reason: err.message,
      severity: 'unknown'
    };
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
    const prompt = `Analyze this airport/traffic disruption data for rideshare viability:
Airport: ${airport_context.airport_code} - ${airport_context.airport_name}
Distance: ${airport_context.distance_miles} miles
Delays: ${airport_context.delay_minutes} minutes
Reason: ${airport_context.delay_reason || 'none'}
Closure Status: ${airport_context.closure_status}

Respond with ONLY valid JSON (no markdown, no code blocks): { "valid": boolean, "reason": string, "impact": "low"|"medium"|"high", "recommendation": string }
- valid=true if traffic allows rideshare operations
- valid=false if conditions prevent movement (airport closure, major gridlock)
- impact: low (minimal effect), medium (noticeable delays), high (severe disruption)`;

    const result = await callGeminiGenerateContent({
      systemInstruction: 'You are a traffic analyst for rideshare operations. Evaluate if traffic/airport conditions allow work. Always respond with ONLY valid JSON, no markdown formatting.',
      userText: prompt,
      maxOutputTokens: 256,
      temperature: 0.1
    });

    // Extract JSON if wrapped in markdown code blocks
    const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, result];
    const jsonString = jsonMatch[1] || result;
    const parsed = JSON.parse(jsonString.trim());
    console.log('[traffic-validator] Result:', parsed);
    
    return {
      valid: parsed.valid === true,
      reason: parsed.reason || 'No reason provided',
      impact: parsed.impact || 'low',
      recommendation: parsed.recommendation || 'Operations normal'
    };
  } catch (err) {
    console.error('[traffic-validator] Error:', err.message);
    return { 
      valid: true, 
      impact: 'unknown', 
      reason: err.message,
      recommendation: 'Unable to validate'
    };
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
  
  console.log('[conditions-validator] Final:', {
    valid: isValid,
    weather: { valid: weather.valid, severity: weather.severity },
    traffic: { valid: traffic.valid, impact: traffic.impact }
  });

  return {
    valid: isValid,
    weather,
    traffic,
    rejectionReason: isValid ? null : `Weather: ${!weather.valid ? weather.reason : 'ok'}, Traffic: ${!traffic.valid ? traffic.reason : 'ok'}`
  };
}
