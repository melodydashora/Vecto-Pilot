// server/lib/holiday-detector.js
// Fast holiday detection using Gemini 3.0 Pro Preview with Google Search
// explicitly configured with tools and safety overrides.

/**
 * Detect holiday for a given date/location using Gemini 3.0 Pro
 * @param {Object} context - { created_at, city, state, country, timezone }
 * @returns {Promise<{ holiday: string|null, is_holiday: boolean }>}
 */
export async function detectHoliday(context) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[holiday-detector] ⚠️ GEMINI_API_KEY not set - skipping holiday detection');
    return { holiday: null, is_holiday: false };
  }

  // 1. Format date for the user's specific timezone
  let formattedDate;
  try {
    const utcTime = new Date(context.created_at || new Date());
    formattedDate = new Intl.DateTimeFormat('en-US', {
      timeZone: context.timezone || 'America/Chicago',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(utcTime);
  } catch (e) {
    console.warn('[holiday-detector] Date formatting error:', e.message);
    formattedDate = new Date().toISOString();
  }

  // 2. Strict JSON Prompt
  const prompt = `Use Google Search to determine if ${formattedDate} is a significant holiday in ${context.city}, ${context.state}.

  CRITERIA for "Significant":
  - Federal/National holidays (e.g. Thanksgiving, Christmas, Memorial Day)
  - Major religious observances (e.g. Easter, Eid, Yom Kippur)
  - Major cultural events affecting traffic/business (e.g. Mardi Gras)

  EXCLUDE:
  - Minor awareness days (e.g. Pizza Day, Siblings Day)
  - Time changes (e.g. Daylight Savings)

  RETURN ONLY JSON:
  {
    "is_holiday": boolean,
    "name": "Holiday Name" or null,
    "type": "federal" | "religious" | "cultural" | "none"
  }`;

  try {
    // 3. Raw Fetch to Gemini 3.0 Pro Preview with specific arguments
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }]
            }
          ],
          tools: [{ google_search: {} }],
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
          ],
          generationConfig: {
            thinkingConfig: {
              thinkingLevel: "HIGH"
            },
            temperature: 0.1,
            topP: 0.95,
            topK: 40,
            responseMimeType: "application/json"
          }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[holiday-detector] Gemini API Error ${response.status}: ${errText.substring(0, 200)}`);
      return { holiday: null, is_holiday: false };
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;

    if (!text) {
      console.warn('[holiday-detector] Empty response from Gemini');
      return { holiday: null, is_holiday: false };
    }

    // 4. Parse Strict JSON
    try {
      const parsed = JSON.parse(text);

      const isHoliday = parsed.is_holiday === true;
      const holidayName = isHoliday ? parsed.name : null;

      console.log(`[holiday-detector] 📅 ${formattedDate}: ${holidayName || 'None'} (Is Holiday: ${isHoliday})`);

      return {
        holiday: holidayName,
        is_holiday: isHoliday
      };
    } catch (parseErr) {
      console.error('[holiday-detector] JSON Parse Failed:', parseErr.message, 'Raw:', text.substring(0, 100));
      return { holiday: null, is_holiday: false };
    }

  } catch (error) {
    console.error('[holiday-detector] Network/System Error:', error.message);
    return { holiday: null, is_holiday: false };
  }
}