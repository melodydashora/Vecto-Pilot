// server/lib/providers/holiday-checker.js
// Early holiday detection using Gemini 3 Pro Preview for instant UI feedback

import { db } from '../../db/drizzle.js';
import { strategies } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { getSnapshotContext } from '../snapshot/get-snapshot-context.js';

/**
 * Fast holiday check using Gemini 3 Pro Preview
 * Runs EARLY in pipeline to show holiday banner while main AI processes
 * @param {string} snapshotId - UUID of snapshot
 */
export async function runHolidayCheck(snapshotId) {
  const startTime = Date.now();
  console.log(`[holiday-check] 🎉 Starting for snapshot ${snapshotId}`);
  
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[holiday-check] ⚠️ GEMINI_API_KEY not configured, skipping');
    return { ok: false, reason: 'no_api_key' };
  }
  
  try {
    // Get snapshot context for date/time
    const ctx = await getSnapshotContext(snapshotId);
    
    // Format date/time for Gemini
    const currentTime = new Date(ctx.created_at);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    
    const dayName = dayNames[currentTime.getDay()];
    const monthName = monthNames[currentTime.getMonth()];
    const dayNum = currentTime.getDate();
    const year = currentTime.getFullYear();
    
    const formattedDate = `${dayName}, ${monthName} ${dayNum}, ${year}`;
    
    console.log(`[holiday-check] 📅 Checking date: ${formattedDate}`);
    
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `What holiday is celebrated on ${formattedDate} in the United States? Include cultural holidays like Día de los Muertos. Answer with ONLY the holiday name (e.g., "Día de los Muertos", "Halloween", "Independence Day") or "none".`
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 50
        }
      }),
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });
    
    if (!response.ok) {
      console.error(`[holiday-check] ❌ Gemini API error: ${response.status}`);
      return { ok: false, error: `api_error_${response.status}` };
    }
    
    const data = await response.json();
    const holidayText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    
    // Parse holiday (clean up response)
    let holiday = null;
    if (holidayText && holidayText.toLowerCase() !== 'none' && holidayText.length > 0 && holidayText.length < 100) {
      // Clean up common response patterns
      holiday = holidayText
        .replace(/^(today is |it is |the holiday is )/i, '')
        .replace(/\.$/, '')
        .trim();
      
      // Validate it looks like a holiday name
      if (holiday.split(' ').length > 8) {
        console.warn(`[holiday-check] ⚠️ Response too long, likely not a holiday: "${holiday}"`);
        holiday = null;
      }
    }
    
    const duration = Date.now() - startTime;
    
    if (holiday) {
      console.log(`[holiday-check] ✅ Holiday detected: "${holiday}" (${duration}ms)`);
      
      // Write to strategies.holiday column IMMEDIATELY for instant UI feedback
      await db.update(strategies).set({
        holiday,
        updated_at: new Date()
      }).where(eq(strategies.snapshot_id, snapshotId));
      
      console.log(`[holiday-check] 💾 Written to DB: "${holiday}"`);
      
      return { ok: true, holiday, duration_ms: duration };
    } else {
      console.log(`[holiday-check] ℹ️ No holiday detected (${duration}ms)`);
      return { ok: true, holiday: null, duration_ms: duration };
    }
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[holiday-check] ❌ Error after ${duration}ms:`, error.message);
    
    // Don't throw - holiday check is non-critical
    return { ok: false, error: error.message, duration_ms: duration };
  }
}
