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
      air_quality: ctx.air
    };
    
    console.log(`[consolidator] 📊 GPT-5 will do briefing research + consolidation:`, inputMetrics);
    
    // Step 3: Build prompts for GPT-5 reasoning + web search
    const systemPrompt = `You are an expert rideshare intelligence analyst with live web search capabilities.

Your task:
1. Use live web search to research current conditions for rideshare drivers
2. Split your research into tactical details AND actionable summary
3. Return structured JSON with ALL 5 fields (summary is REQUIRED)

Format your response as JSON with these fields IN THIS EXACT ORDER:
{
  "tactical_traffic": "Traffic/incidents for next 30 minutes (detailed)",
  "tactical_closures": "Closures/construction for next 30 minutes (detailed)", 
  "tactical_enforcement": "Enforcement activity for next 30 minutes (detailed)",
  "tactical_sources": "Sources checked (website names/URLs)",
  "summary": "REQUIRED - Actionable 3-5 sentence summary consolidating ALL above details for driver leaving NOW"
}

CRITICAL REQUIREMENTS:
- Focus strictly on: traffic conditions, incidents, closures, enforcement, construction
- Do NOT list venues or curb locations
- The "summary" field is MANDATORY - it consolidates tactical details into actionable guidance
- Use the exact day of week and time provided - do not recompute dates
- Return ONLY valid JSON with all 5 fields`;

    const userPrompt = `SNAPSHOT DATA (AUTHORITATIVE - from driver's GPS):
Day of Week: ${dayOfWeek} ${isWeekend ? '[WEEKEND]' : ''}
Date & Time: ${localTime}
Day Part: ${dayPart}
Hour: ${ctx.hour}:00
Timezone: ${ctx.timezone}
${ctx.is_holiday ? `🎉 HOLIDAY: ${ctx.holiday}` : ''}

PRECISE DRIVER LOCATION: ${userAddress}
Coordinates: ${ctx.lat}, ${ctx.lng}

Weather: ${ctx.weather?.tempF || 'unknown'}°F, ${ctx.weather?.conditions || 'unknown'}
Air Quality: AQI ${ctx.air?.aqi || 'unknown'}
${ctx.airport_context?.airport_code ? `Airport: ${ctx.airport_context.airport_code} (${ctx.airport_context.distance_miles} mi away)` : ''}

STRATEGIST'S ASSESSMENT:
${minstrategy}

YOUR TASK:
Research current conditions near ${userAddress} and return structured JSON with ALL 5 FIELDS:

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
- Use the PRECISE DRIVER LOCATION above for local context
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
    
    // Step 5: Parse JSON response or extract from plain text
    let parsedOutput;
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = consolidatedStrategy.match(/```json\s*([\s\S]*?)\s*```/) || consolidatedStrategy.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : consolidatedStrategy;
      parsedOutput = JSON.parse(jsonStr);
      console.log(`[consolidator] ✅ Parsed JSON response`);
    } catch (parseErr) {
      console.warn(`[consolidator] ⚠️  Failed to parse JSON, attempting plain text extraction:`, parseErr.message);
      
      // Fallback: Parse plain text format
      // Expected format:
      // - Traffic/incidents: ...
      // - Closures/construction: ...
      // - Enforcement: ...
      // Sources checked: ...
      // Summary/How to operationalize: ...
      
      const trafficMatch = consolidatedStrategy.match(/[-•]\s*Traffic[/\s]incidents?:\s*([^\n]+(?:\n(?![-•]\s*[A-Z])[^\n]+)*)/i);
      const closuresMatch = consolidatedStrategy.match(/[-•]\s*Closures[/\s]construction:\s*([^\n]+(?:\n(?![-•]\s*[A-Z])[^\n]+)*)/i);
      const enforcementMatch = consolidatedStrategy.match(/[-•]\s*Enforcement:\s*([^\n]+(?:\n(?![-•]\s*[A-Z])[^\n]+)*)/i);
      const sourcesMatch = consolidatedStrategy.match(/Sources checked:\s*([^\n]+(?:\n(?![A-Z])[^\n]+)*)/i);
      
      // Extract summary (everything after sources or "How to operationalize")
      const summaryMatch = consolidatedStrategy.match(/(?:Summary|How to operationalize)[^:]*:\s*([\s\S]+)/i);
      
      parsedOutput = {
        tactical_traffic: trafficMatch ? trafficMatch[1].trim() : '',
        tactical_closures: closuresMatch ? closuresMatch[1].trim() : '',
        tactical_enforcement: enforcementMatch ? enforcementMatch[1].trim() : '',
        tactical_sources: sourcesMatch ? sourcesMatch[1].trim() : '',
        summary: summaryMatch ? summaryMatch[1].trim() : consolidatedStrategy
      };
      
      console.log(`[consolidator] 📝 Extracted from plain text:`, {
        traffic_chars: parsedOutput.tactical_traffic.length,
        closures_chars: parsedOutput.tactical_closures.length,
        enforcement_chars: parsedOutput.tactical_enforcement.length,
        sources_chars: parsedOutput.tactical_sources.length,
        summary_chars: parsedOutput.summary.length
      });
    }
    
    // Step 6: Write tactical sections to briefings table
    const { briefings } = await import('../../../shared/schema.js');
    const [existingBriefing] = await db.select().from(briefings)
      .where(eq(briefings.snapshot_id, snapshotId)).limit(1);
    
    if (existingBriefing) {
      // Update existing briefing with tactical sections
      await db.update(briefings).set({
        tactical_traffic: parsedOutput.tactical_traffic || '',
        tactical_closures: parsedOutput.tactical_closures || '',
        tactical_enforcement: parsedOutput.tactical_enforcement || '',
        tactical_sources: parsedOutput.tactical_sources || '',
        updated_at: new Date()
      }).where(eq(briefings.snapshot_id, snapshotId));
      console.log(`[consolidator] ✅ Updated briefing with tactical intelligence`);
    } else {
      // Create briefing with tactical sections only
      await db.insert(briefings).values({
        snapshot_id: snapshotId,
        tactical_traffic: parsedOutput.tactical_traffic || '',
        tactical_closures: parsedOutput.tactical_closures || '',
        tactical_enforcement: parsedOutput.tactical_enforcement || '',
        tactical_sources: parsedOutput.tactical_sources || ''
        // created_at and updated_at are set automatically via .defaultNow()
      });
      console.log(`[consolidator] ✅ Created briefing with tactical intelligence`);
    }
    
    // Step 7: Write only summary to consolidated_strategy (Co-Pilot page)
    const summary = parsedOutput.summary || consolidatedStrategy;
    
    // METADATA TRACKING: model_name already set during strategy row creation
    // DO NOT overwrite - it contains the full 3-step chain (strategist→briefer→consolidator)
    const totalDuration = Date.now() - startTime;
    
    // Step 8: Write summary + status to strategies table (preserve model_name)
    await db.update(strategies).set({
      consolidated_strategy: summary,
      status: 'ok',
      // REMOVED: model_name - already set during INSERT, must preserve full chain
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    // OBSERVABILITY: Emit completion event with full metrics
    console.log(`[consolidator] ✅ Complete for ${snapshotId}`, {
      summary_length: summary.length,
      tactical_traffic_length: parsedOutput.tactical_traffic?.length || 0,
      tactical_closures_length: parsedOutput.tactical_closures?.length || 0,
      tactical_enforcement_length: parsedOutput.tactical_enforcement?.length || 0,
      tactical_sources_length: parsedOutput.tactical_sources?.length || 0,
      model_call_ms: modelCallDuration,
      total_ms: totalDuration,
      prompt_size: promptSize
    });
    
    return { 
      ok: true, 
      strategy: summary,
      tactical: {
        traffic: parsedOutput.tactical_traffic || '',
        closures: parsedOutput.tactical_closures || '',
        enforcement: parsedOutput.tactical_enforcement || '',
        sources: parsedOutput.tactical_sources || ''
      },
      metrics: {
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
