// server/lib/strategy-generator.js
// Three-stage AI pipeline: Claude Opus 4.1 → Gemini Briefing → GPT-5 Consolidation
import { db } from '../db/drizzle.js';
import { snapshots, strategies, users } from '../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { callGPT5WithBudget } from './model-retry.js';
import { callClaude } from './adapters/anthropic-claude.js';
import { capturelearning, LEARNING_EVENTS } from '../middleware/learning-capture.js';
import { indexStrategy } from './semantic-search.js';
import { generateMultiStrategy } from './strategy-generator-parallel.js';

// Feature flag for parallel multi-model strategy
const MULTI_STRATEGY_ENABLED = process.env.MULTI_STRATEGY_ENABLED === 'true';

export async function generateStrategyForSnapshot(snapshot_id) {
  // Route to parallel orchestration if enabled
  if (MULTI_STRATEGY_ENABLED) {
    console.log(`[strategy] Routing to parallel multi-model orchestration (feature enabled)`);
    // CRITICAL FIX: Fetch snapshot first, then get user location data
    const [snap] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshot_id));
    
    if (!snap) {
      console.warn(`[strategy] Snapshot not found: ${snapshot_id}`);
      return null;
    }
    
    // Fetch user location data (city, state, formatted_address from users table)
    let userLocation = { city: null, state: null, formatted_address: null };
    if (snap.user_id) {
      const [userData] = await db.select().from(users).where(eq(users.user_id, snap.user_id));
      if (userData) {
        userLocation = {
          city: userData.city,
          state: userData.state,
          formatted_address: userData.formatted_address
        };
      }
    }
    
    const strategyResult = await generateMultiStrategy({
      snapshotId: snapshot_id,
      userId: snap.user_id || null,
      userAddress: userLocation.formatted_address,
      city: userLocation.city,
      state: userLocation.state,
      snapshot: snap
    });
    
    if (strategyResult.ok) {
      console.log(`[strategy] ✅ Parallel strategy complete: ${strategyResult.strategyId}`);
      console.log(`[strategy] Audits: ${JSON.stringify(strategyResult.audits)}`);
      return strategyResult.strategy;
    } else {
      console.error(`[strategy] ❌ Parallel strategy failed: ${strategyResult.reason}`);
      return null;
    }
  }
  
  // Otherwise, fall through to sequential path
  console.log(`[strategy] Using sequential strategy path (parallel disabled)`);
  
  const startTime = Date.now();
  
  try {
    console.log(`[triad] strategist.start id=${snapshot_id}`);
    
    const [snap] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshot_id));
    
    if (!snap) {
      console.warn(`[triad] strategist.err id=${snapshot_id} reason=snapshot_not_found ms=${Date.now() - startTime}`);
      return null;
    }
    
    // CRITICAL FIX: Location data is in users table, not snapshots. Fetch it.
    let userLocation = { city: null, state: null, formatted_address: null, timezone: 'America/Chicago' };
    if (snap.user_id) {
      const [userData] = await db.select().from(users).where(eq(users.user_id, snap.user_id));
      if (userData) {
        userLocation = {
          city: userData.city,
          state: userData.state,
          formatted_address: userData.formatted_address,
          timezone: userData.timezone || 'America/Chicago'
        };
      }
    }
    
    if (!userLocation.city && !userLocation.formatted_address) {
      console.log(`[triad] strategist.skip id=${snapshot_id} reason=no_location_data ms=${Date.now() - startTime}`);
      return null;
    }
    
    // DEPRECATED: Old sequential strategy path - use strategy-generator-parallel.js instead
    // Check if strategy row already exists; if so, skip to avoid race conditions
    const [existingStrategy] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshot_id)).limit(1);
    
    if (existingStrategy) {
      console.log(`[triad] strategist.skip id=${snapshot_id} reason=strategy_already_exists ms=${Date.now() - startTime}`);
      return null;
    }
    
    // REMOVED: Placeholder creation moved to strategy-generator-parallel.js
    // This prevents race conditions and ensures model_name attribution is preserved
    
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = snap.dow !== null && snap.dow !== undefined ? dayNames[snap.dow] : 'unknown day';
    
    // Format exact time from timestamp (timezone from users table)
    const exactTime = snap.created_at ? new Date(snap.created_at).toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      timeZone: userLocation.timezone
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
    
    // Extract Gemini news briefing from news_briefing field
    let geminiBriefingStr = null;
    if (snap.news_briefing && typeof snap.news_briefing === 'object') {
      const b = snap.news_briefing;
      const sections = [];
      
      if (b.global_conditions && b.global_conditions.length > 0) {
        sections.push(`GLOBAL CONDITIONS:\n${b.global_conditions.map(g => `• ${g}`).join('\n')}`);
      }
      
      if (b.local_events && b.local_events.length > 0) {
        sections.push(`LOCAL EVENTS:\n${b.local_events.map(e => `• ${e}`).join('\n')}`);
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
      
      geminiBriefingStr = sections.length > 0 ? sections.join('\n\n') : null;
    }
    
    // Format date as MM/DD/YYYY
    const formattedDate = snap.created_at 
      ? new Date(snap.created_at).toLocaleDateString('en-US', { 
          timeZone: userLocation.timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        })
      : 'unknown date';

    // ==========================================
    // STAGE 1: Claude Opus 4.1 - Initial Strategy
    // ==========================================
    console.log(`[TRIAD 1/3 - Claude Opus] Starting strategy generation for snapshot ${snapshot_id}`);
    
    const claudeSystemPrompt = `You are an expert rideshare strategy advisor. Analyze the driver's complete location snapshot and provide strategic guidance in 3-5 sentences.

Start with: "Today is [DayName], [MM/DD/YYYY] at [time]"

Then analyze:
- Exact location context (city/area/district)
- Current time, day of week, and daypart
- Weather and air quality impact on rider behavior
- Airport proximity if relevant
- Strategic positioning recommendations

Keep it conversational, urgent, and action-oriented. Reference areas generally, not specific addresses.`;

    const claudeUserPrompt = `DRIVER SNAPSHOT:

Location: ${userLocation.formatted_address || 'unknown'}
City: ${userLocation.city || 'unknown'}, ${userLocation.state || 'unknown'}

Timing:
- Day: ${dayOfWeek}
- Date: ${formattedDate}
- Time: ${exactTime}
- Daypart: ${snap.day_part_key || 'unknown'}

Conditions:
- Weather: ${weatherStr}
- Air: ${airStr}${airportStr ? `\n- Airport: ${airportStr}` : ''}

Provide strategic guidance starting with "Today is ${dayOfWeek}, ${formattedDate} at ${exactTime}"`;

    const claudeStart = Date.now();
    let claudeStrategy = null;
    
    try {
      claudeStrategy = await callClaude({
        model: process.env.CLAUDE_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929",
        system: claudeSystemPrompt,
        user: claudeUserPrompt,
        temperature: 0.7,
        maxTokens: 300
      });

      console.log(`[TRIAD 1/3] Claude result: ${claudeStrategy ? 'OK' : 'FAILED'} (${Date.now() - claudeStart}ms)`);
    } catch (e) {
      console.error(`[TRIAD 1/3] Claude failed:`, e.message);
      claudeStrategy = `Unable to generate strategy due to: ${e.message}`;
    }

    return {
      strategy: claudeStrategy,
      briefing: geminiBriefingStr,
      userCity: userLocation.city,
      userState: userLocation.state,
      userAddress: userLocation.formatted_address
    };
  } catch (err) {
    console.error(`[triad] strategist error:`, err.message);
    return null;
  }
}
