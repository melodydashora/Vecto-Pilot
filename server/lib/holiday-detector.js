// server/lib/holiday-detector.js
// Fast holiday detection using Perplexity - runs during snapshot creation

/**
 * Detect holiday for a given date/location using Perplexity API
 * Runs in parallel with airport/weather enrichment during snapshot creation
 * @param {Object} context - { created_at, city, state, country, timezone }
 * @returns {Promise<{ holiday: string|null, is_holiday: boolean }>}
 */
export async function detectHoliday(context) {
  try {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      console.warn('[holiday-detector] ⚠️  PERPLEXITY_API_KEY not set - skipping holiday detection');
      return { holiday: null, is_holiday: false };
    }

    // Format date/time for prompt (CRITICAL: Convert UTC to local timezone)
    const utcTime = new Date(context.created_at);
    const userTimezone = context.timezone || 'America/Chicago';
    
    // Get all components in user's local timezone
    const dateFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: userTimezone,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    });
    
    const formattedDateTime = dateFormatter.format(utcTime);

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [
          {
            role: 'system',
            content: 'You are a holiday detection assistant. Use live web search to verify holidays. Return ONLY the primary holiday name or empty string if not a holiday.'
          },
          {
            role: 'user',
            content: `Date: ${formattedDateTime}
Timezone: ${context.timezone}
Location: ${context.city}, ${context.state}, ${context.country}

Is there a SIGNIFICANT HOLIDAY observed on ${formattedDateTime} in ${context.country}, specifically in ${context.state}?

ONLY consider these as holidays:
1. Federal/National holidays (e.g., Independence Day, Thanksgiving, Christmas, New Year's Day, Memorial Day, Labor Day, Presidents Day, Veterans Day)
2. Major state holidays with government/business closures
3. Widely-observed religious holidays (e.g., Easter, Good Friday, Rosh Hashanah, Yom Kippur, Eid al-Fitr, Diwali)
4. Major cultural celebrations that impact traffic patterns (e.g., Día de los Muertos, Mardi Gras, Lunar New Year)

DO NOT RETURN:
- Time changes (e.g., "Daylight Saving Time Ends", "Spring Forward")
- Minor observances or awareness days (e.g., "National Sandwich Day", "National Donut Day")
- Commercial pseudo-holidays
- Election days (unless it's a major national election)

Return ONLY the holiday name if one exists, otherwise return empty string.`
          }
        ],
        max_tokens: 100,
        temperature: 0.1,
        search_recency_filter: 'day',
        stream: false
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[holiday-detector] ❌ Perplexity API error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorBody
      });
      return { holiday: null, is_holiday: false };
    }

    const data = await response.json();
    const holidayText = data.choices?.[0]?.message?.content?.trim() || '';
    
    // Clean up response - remove extra text, just get the holiday name
    let cleanHoliday = holidayText
      .replace(/^(The primary holiday|Today is|November \d+, \d+ is)\s*/i, '')
      .replace(/\.$/, '')
      .replace(/\[.*?\]/g, '') // Remove citations like [2]
      .replace(/^["']+|["']+$/g, '') // Remove surrounding quotes
      .trim();
    
    // Filter out non-holiday responses
    const isHoliday = cleanHoliday.length > 0 && 
                     cleanHoliday.length < 100 && // Reject overly long responses
                     !cleanHoliday.toLowerCase().includes('no') &&
                     !cleanHoliday.toLowerCase().includes('not a holiday') &&
                     !cleanHoliday.toLowerCase().includes('empty string') &&
                     !/^["'\s]+$/.test(cleanHoliday); // Reject only quotes/whitespace

    console.log(`[holiday-detector] 🎉 Holiday detection: "${cleanHoliday}" (is_holiday=${isHoliday})`);
    
    return {
      holiday: isHoliday ? cleanHoliday : null,
      is_holiday: isHoliday
    };
  } catch (error) {
    console.error('[holiday-detector] ❌ Error:', error.message);
    return { holiday: null, is_holiday: false };
  }
}
