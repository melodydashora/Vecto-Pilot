// server/lib/planner-gpt5.js
// STRATEGY_TACTICAL role: Generates tactical execution plans from strategist guidance
// 2026-02-13: Migrated from direct callOpenAI to callModel adapter (hedged router + fallback)
import { callModel } from '../ai/adapters/index.js';

export function plannerSystem() {
  return "You are a rideshare strategy planner. Only use the provided venues and fields; do not invent venues or facts. Output concise, non-hedged tactics tailored to the current clock. Hard caps: strategy ≤120 words, ≤4 bullets per venue, ≤140 chars per bullet. Prefer short paid hops over long unpaid drives. If info is insufficient, say so briefly.";
}

export function plannerUser({ clock, shortlist, goals, strategistGuidance }) {
  const lines = [];

  if (strategistGuidance) {
    lines.push(`STRATEGIC DIRECTION (from strategist):`);
    lines.push(strategistGuidance);
    lines.push(``);
    lines.push(`EXECUTE this strategy tactically:`);
  }

  lines.push(`Clock: ${clock}`);
  lines.push(`Driver goal: ${goals || "maximize $/hr, minimize unpaid miles"}`);
  lines.push(`Available venues (DO NOT add venues):`);
  shortlist.forEach(v => {
    lines.push(`- ${v.name} (potential $${v.data.potential}, ${v.data.driveTimeMinutes} min, surge ${v.data.surge}x)`);
  });
  lines.push(``);
  lines.push(`Return ONLY valid JSON:`);
  lines.push(`{`);
  lines.push(`  "strategy_for_now": "tactical execution (≤120 words)",`);
  lines.push(`  "per_venue": [`);
  lines.push(`    { "name": "exact venue name", "pro_tips": ["tip 1 (≤140 chars)", "tip 2", "tip 3"] }`);
  lines.push(`  ]`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`Include ALL venues. Each gets 1-4 tactical pro_tips for max $/hr.`);

  return lines.join("\n");
}

export async function runPlannerGPT5({
  shortlist, clock, goals, strategistGuidance,
  timeoutMs = Number(process.env.PLANNER_DEADLINE_MS || 3500),
  stream = true,
  onPreview
}) {
  console.log(`🔍 [planner-gpt5] PLANNER_DEADLINE_MS env: ${process.env.PLANNER_DEADLINE_MS}, using timeoutMs: ${timeoutMs}`);
  if (!Array.isArray(shortlist) || !shortlist.length) throw new Error("Empty shortlist.");

  const t0 = Date.now();

  try {
    // 2026-02-13: Uses STRATEGY_TACTICAL role via adapter (hedged router + fallback)
    // Registry config: gpt-5.2, medium reasoning_effort, 32000 max_tokens
    const result = await callModel('STRATEGY_TACTICAL', {
      system: plannerSystem(),
      user: plannerUser({ clock, shortlist, goals, strategistGuidance })
    });

    if (!result.ok) throw new Error(`Model error: ${result.error}`);

    const raw = stripFences(result.output);
    return { raw, parsed: safeParse(raw), elapsed_ms: Date.now() - t0 };

  } catch (err) {
    throw err;
  }
}

function stripFences(s){ return (s||"").replace(/```json\s*([\s\S]*?)```/gi,"$1").trim(); }
function firstBalanced(s){ let d=0, st=-1; for(let i=0;i<s.length;i++){const c=s[i]; if(c==="{"){if(!d)st=i; d++;} else if(c==="}"){d--; if(!d&&st!==-1) return s.slice(st,i+1);} } return s; }
function safeParse(s){ try{ return JSON.parse(firstBalanced(s)); } catch{ return undefined; } }
function sniffStrategyPreview(buf){
  const k = `"strategy_for_now"`;
  const i = buf.indexOf(k);
  if (i<0) return "";
  const tail = buf.slice(i + k.length);
  const q1 = tail.indexOf(`"`);
  if (q1<0) return "";
  const rest = tail.slice(q1+1);
  const end = rest.indexOf(`"`);
  return end>0 ? rest.slice(0,end) : rest.slice(0,140);
}
