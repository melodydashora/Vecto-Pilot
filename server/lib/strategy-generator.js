// server/lib/strategy-generator.js
// Auto-generates strategic overview using GPT-5 with transient retry
import { db } from '../db/drizzle.js';
import { snapshots, strategies } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { callGPT5WithBudget } from './gpt5-retry.js';
import { capturelearning, LEARNING_EVENTS } from '../middleware/learning-capture.js';
import { indexStrategy } from './semantic-search.js';

export async function generateStrategyForSnapshot(snapshot_id) {
  const startTime = Date.now();
  
  try {
    console.log(`[triad] strategist.start id=${snapshot_id}`);
    
    const [snap] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshot_id));
    
    if (!snap) {
      console.warn(`[triad] strategist.err id=${snapshot_id} reason=snapshot_not_found ms=${Date.now() - startTime}`);
      return null;
    }
    
    if (!snap.city && !snap.formatted_address) {
      console.log(`[triad] strategist.skip id=${snapshot_id} reason=no_location_data ms=${Date.now() - startTime}`);
      return null;
    }
    
    // Create or update strategy record with pending status
    await db.insert(strategies).values({
      snapshot_id,
      status: 'pending',
      attempt: 1,
    }).onConflictDoUpdate({
      target: strategies.snapshot_id,
      set: {
        status: 'pending',
        error_code: null,
        error_message: null,
        updated_at: new Date(),
      }
    });
    
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = snap.dow !== null && snap.dow !== undefined ? dayNames[snap.dow] : 'unknown day';
    
    // Format exact time from timestamp
    const exactTime = snap.created_at ? new Date(snap.created_at).toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      timeZone: snap.timezone // No fallback - timezone required
    }) : 'unknown time';
    
    // Build weather string with all details
    const weatherStr = snap.weather 
      ? `${snap.weather.tempF}°F ${snap.weather.conditions}, ${snap.weather.humidity}% humidity, wind ${snap.weather.windSpeed} mph` 
      : 'weather unknown';
    
    // Build air quality string
    const airStr = snap.air 
      ? `AQI ${snap.air.aqi} (${snap.air.category})` 
      : 'air quality unknown';
    
    // Only include airport if within 20 miles
    const airportStr = snap.airport_context && snap.airport_context.distance_miles && snap.airport_context.distance_miles < 20
      ? `${snap.airport_context.airport_code} airport ${snap.airport_context.distance_miles.toFixed(1)} miles away - ${snap.airport_context.delay_minutes || 0} min delays`
      : null;
    
    // Extract news briefing intelligence (Gemini structured or legacy format)
    let localNewsStr = null;
    
    if (snap.local_news) {
      if (snap.local_news.type === 'gemini_structured' && snap.local_news.briefing) {
        // New Gemini structured briefing - format for readability
        const b = snap.local_news.briefing;
        const sections = [];
        
        if (b.airports && b.airports.length > 0) {
          sections.push(`AIRPORTS (next 60 min):\n${b.airports.map(a => `• ${a}`).join('\n')}`);
        }
        
        if (b.traffic_construction && b.traffic_construction.length > 0) {
          sections.push(`TRAFFIC & CONSTRUCTION:\n${b.traffic_construction.map(t => `• ${t}`).join('\n')}`);
        }
        
        if (b.major_events && b.major_events.length > 0) {
          sections.push(`MAJOR EVENTS:\n${b.major_events.map(e => `• ${e}`).join('\n')}`);
        }
        
        if (b.policy_safety && b.policy_safety.length > 0) {
          sections.push(`POLICY & SAFETY:\n${b.policy_safety.map(p => `• ${p}`).join('\n')}`);
        }
        
        if (b.driver_takeaway && b.driver_takeaway.length > 0) {
          sections.push(`KEY TAKEAWAYS:\n${b.driver_takeaway.map(t => `• ${t}`).join('\n')}`);
        }
        
        localNewsStr = sections.length > 0 ? sections.join('\n\n') : null;
      } else if (snap.local_news.briefing) {
        // Legacy format (GPT-5 prose)
        localNewsStr = snap.local_news.briefing;
      } else if (snap.local_news.summary) {
        // Old Perplexity format
        localNewsStr = snap.local_news.summary;
      }
    }
    
    const systemPrompt = `You are a rideshare strategy advisor and economist. Your job is to analyze the driver's COMPLETE snapshot context and provide hyper-specific, actionable strategic guidance in 3-5 sentences.

ANALYZE THE COMPLETE CONTEXT:
- Exact address and surrounding neighborhoods/districts
- Specific day of week and what typically happens on that day
- Precise time and daypart (dinner, late_evening, etc.)
- Current weather impact on rider behavior
- Air quality considerations
- Airport proximity and flight activity (if relevant)
- Local news, traffic alerts, and events affecting rideshare demand

Think deeply about what's happening RIGHT NOW at this exact location, on this specific day, at this precise time. What venues are nearby? What events? What rider patterns exist for this daypart on this day of week? Are there any traffic disruptions, local events, or news that would impact demand or routing?

DO NOT recommend specific venue addresses - provide strategic guidance about types of areas, opportunities, or timing strategies.

DO NOT repeat the driver's street address back - reference the city/area/district in general terms.

Your response must be plain text only, no JSON, no formatting. Keep it conversational, urgent, and action-oriented.

CRITICAL FORMAT: Start your strategy with "Today is [DayName], [MM/DD/YYYY] at [time]" followed by the strategic analysis.

Your strategy MUST explicitly weave these elements into the narrative:
1. Start with exact date format: "Today is Sunday, 10/05/2025 at 5:59 PM"
2. City/area context (e.g., "in Frisco's Coral Ridge area" or "in the Uptown district")
3. Daypart awareness (e.g., "during the dinner rush" or "as late evening begins")
4. Strategic action based on ALL snapshot data

Example: "Today is Sunday, 10/05/2025 at 5:59 PM in Frisco's Coral Ridge area. With 52°F weather and families wrapping up weekend activities, position near dining clusters..."`;


    // Format date as MM/DD/YYYY
    const formattedDate = snap.created_at 
      ? new Date(snap.created_at).toLocaleDateString('en-US', { 
          timeZone: snap.timezone, // No fallback - timezone required
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        })
      : 'unknown date';

    const userPrompt = `SNAPSHOT CONTEXT - Analyze this complete picture:

DRIVER LOCATION:
Exact Address: ${snap.formatted_address || 'unknown'}
City: ${snap.city || 'unknown'}, ${snap.state || 'unknown'}

EXACT TIMING:
Day of Week: ${dayOfWeek}
Date: ${formattedDate}
Time: ${exactTime}
Daypart: ${snap.day_part_key || 'unknown'}

CURRENT CONDITIONS:
Weather: ${weatherStr}
Air Quality: ${airStr}${airportStr ? `\nAirport: ${airportStr}` : ''}${localNewsStr ? `\n\nLOCAL INTELLIGENCE:\n${localNewsStr}` : ''}

START YOUR RESPONSE WITH: "Today is ${dayOfWeek}, ${formattedDate} at ${exactTime}"

Then provide a 3-5 sentence strategic overview based on this COMPLETE snapshot. Think about what's happening at this exact location, at this specific time, on this particular day of the week.`;

    // Build GPT-5 payload
    const payload = {
      model: process.env.OPENAI_MODEL || "gpt-5",
      system: systemPrompt,
      user: userPrompt,
      max_completion_tokens: 4096,
      reasoning_effort: process.env.GPT5_REASONING_EFFORT || "medium"
    };

    const gpt5Start = Date.now();
    
    // Log the complete snapshot data being sent to GPT-5
    console.log(`[TRIAD 1/3 - GPT-5] Snapshot data being sent:`, {
      address: snap.formatted_address,
      city: snap.city,
      state: snap.state,
      dayOfWeek,
      date: formattedDate,
      time: exactTime,
      daypart: snap.day_part_key,
      weather: weatherStr,
      airQuality: airStr,
      airport: airportStr || 'none',
      localNews: localNewsStr ? `${localNewsStr.substring(0, 100)}...` : 'none'
    });
    
    // Call GPT-5 with transient retry and hard budget (120s with 6 retries)
    const timeoutMs = Number(process.env.STRATEGIST_DEADLINE_MS) || 120000;
    console.log(`[TRIAD 1/3 - GPT-5] Using timeout: ${timeoutMs}ms`);
    
    const result = await callGPT5WithBudget(payload, { 
      timeoutMs, 
      maxRetries: 6 
    });
    
    const totalDuration = Date.now() - startTime;
    
    if (result.ok) {
      const strategyText = result.text.trim();
      
      await db.update(strategies)
        .set({
          status: 'ok',
          strategy: strategyText,
          latency_ms: result.ms,
          tokens: result.tokens,
          attempt: result.attempt,
          updated_at: new Date()
        })
        .where(eq(strategies.snapshot_id, snapshot_id));
      
      console.log(`[TRIAD 1/3 - GPT-5] ✅ Strategy generated successfully`);
      console.log(`[TRIAD 1/3 - GPT-5] Strategy text: "${strategyText}"`);
      console.log(`[TRIAD 1/3 - GPT-5] 💾 DB Write to 'strategies' table:`, {
        snapshot_id,
        status: 'ok',
        strategy_length: strategyText.length,
        latency_ms: result.ms,
        tokens: result.tokens,
        attempt: result.attempt
      });
      console.log(`[triad] strategist.ok id=${snapshot_id} ms=${totalDuration} gpt5_ms=${result.ms} tokens=${result.tokens} attempts=${result.attempt}`);
      
      // LEARNING CAPTURE: Index strategy for semantic search and memory (async, non-blocking)
      const [strategyRow] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshot_id)).limit(1);
      if (strategyRow?.id) {
        setImmediate(() => {
          indexStrategy(strategyRow.id, snapshot_id).catch(err => {
            console.error('[strategy] Semantic indexing failed:', err.message);
          });
          capturelearning(LEARNING_EVENTS.STRATEGY_GENERATED, {
            strategy_id: strategyRow.id,
            snapshot_id,
            latency_ms: result.ms,
            tokens: result.tokens,
            attempt: result.attempt,
            strategy_length: strategyText.length
          }, null).catch(err => {
            console.error('[strategy] Learning capture failed:', err.message);
          });
        });
      }
      
      return strategyText;
    }
    
    // Handle failure - check if transient for retry scheduling
    const isTransient = result.code === 529 || result.code === 429 || result.code === 502 || result.code === 503 || result.code === 504;
    const nextRetryAt = isTransient ? new Date(Date.now() + 5000) : null;
    
    await db.update(strategies)
      .set({
        status: 'failed',
        error_code: result.code,
        error_message: result.reason,
        latency_ms: result.ms,
        attempt: result.attempt,
        next_retry_at: nextRetryAt,
        updated_at: new Date()
      })
      .where(eq(strategies.snapshot_id, snapshot_id));
    
    console.error(`[triad] strategist.err id=${snapshot_id} reason=${result.reason} code=${result.code} ms=${totalDuration} attempts=${result.attempt}`);
    return null;
  } catch (err) {
    const duration = Date.now() - startTime;
    
    // Update DB with error
    await db.update(strategies)
      .set({
        status: 'failed',
        error_code: 500,
        error_message: err.message,
        latency_ms: duration,
        updated_at: new Date()
      })
      .where(eq(strategies.snapshot_id, snapshot_id));
    
    console.error(`[triad] strategist.err id=${snapshot_id} reason=${err.message} ms=${duration}`);
    return null;
  }
}
