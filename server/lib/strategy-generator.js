// server/lib/strategy-generator.js
// Auto-generates strategic overview using Claude when snapshot is saved
import { db } from '../db/drizzle.js';
import { snapshots, strategies } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { callClaude } from './adapters/anthropic-claude.js';

export async function generateStrategyForSnapshot(snapshot_id) {
  try {
    console.log(`[Strategy Generator] Starting strategy generation for snapshot ${snapshot_id}`);
    
    const [snap] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshot_id));
    
    if (!snap) {
      console.warn(`[Strategy Generator] Snapshot ${snapshot_id} not found`);
      return null;
    }
    
    if (!snap.city && !snap.formatted_address) {
      console.log(`[Strategy Generator] Skipping - no location data for snapshot ${snapshot_id}`);
      return null;
    }
    
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = snap.dow !== null && snap.dow !== undefined ? dayNames[snap.dow] : 'unknown day';
    
    // Format exact time from timestamp
    const exactTime = snap.created_at ? new Date(snap.created_at).toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      timeZone: snap.timezone || 'America/Chicago'
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
    
    const systemPrompt = `You are a rideshare strategy advisor and economist. Your job is to analyze the driver's COMPLETE snapshot context and provide hyper-specific, actionable strategic guidance in 3-5 sentences.

ANALYZE THE COMPLETE CONTEXT:
- Exact address and surrounding neighborhoods/districts
- Specific day of week and what typically happens on that day
- Precise time and daypart (dinner, late_evening, etc.)
- Current weather impact on rider behavior
- Air quality considerations
- Airport proximity and flight activity (if relevant)

Think deeply about what's happening RIGHT NOW at this exact location, on this specific day, at this precise time. What venues are nearby? What events? What rider patterns exist for this daypart on this day of week?

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
          timeZone: snap.timezone || 'America/Chicago',
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
Air Quality: ${airStr}${airportStr ? `\nAirport: ${airportStr}` : ''}

START YOUR RESPONSE WITH: "Today is ${dayOfWeek}, ${formattedDate} at ${exactTime}"

Then provide a 3-5 sentence strategic overview based on this COMPLETE snapshot. Think about what's happening at this exact location, at this specific time, on this particular day of the week.`;

    console.log(`[Strategy Generator] Calling Claude Opus 4.1 with HEAVY THINKING for snapshot ${snapshot_id}...`);
    const startTime = Date.now();
    
    const strategyText = await callClaude({
      system: systemPrompt,
      user: userPrompt,
      max_tokens: 12000,  // Must be > thinking budget (10K)
      thinking: "high",  // Enable heavy extended thinking (10K token budget)
      // Note: temperature will be forced to 1.0 by adapter when thinking is enabled
    });
    
    const duration = Date.now() - startTime;
    console.log(`✅ [Strategy Generator] Strategy generated in ${duration}ms with extended thinking`);
    
    if (!strategyText || strategyText.trim().length === 0) {
      console.warn(`[Strategy Generator] Claude returned empty strategy for snapshot ${snapshot_id}`);
      return null;
    }
    
    await db.insert(strategies).values({
      snapshot_id,
      strategy: strategyText.trim()
    });
    
    console.log(`✅ [Strategy Generator] Claude strategy saved to strategies table for ${snapshot_id}: ${strategyText.slice(0, 60)}...`);
    
    return strategyText;
  } catch (err) {
    console.error(`[Strategy Generator] Error generating strategy for snapshot ${snapshot_id}:`, err.message);
    return null;
  }
}
