// 2026-01-08: Renamed from dump-last-briefing.js to output sent-to-strategist.txt
// Shows exactly what data is sent to the strategist for verification against OpenAI logs
import { db } from '../../db/drizzle.js';
import { briefings, snapshots, strategies } from '../../../shared/schema.js';
import { desc, eq } from 'drizzle-orm';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { filterInvalidEvents } from './briefing-service.js';

/**
 * Write the last briefing + snapshot + strategy to sent-to-strategist.txt
 * Called after briefing generation to capture state for debugging
 * 2026-01-08: Renamed file and enhanced content for OpenAI log verification
 */
export async function dumpLastBriefingRow() {
  try {
    // Get the most recently UPDATED briefing (populated, not placeholder)
    const [lastBriefing] = await db.select()
      .from(briefings)
      .orderBy(desc(briefings.updated_at))
      .limit(1);

    if (!lastBriefing) {
      console.log('[DumpStrategist] No briefing rows found');
      return;
    }

    // Fetch the corresponding snapshot row
    const [snapshot] = await db.select()
      .from(snapshots)
      .where(eq(snapshots.snapshot_id, lastBriefing.snapshot_id))
      .limit(1);

    // Fetch the strategy row
    const [strategy] = await db.select()
      .from(strategies)
      .where(eq(strategies.snapshot_id, lastBriefing.snapshot_id))
      .limit(1);

    // Get today's date in snapshot timezone for closure filtering check
    const todayInTimezone = snapshot?.timezone
      ? new Date().toLocaleDateString('en-CA', { timeZone: snapshot.timezone })
      : new Date().toISOString().split('T')[0];

    // Count closures that would be active today
    const activeClosures = Array.isArray(lastBriefing.school_closures)
      ? lastBriefing.school_closures.filter(c => {
          const start = c.closureStart || c.start_date || c.closure_date;
          const end = c.reopeningDate || c.end_date || start;
          return start && todayInTimezone >= start && todayInTimezone <= end;
        })
      : [];

    // Format the output for verification against OpenAI logs
    const output = `════════════════════════════════════════════════════════════════════════════════
SENT TO STRATEGIST - Verification File
════════════════════════════════════════════════════════════════════════════════
Generated: ${new Date().toISOString()}
Snapshot ID: ${lastBriefing.snapshot_id}
════════════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────────┐
│ SECTION 1: SNAPSHOT ROW (Driver Context)                                     │
└─────────────────────────────────────────────────────────────────────────────┘

snapshot_id: ${snapshot?.snapshot_id || '(not found)'}
user_id: ${snapshot?.user_id || '(null)'}

LOCATION (what strategist sees):
  city: ${snapshot?.city || '(null)'}
  state: ${snapshot?.state || '(null)'}
  formatted_address: ${snapshot?.formatted_address || '(null)'}
  lat: ${snapshot?.lat ?? '(null)'}
  lng: ${snapshot?.lng ?? '(null)'}
  timezone: ${snapshot?.timezone || '(null)'}

TIME (what strategist sees):
  local_iso: ${snapshot?.local_iso || '(null)'}
  dow: ${snapshot?.dow ?? '(null)'} (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][snapshot?.dow] || 'unknown'})
  day_part_key: ${snapshot?.day_part_key || '(null)'}
  is_holiday: ${snapshot?.is_holiday ?? false}
  holiday: ${snapshot?.holiday || 'none'}

WEATHER (from snapshot):
${snapshot?.weather ? JSON.stringify(snapshot.weather, null, 2) : '(null)'}

┌─────────────────────────────────────────────────────────────────────────────┐
│ SECTION 2: BRIEFING ROW (AI Context Data)                                    │
└─────────────────────────────────────────────────────────────────────────────┘

briefing_id: ${lastBriefing.id}
snapshot_id: ${lastBriefing.snapshot_id}
created_at: ${lastBriefing.created_at}
updated_at: ${lastBriefing.updated_at}

NEWS (${Array.isArray(lastBriefing.news?.items) ? lastBriefing.news.items.length : 0} items):
${lastBriefing.news ? JSON.stringify(lastBriefing.news, null, 2) : '(null)'}

WEATHER_CURRENT:
${lastBriefing.weather_current ? JSON.stringify(lastBriefing.weather_current, null, 2) : '(null)'}

WEATHER_FORECAST (${Array.isArray(lastBriefing.weather_forecast) ? lastBriefing.weather_forecast.length : 0} hours):
${lastBriefing.weather_forecast ? JSON.stringify(lastBriefing.weather_forecast, null, 2) : '(null)'}

TRAFFIC_CONDITIONS:
${lastBriefing.traffic_conditions ? JSON.stringify(lastBriefing.traffic_conditions, null, 2) : '(null)'}

EVENTS (${Array.isArray(lastBriefing.events) ? lastBriefing.events.length : 0} total):
${lastBriefing.events ? JSON.stringify(lastBriefing.events, null, 2) : '(null)'}

SCHOOL_CLOSURES (${Array.isArray(lastBriefing.school_closures) ? lastBriefing.school_closures.length : 0} total, ${activeClosures.length} active today):
${lastBriefing.school_closures ? JSON.stringify(lastBriefing.school_closures, null, 2) : '(null)'}

AIRPORT_CONDITIONS:
${lastBriefing.airport_conditions ? JSON.stringify(lastBriefing.airport_conditions, null, 2) : '(null)'}

┌─────────────────────────────────────────────────────────────────────────────┐
│ SECTION 3: STRATEGY ROW (AI Output)                                          │
└─────────────────────────────────────────────────────────────────────────────┘

id: ${strategy?.id || '(not found)'}
snapshot_id: ${strategy?.snapshot_id || '(null)'}
status: ${strategy?.status || '(null)'}
error_message: ${strategy?.error_message || '(none)'}
created_at: ${strategy?.created_at || '(null)'}
updated_at: ${strategy?.updated_at || '(null)'}

STRATEGY_FOR_NOW (GPT-5.2 Immediate Strategy):
────────────────────────────────────────────────────────────────────────────────
${strategy?.strategy_for_now || '(null or empty)'}
────────────────────────────────────────────────────────────────────────────────

CONSOLIDATED_STRATEGY (Gemini Daily Strategy):
────────────────────────────────────────────────────────────────────────────────
${strategy?.consolidated_strategy || '(null or empty)'}
────────────────────────────────────────────────────────────────────────────────

┌─────────────────────────────────────────────────────────────────────────────┐
│ SECTION 4: VERIFICATION CHECKLIST                                            │
└─────────────────────────────────────────────────────────────────────────────┘

Data Integrity:
  ✓ Snapshot timezone: ${snapshot?.timezone || 'MISSING!'}
  ✓ Briefing has traffic: ${lastBriefing.traffic_conditions ? 'YES' : 'NO - strategist may fail!'}
  ✓ Briefing has events: ${lastBriefing.events ? 'YES' : 'NO'}
  ✓ Strategy status: ${strategy?.status || 'MISSING'}
  ✓ Strategy has immediate: ${strategy?.strategy_for_now ? 'YES (' + strategy.strategy_for_now.length + ' chars)' : 'NO'}
  ✓ Strategy has daily: ${strategy?.consolidated_strategy ? 'YES (' + strategy.consolidated_strategy.length + ' chars)' : 'NO'}
  ✓ IDs match: ${lastBriefing.snapshot_id === snapshot?.snapshot_id ? 'YES' : 'MISMATCH!'}

School Closures Filter Check:
  Today's date (${snapshot?.timezone || 'UTC'}): ${todayInTimezone}
  Active closures (start_date <= today <= end_date): ${activeClosures.length} / ${Array.isArray(lastBriefing.school_closures) ? lastBriefing.school_closures.length : 0}
  ${activeClosures.length > 0 ? 'Active: ' + activeClosures.map(c => c.schoolName || c.name || 'Unknown').join(', ') : '(None active today)'}

Event Count:
  Total events in briefing: ${Array.isArray(lastBriefing.events) ? lastBriefing.events.length : 0}
  High impact: ${Array.isArray(lastBriefing.events) ? lastBriefing.events.filter(e => e.impact === 'high').length : 0}
  Medium impact: ${Array.isArray(lastBriefing.events) ? lastBriefing.events.filter(e => e.impact === 'medium').length : 0}
  Low impact: ${Array.isArray(lastBriefing.events) ? lastBriefing.events.filter(e => e.impact === 'low').length : 0}

TBD/Unknown Check (RAW DB data - these get filtered at read time):
  Events with TBD in location: ${Array.isArray(lastBriefing.events) ? lastBriefing.events.filter(e => /tbd|unknown/i.test(e.location || '')).length : 0}
  Events with TBD in venue: ${Array.isArray(lastBriefing.events) ? lastBriefing.events.filter(e => /tbd|unknown/i.test(e.venue || '')).length : 0}
  Events with TBD in time: ${Array.isArray(lastBriefing.events) ? lastBriefing.events.filter(e => /tbd|unknown/i.test(e.event_time || '')).length : 0}

Events AFTER filterInvalidEvents (what LLM actually receives):
  Raw events in DB: ${Array.isArray(lastBriefing.events) ? lastBriefing.events.length : 0}
  Filtered events (sent to LLM): ${Array.isArray(lastBriefing.events) ? filterInvalidEvents(lastBriefing.events).length : 0}
  TBD events removed: ${Array.isArray(lastBriefing.events) ? lastBriefing.events.length - filterInvalidEvents(lastBriefing.events).length : 0}

════════════════════════════════════════════════════════════════════════════════
END OF VERIFICATION FILE
════════════════════════════════════════════════════════════════════════════════
`;

    const filePath = join(process.cwd(), 'sent-to-strategist.txt');
    await writeFile(filePath, output, 'utf-8');
    console.log('[DumpStrategist] ✅ Written to sent-to-strategist.txt');
  } catch (err) {
    console.error('[DumpStrategist] ❌ Failed to dump:', err.message);
  }
}
