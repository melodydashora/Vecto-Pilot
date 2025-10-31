// server/lib/strategy-generator.js
// Three-stage AI pipeline: Claude Opus 4.1 → Gemini Briefing → GPT-5 Consolidation
import { db } from '../db/drizzle.js';
import { snapshots, strategies } from '../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { callGPT5WithBudget } from './gpt5-retry.js';
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
    const [snap] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshot_id));
    
    if (!snap) {
      console.warn(`[strategy] Snapshot not found: ${snapshot_id}`);
      return null;
    }
    
    const result = await generateMultiStrategy({
      snapshotId: snapshot_id,
      userId: snap.user_id || null,
      userAddress: snap.formatted_address,
      city: snap.city,
      state: snap.state,
      snapshot: snap
    });
    
    if (result.ok) {
      console.log(`[strategy] ✅ Parallel strategy complete: ${result.strategyId}`);
      console.log(`[strategy] Audits: ${JSON.stringify(result.audits)}`);
      return result.strategy;
    } else {
      console.error(`[strategy] ❌ Parallel strategy failed: ${result.reason}`);
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
    
    if (!snap.city && !snap.formatted_address) {
      console.log(`[triad] strategist.skip id=${snapshot_id} reason=no_location_data ms=${Date.now() - startTime}`);
      return null;
    }
    
    // Create or update strategy record with pending status
    // RUNTIME-FRESH SPEC: Set time windowing fields
    const now = new Date();
    const windowStart = now;
    const windowEnd = new Date(now.getTime() + 60 * 60 * 1000); // +60 minutes (max window)
    
    await db.insert(strategies).values({
      snapshot_id,
      status: 'pending',
      attempt: 1,
      strategy_timestamp: now,
      valid_window_start: windowStart,
      valid_window_end: windowEnd,
      lat: snap.lat,
      lng: snap.lng,
      city: snap.city,
    }).onConflictDoUpdate({
      target: strategies.snapshot_id,
      set: {
        status: 'pending',
        error_code: null,
        error_message: null,
        updated_at: now,
        strategy_timestamp: now,
        valid_window_start: windowStart,
        valid_window_end: windowEnd,
        lat: snap.lat,
        lng: snap.lng,
        city: snap.city,
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
    
    // Extract Gemini news briefing from news_briefing field
    let geminiBriefingStr = null;
    
    if (snap.news_briefing && snap.news_briefing.briefing) {
      const b = snap.news_briefing.briefing;
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
      
      geminiBriefingStr = sections.length > 0 ? sections.join('\n\n') : null;
    }
    
    // Format date as MM/DD/YYYY
    const formattedDate = snap.created_at 
      ? new Date(snap.created_at).toLocaleDateString('en-US', { 
          timeZone: snap.timezone,
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

Location: ${snap.formatted_address || 'unknown'}
City: ${snap.city || 'unknown'}, ${snap.state || 'unknown'}

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
        model: "claude-opus-4-1-20250805",
        system: claudeSystemPrompt,
        user: claudeUserPrompt,
        max_tokens: 1000,
        temperature: 0.7
      });
      console.log(`[TRIAD 1/3 - Claude] ✅ Strategy generated in ${Date.now() - claudeStart}ms`);
      console.log(`[TRIAD 1/3 - Claude] Strategy: "${claudeStrategy.substring(0, 150)}..."`);
    } catch (err) {
      console.error(`[TRIAD 1/3 - Claude] ❌ Failed:`, err.message);
      
      // Handle Anthropic 529 Overloaded error gracefully
      if (err.status === 529 || err.message?.includes('529') || err.message?.includes('overloaded')) {
        console.warn(`[TRIAD 1/3 - Claude] ⚠️ Provider overloaded (529), marking strategy as retryable`);
        await db.update(strategies)
          .set({
            status: 'failed',
            error_code: 'provider_overloaded',
            error_message: 'Anthropic API is experiencing high load (529)',
            updated_at: new Date()
          })
          .where(eq(strategies.snapshot_id, snapshot_id));
        
        const overloadError = new Error('Anthropic API overloaded (529) - Please retry in a few seconds');
        overloadError.code = 'PROVIDER_OVERLOADED';
        overloadError.retryable = true;
        throw overloadError;
      }
      
      // For other errors, throw as-is
      throw err;
    }

    // ==========================================
    // STAGE 2: Extract Gemini News Briefing
    // ==========================================
    console.log(`[TRIAD 2/3 - Gemini] Extracting news briefing from snapshot`);
    const geminiNewsAvailable = geminiBriefingStr ? true : false;
    console.log(`[TRIAD 2/3 - Gemini] News briefing ${geminiNewsAvailable ? 'found' : 'not available'}`);
    if (geminiNewsAvailable) {
      console.log(`[TRIAD 2/3 - Gemini] Preview: "${geminiBriefingStr.substring(0, 150)}..."`);
    }

    // ==========================================
    // STAGE 3: GPT-5 - Consolidate Both
    // ==========================================
    console.log(`[TRIAD 3/3 - GPT-5] Consolidating Claude strategy + Gemini briefing`);
    
    const gpt5SystemPrompt = `You are a rideshare strategy consolidator. You will receive:
1. An initial strategy from Claude
2. Optional local news briefing from Gemini

Combine these into a single, cohesive 3-5 sentence strategy that:
- Maintains the opening "Today is [DayName], [MM/DD/YYYY] at [time]" format
- Weaves in news intelligence naturally (if provided)
- Keeps the conversational, urgent, action-oriented tone
- Focuses on strategic positioning and timing recommendations`;

    const gpt5UserPrompt = `CLAUDE STRATEGY:
${claudeStrategy}

${geminiNewsAvailable ? `GEMINI NEWS BRIEFING:\n${geminiBriefingStr}` : 'No news briefing available.'}

Consolidate these into a single strategy that naturally integrates the news intelligence (if any) into Claude's strategic analysis. Keep the same opening format and tone.`;

    const gpt5Payload = {
      model: process.env.OPENAI_MODEL || "gpt-5",
      system: gpt5SystemPrompt,
      user: gpt5UserPrompt,
      max_completion_tokens: 2000,
      reasoning_effort: process.env.GPT5_REASONING_EFFORT || "medium"
    };

    const gpt5Start = Date.now();
    const timeoutMs = Number(process.env.STRATEGIST_DEADLINE_MS) || 120000;
    
    const result = await callGPT5WithBudget(gpt5Payload, { 
      timeoutMs, 
      maxRetries: 6 
    });
    
    const totalDuration = Date.now() - startTime;
    console.log(`[TRIAD 3/3 - GPT-5] ✅ Final strategy consolidated in ${Date.now() - gpt5Start}ms`);
    
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
      
      console.log(`[TRIAD] ✅ Three-stage pipeline complete (Claude → Gemini → GPT-5)`);
      console.log(`[TRIAD] Final strategy: "${strategyText}"`);
      console.log(`[TRIAD] 💾 DB Write to 'strategies' table:`, {
        snapshot_id,
        status: 'ok',
        strategy_length: strategyText.length,
        total_ms: totalDuration,
        claude_ms: Date.now() - claudeStart,
        gpt5_ms: result.ms,
        gemini_news: geminiNewsAvailable,
        tokens: result.tokens,
        attempt: result.attempt
      });
      console.log(`[triad] pipeline.ok id=${snapshot_id} total_ms=${totalDuration} claude+gemini+gpt5 gemini_news=${geminiNewsAvailable} tokens=${result.tokens}`);
      
      // EVENT ENRICHMENT: Refresh venue_events for all candidates (runtime-fresh spec)
      try {
        console.log(`[TRIAD] 🎉 Refreshing event enrichment for snapshot ${snapshot_id}`);
        await db.execute(sql`select fn_refresh_venue_enrichment(${snapshot_id}::uuid);`);
        console.log(`[TRIAD] ✅ Event enrichment complete`);
      } catch (enrichErr) {
        console.warn(`[TRIAD] ⚠️  Event enrichment failed (non-blocking):`, enrichErr.message);
        // Non-blocking - continue even if enrichment fails
      }
      
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
