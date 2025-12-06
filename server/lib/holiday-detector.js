// server/lib/holiday-detector.js
// Fast holiday detection using Gemini 3 Pro Preview via adapter
import { callGemini } from './adapters/gemini-adapter.js';

/**
 * Detect holiday for a given date/location
 * @param {Object} context - { created_at, city, state, country, timezone }
 * @returns {Promise<{ holiday: string|null, is_holiday: boolean }>}
 */
export async function detectHoliday(context) {
  if (!context.created_at) {
    return { holiday: null, is_holiday: false };
  }

  let formattedDateTime;
  try {
    const utcTime = new Date(context.created_at);
    if (isNaN(utcTime.getTime())) throw new Error("Invalid Date");

    formattedDateTime = new Intl.DateTimeFormat('en-US', {
      timeZone: context.timezone || 'America/Chicago',
      dateStyle: 'full',
      timeStyle: 'short'
    }).format(utcTime);
  } catch (e) {
    console.warn('[holiday-detector] Date parsing error:', e.message);
    return { holiday: null, is_holiday: false };
  }

  const prompt = `Analyze the date and location below.
Date: ${formattedDateTime}
Location: ${context.city}, ${context.state}, ${context.country}

Is there a SIGNIFICANT HOLIDAY observed here today?

INCLUDE:
- Federal/National holidays (Thanksgiving, Christmas, etc.)
- Major religious holidays (Easter, Eid, Diwali, etc.)
- Major cultural events (Mardi Gras, etc.)

EXCLUDE:
- Minor awareness days (National Pizza Day)
- Time changes

RETURN JSON ONLY:
{
  "is_holiday": boolean,
  "name": "Name of Holiday or null"
}`;

  try {
    const result = await callGemini({
      model: 'gemini-3-pro-preview',
      system: 'You are a holiday detector. Return strict JSON only.',
      user: prompt,
      maxTokens: 1000,
      temperature: 0.0
    });

    if (!result.ok) {
      console.warn('[holiday-detector] AI request failed:', result.error);
      return { holiday: null, is_holiday: false };
    }

    const parsed = JSON.parse(result.output);
    
    console.log(`[holiday-detector] 🎉 Result: ${parsed.name || 'None'} (is_holiday=${parsed.is_holiday})`);
    
    return {
      holiday: parsed.is_holiday ? parsed.name : null,
      is_holiday: parsed.is_holiday === true
    };

  } catch (error) {
    console.error('[holiday-detector] ❌ Unexpected error:', error.message);
    return { holiday: null, is_holiday: false };
  }
}
