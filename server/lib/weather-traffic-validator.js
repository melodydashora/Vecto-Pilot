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

Respond ONLY with JSON object: {"valid": boolean, "reason": string, "severity": "safe"|"caution"|"hazardous"}`;

    const result = await callGeminiGenerateContent({
      systemInstruction: 'You are a safety analyst for rideshare drivers. Always respond with ONLY a JSON object, nothing else.',
      userText: prompt,
      maxOutputTokens: 512,
      temperature: 0.1
    });

    // Safety check: ensure result is not empty
    if (!result || result.trim().length === 0) {
      console.warn('[weather-validator] Empty response from Gemini');
      return { 
        valid: true, 
        conditions: 'no_response', 
        reason: 'Gemini returned empty response',
        severity: 'safe'
      };
    }

    // Clean and parse JSON
    let jsonString = result.trim();
    
    // Remove markdown code blocks if present
    const jsonMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch && jsonMatch[1]) {
      jsonString = jsonMatch[1].trim();
    }

    console.log('[weather-validator] Raw response:', result.substring(0, 100));
    const parsed = JSON.parse(jsonString);
    console.log('[weather-validator] Parsed:', parsed);
    
    return {
      valid: parsed.valid === true,
      reason: parsed.reason || 'Weather analyzed',
      severity: parsed.severity || 'safe',
      conditions: `${snapshot.weather.tempF}°F, ${snapshot.weather.conditions}`
    };
  } catch (err) {
    console.error('[weather-validator] Parse error:', err.message, '| Response preview:', (await callGeminiGenerateContent({
      systemInstruction: 'You are a safety analyst.',
      userText: 'test',
      maxOutputTokens: 50,
      temperature: 0.1
    })).substring(0, 50));
    return { 
      valid: true, 
      conditions: 'validation_error', 
      reason: 'Weather validation skipped',
      severity: 'safe'
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
    const prompt = `Analyze this airport/traffic data for rideshare viability:
Airport: ${airport_context.airport_code}
Distance: ${airport_context.distance_miles} miles
Delays: ${airport_context.delay_minutes} minutes
Closure: ${airport_context.closure_status}

Respond ONLY with JSON: {"valid": boolean, "reason": string, "impact": "low"|"medium"|"high"}`;

    const result = await callGeminiGenerateContent({
      systemInstruction: 'You are a traffic analyst. Always respond with ONLY a JSON object, nothing else.',
      userText: prompt,
      maxOutputTokens: 512,
      temperature: 0.1
    });

    // Safety check: ensure result is not empty
    if (!result || result.trim().length === 0) {
      console.warn('[traffic-validator] Empty response from Gemini');
      return { 
        valid: true, 
        impact: 'low', 
        reason: 'Gemini returned empty response',
        recommendation: 'Operations normal'
      };
    }

    // Clean and parse JSON
    let jsonString = result.trim();
    
    // Remove markdown code blocks if present
    const jsonMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch && jsonMatch[1]) {
      jsonString = jsonMatch[1].trim();
    }

    console.log('[traffic-validator] Raw response:', result.substring(0, 100));
    const parsed = JSON.parse(jsonString);
    console.log('[traffic-validator] Parsed:', parsed);
    
    return {
      valid: parsed.valid === true,
      reason: parsed.reason || 'Traffic analyzed',
      impact: parsed.impact || 'low',
      recommendation: parsed.recommendation || 'Operations normal'
    };
  } catch (err) {
    console.error('[traffic-validator] Parse error:', err.message);
    return { 
      valid: true, 
      impact: 'low', 
      reason: 'Traffic validation skipped',
      recommendation: 'Operations normal'
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
