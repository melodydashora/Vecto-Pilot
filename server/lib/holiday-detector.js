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

Use web search to find the MOST SIGNIFICANT holiday observed on ${formattedDateTime} in ${context.country} and specifically in ${context.state}.

Priority order (return the highest priority match):
1. Federal/National holidays (e.g., Independence Day, Thanksgiving, Christmas)
2. Major state holidays or observances
3. Widely-observed religious holidays (e.g., Easter, Rosh Hashanah, Eid, Diwali)
4. Major cultural celebrations (e.g., Día de los Muertos, Lunar New Year)

EXCLUDE minor observances, quirky "national days" (e.g., National Sandwich Day, National Donut Day), and commercial pseudo-holidays.

Return ONLY the single most significant holiday name for rideshare drivers, or empty string if no significant holiday exists today.`
          }
        ],
        max_tokens: 100,
        temperature: 0.1,
        search_recency_filter: 'day',
        stream: false
      })
    });

    if (!response.ok) {
      console.warn('[holiday-detector] ⚠️  Perplexity API error:', response.status);
      return { holiday: null, is_holiday: false };
    }

    const data = await response.json();
    const holidayText = data.choices?.[0]?.message?.content?.trim() || '';
    
    // Clean up response - remove extra text, just get the holiday name
    const cleanHoliday = holidayText
      .replace(/^(The primary holiday|Today is|November \d+, \d+ is)\s*/i, '')
      .replace(/\.$/, '')
      .replace(/\[.*?\]/g, '') // Remove citations like [2]
      .trim();
    
    const isHoliday = cleanHoliday.length > 0 && 
                     !cleanHoliday.toLowerCase().includes('no') &&
                     !cleanHoliday.toLowerCase().includes('not a holiday');

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
