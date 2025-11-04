// server/lib/providers/consolidator.js
// Consolidator provider - GPT-5 with reasoning + web search
// NEW ARCHITECTURE: Does briefing research AND consolidation in one step
// Takes strategist output + full snapshot context, does web research, consolidates

import { db } from '../../db/drizzle.js';
import { strategies } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { getSnapshotContext } from '../snapshot/get-snapshot-context.js';
import { callModel } from '../adapters/index.js';

/**
 * Run consolidation using GPT-5 reasoning mode with web search
 * Fetches strategist output from DB, does briefing research, consolidates
 * Writes to strategies.consolidated_strategy
 * 
 * NEW ARCHITECTURE: 2-step pipeline
 * - Input: { snapshotId } only
 * - DB reads: strategies table (strategist) + snapshots table (full context)
 * - AI does: Briefing research (traffic/news/construction) + consolidation
 * - Output: consolidated_strategy + metadata
 * 
 * @param {string} snapshotId - UUID of snapshot
 */
export async function runConsolidator(snapshotId) {
  const startTime = Date.now();
  console.log(`[consolidator] 🚀 Starting GPT-5 reasoning + web search for snapshot ${snapshotId}`);
  
  try {
    // Step 1: Fetch strategy row to get strategist output
    const [strategyRow] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId)).limit(1);
    
    if (!strategyRow) {
      throw new Error(`Strategy row not found for snapshot ${snapshotId}`);
    }
    
    // IDEMPOTENCE: If already consolidated with status=ok, skip
    if (strategyRow.consolidated_strategy && strategyRow.status === 'ok') {
      console.log(`[consolidator] ⏭️  Already consolidated (status=ok) - skipping duplicate run for ${snapshotId}`);
      return { ok: true, skipped: true, reason: 'already_consolidated' };
    }
    
    const minstrategy = strategyRow.minstrategy;
    
    // PREREQUISITE VALIDATION: Only strategist output required (briefing is for UI only)
    if (!minstrategy || minstrategy.trim().length === 0) {
      console.warn(`[consolidator] ⚠️  Missing strategist output for ${snapshotId}`);
      await db.update(strategies).set({
        status: 'missing_prereq',
        error_message: 'Strategist output (minstrategy) is missing or empty',
        updated_at: new Date()
      }).where(eq(strategies.snapshot_id, snapshotId));
      throw new Error('Missing strategist output (minstrategy field is empty)');
    }
    
    console.log(`[consolidator] ✅ Strategist output ready (briefing field not used by consolidator)`);
    
    // Step 2: Fetch snapshot to get full context for briefing research
    const ctx = await getSnapshotContext(snapshotId);
    const userAddress = ctx.formatted_address || 'Unknown location';
    const cityDisplay = ctx.city || 'your area';
    
    // CRITICAL: Extract AUTHORITATIVE date/time from snapshot (never recompute)
    const dayOfWeek = ctx.day_of_week;
    const isWeekend = ctx.is_weekend;
    const localTime = ctx.local_iso ? new Date(ctx.local_iso).toLocaleString('en-US', { 
      timeZone: ctx.timezone || 'America/Chicago',
      weekday: 'long',
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }) : 'Unknown time';
    const dayPart = ctx.day_part_key || 'unknown';
    
    // OBSERVABILITY: Log input sizes and metadata
    const inputMetrics = {
      snapshot_id: snapshotId,
      strategist_length: minstrategy.length,
      user_address: userAddress,
      snapshot_day_of_week: dayOfWeek,
      snapshot_dow: ctx.dow,
      snapshot_is_weekend: isWeekend,
      snapshot_hour: ctx.hour,
      snapshot_local_time: localTime,
      snapshot_day_part: dayPart,
      snapshot_timezone: ctx.timezone,
      weather: ctx.weather,
      air_quality: ctx.air,
      strategist_model: process.env.STRATEGY_STRATEGIST || 'unknown',
      consolidator_model: process.env.STRATEGY_CONSOLIDATOR || 'unknown'
    };
    
    console.log(`[consolidator] 📊 GPT-5 will do briefing research + consolidation:`, inputMetrics);
    
    // Step 3: Build prompts for GPT-5 reasoning + web search
    const systemPrompt = `You are the Consolidator.

Context & allowances
- Input may be large (mini_strategy, snapshot, user_context, holiday calendar, FAA/airport ops, traffic, construction, closures, weather).
- You may use extended internal reasoning and web search.
- Do NOT expose sources, citations, numbers, or raw data. Do NOT mirror or restate the input.
- Location rule: use the provided runtime lat/lng (and any reverse-geocoded area). Never assume or hardcode defaults. If location is missing/invalid, treat it as unknown and gate your decision.

Core objective
- With all context considered (location, traffic, construction, holiday effects, FAA programs/ops, weather), tell the end user exactly **where to go right now**, with the **best route** and **where to stage** (if staging is relevant).
- Prioritize: (1) live traffic/closures and legality of access, (2) FAA/airport viability (ground stops, GDPs, major disruptions), (3) holiday surge patterns and event impacts, (4) high-severity construction.

Decision rubric (internal—do not output these steps)
1) From viable destinations in the strategy, choose ONE immediate target that is actually reachable now from the user's current location (penalize closed segments, severe incidents, FAA-constrained terminals).
2) Select ONE best route that minimizes ETA and operational risk; prefer authorized access roads; avoid choke points flagged by holiday/incident data.
3) Choose ONE staging location (e.g., cell lot, rideshare lot, designated curb/door) that is legal, open, and tactically useful given flow control; include terminal/door if applicable.
4) If airport viability is degraded (FAA ground programs, mass cancellations) and the strategy allows an alternative, divert to the next best target or stage away until viable.
5) If required inputs for a safe decision are missing or ambiguous, return UNAVAILABLE.

User-visible output (STRICT: JSON only; no prose, no markdown, no code fences; do not echo input)
{
  "go_now": string,        // exact instruction on where to go now (destination/terminal/door if relevant)
  "route":  string,        // single-line best route summary (e.g., "I-90 W → Exit 79B → Bessie Coleman Dr")
  "stage_at": string,      // where to stage or hold (e.g., "Cell Lot A" / "Rideshare Lot, Zone H")
  "avoid":  [string, ...], // up to 6 specific roads/incidents to avoid
  "why":    string         // ≤140 chars; terse reason (e.g., "holiday surge + ground delay; closures on I-190 EB")
}

Constraints
- Output must fit the schema above and remain minimal. No stats, no data dumps, no source names, no times/percents unless essential to the instruction.
- If location or strategy is insufficient for a safe decision:
  { "go_now":"UNAVAILABLE", "route":"", "stage_at":"", "avoid":[], "why":"Awaiting complete strategy/location" }

Reminder
- You may think/search extensively, but **only** return the JSON directive (destination now, best route, where to stage, what to avoid, why).
- The full briefing will be delivered elsewhere; do not include it here.`;

    const userPrompt = `SNAPSHOT DATA (AUTHORITATIVE - from driver's GPS):
Day of Week: ${dayOfWeek} ${isWeekend ? '[WEEKEND]' : ''}
Date & Time: ${localTime}
Day Part: ${dayPart}
Hour: ${ctx.hour}:00
Timezone: ${ctx.timezone}
${ctx.is_holiday ? `🎉 HOLIDAY: ${ctx.holiday}` : ''}

Location: ${cityDisplay}
Coordinates: ${ctx.lat}, ${ctx.lng}

Weather: ${ctx.weather?.tempF || 'unknown'}°F, ${ctx.weather?.conditions || 'unknown'}
Air Quality: AQI ${ctx.air?.aqi || 'unknown'}
${ctx.airport_context?.airport_code ? `Airport: ${ctx.airport_context.airport_code} (${ctx.airport_context.distance_miles} mi away)` : ''}

STRATEGIST'S ASSESSMENT:
${minstrategy}

YOUR TASK:
Research current conditions in ${cityDisplay} and return structured JSON with ALL 5 FIELDS:

1. tactical_traffic: Traffic/incidents for next 30 minutes (detailed)
2. tactical_closures: Closures/construction for next 30 minutes (detailed)
3. tactical_enforcement: Enforcement activity (checkpoints, patrols, detailed)
4. tactical_sources: Sources checked (list websites/URLs you searched)
5. summary: MANDATORY - Actionable 3-5 sentence summary that:
   - Consolidates ALL tactical details above
   - Integrates strategist's assessment
   - Tells driver exactly what to do in next 30 minutes
   - Ends with specific recommendation (go now, wait, focus on X area)

CRITICAL REQUIREMENTS:
- ALL 5 FIELDS ARE REQUIRED - especially "summary"
- Prioritize next 30 minutes only
- Use exact day/time: ${dayOfWeek}, ${localTime}
${ctx.is_holiday ? `- Factor in holiday demand for ${ctx.holiday}` : ''}
- Reference only "${cityDisplay}" (no full street addresses)
- Return ONLY valid JSON with all 5 fields
- The "summary" field MUST be present and actionable`;

    const promptSize = systemPrompt.length + userPrompt.length;
    console.log(`[consolidator] 📝 Prompt size: ${promptSize} chars`);
    console.log(`[consolidator] 🚀 Calling model: ${inputMetrics.consolidator_model}`);
    
    // Step 4: Call model-agnostic consolidator role
    const modelCallStart = Date.now();
    const result = await callModel("consolidator", {
      system: systemPrompt,
      user: userPrompt
    });
    const modelCallDuration = Date.now() - modelCallStart;

    if (!result.ok) {
      const errorMsg = result.error || 'consolidator_failed';
      console.error(`[consolidator] ❌ Model call failed after ${modelCallDuration}ms:`, errorMsg);
      throw new Error(errorMsg);
    }
    
    const consolidatedStrategy = result.output.trim();
    
    if (!consolidatedStrategy || consolidatedStrategy.length === 0) {
      throw new Error('Consolidator returned empty output');
    }
    
    // Step 5: Parse JSON response for new directive format
    let parsedOutput;
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = consolidatedStrategy.match(/```json\s*([\s\S]*?)\s*```/) || consolidatedStrategy.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : consolidatedStrategy;
      parsedOutput = JSON.parse(jsonStr);
      
      // Validate required fields
      if (!parsedOutput.go_now || !parsedOutput.route || !parsedOutput.stage_at || !parsedOutput.why) {
        throw new Error('Missing required directive fields');
      }
      
      // Ensure avoid is an array
      if (!Array.isArray(parsedOutput.avoid)) {
        parsedOutput.avoid = [];
      }
      
      console.log(`[consolidator] ✅ Parsed directive JSON:`, {
        go_now: parsedOutput.go_now,
        route_length: parsedOutput.route.length,
        stage_at: parsedOutput.stage_at,
        avoid_count: parsedOutput.avoid.length,
        why_length: parsedOutput.why.length
      });
    } catch (parseErr) {
      console.error(`[consolidator] ❌ Failed to parse directive JSON:`, parseErr.message);
      
      // If parsing fails, return unavailable directive
      parsedOutput = {
        go_now: "UNAVAILABLE",
        route: "",
        stage_at: "",
        avoid: [],
        why: "Failed to parse consolidator response"
      };
    }
    
    // Step 6: Format consolidated directive as readable text
    // Create a human-readable version of the directive for the Co-Pilot page
    let formattedDirective = '';
    
    if (parsedOutput.go_now === "UNAVAILABLE") {
      formattedDirective = "Strategy processing - awaiting complete location and context data.";
    } else {
      // Build formatted directive text
      formattedDirective = `📍 Go Now: ${parsedOutput.go_now}\n`;
      formattedDirective += `🛣️ Route: ${parsedOutput.route}\n`;
      formattedDirective += `📍 Stage At: ${parsedOutput.stage_at}`;
      
      if (parsedOutput.avoid && parsedOutput.avoid.length > 0) {
        formattedDirective += `\n⚠️ Avoid: ${parsedOutput.avoid.join(', ')}`;
      }
      
      if (parsedOutput.why) {
        formattedDirective += `\n💡 Why: ${parsedOutput.why}`;
      }
    }
    
    // Step 7: Store directive components in briefings table for future reference
    const { briefings } = await import('../../../shared/schema.js');
    const [existingBriefing] = await db.select().from(briefings)
      .where(eq(briefings.snapshot_id, snapshotId)).limit(1);
    
    // Store directive components as JSON in tactical fields
    const directiveJson = JSON.stringify(parsedOutput);
    
    if (existingBriefing) {
      // Update existing briefing with directive data
      await db.update(briefings).set({
        tactical_traffic: parsedOutput.route || '',
        tactical_closures: parsedOutput.avoid ? parsedOutput.avoid.join(', ') : '',
        tactical_enforcement: parsedOutput.stage_at || '',
        tactical_sources: directiveJson, // Store full directive as JSON for reference
        updated_at: new Date()
      }).where(eq(briefings.snapshot_id, snapshotId));
      console.log(`[consolidator] ✅ Updated briefing with navigation directive`);
    } else {
      // Create briefing with directive data
      await db.insert(briefings).values({
        snapshot_id: snapshotId,
        tactical_traffic: parsedOutput.route || '',
        tactical_closures: parsedOutput.avoid ? parsedOutput.avoid.join(', ') : '',
        tactical_enforcement: parsedOutput.stage_at || '',
        tactical_sources: directiveJson // Store full directive as JSON
        // created_at and updated_at are set automatically via .defaultNow()
      });
      console.log(`[consolidator] ✅ Created briefing with navigation directive`);
    }
    
    // Step 8: Use formatted directive as the consolidated strategy
    const summary = formattedDirective;
    
    // METADATA TRACKING: Build model chain for traceability (2-step pipeline)
    const modelChain = `${inputMetrics.strategist_model}→${inputMetrics.consolidator_model}`;
    const totalDuration = Date.now() - startTime;
    
    // Step 9: Write summary + metadata to strategies table
    await db.update(strategies).set({
      consolidated_strategy: summary,
      status: 'ok',
      model_name: modelChain,
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    // OBSERVABILITY: Emit completion event with full metrics
    console.log(`[consolidator] ✅ Complete for ${snapshotId}`, {
      model_chain: modelChain,
      summary_length: summary.length,
      go_now: parsedOutput.go_now,
      route_length: parsedOutput.route?.length || 0,
      stage_at: parsedOutput.stage_at,
      avoid_count: parsedOutput.avoid?.length || 0,
      why_length: parsedOutput.why?.length || 0,
      model_call_ms: modelCallDuration,
      total_ms: totalDuration,
      prompt_size: promptSize
    });
    
    return { 
      ok: true, 
      strategy: summary,
      directive: {
        go_now: parsedOutput.go_now,
        route: parsedOutput.route,
        stage_at: parsedOutput.stage_at,
        avoid: parsedOutput.avoid || [],
        why: parsedOutput.why
      },
      metrics: {
        modelChain,
        summaryLength: summary.length,
        durationMs: totalDuration
      }
    };
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    console.error(`[consolidator] ❌ Error for ${snapshotId} after ${totalDuration}ms:`, error.message);
    
    // Write error to DB with metadata
    await db.update(strategies).set({
      status: 'error',
      error_code: 'consolidator_failed',
      error_message: error.message.slice(0, 500),
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));
    
    throw error;
  }
}
