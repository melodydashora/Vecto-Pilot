// Claude → strategy, GPT-5 → staging + pro tips, Gemini → validate + seed additions.
// Uses 2025 model IDs and endpoints with env-driven configuration.
import { callClaude45Raw } from "./adapters/anthropic-sonnet45.js";
import { callGPT5 } from "./adapters/openai-gpt5.js";
import { callGeminiGenerateContent } from "./adapters/gemini-2.5-pro.js";

export async function runTriadPlan({ shortlist, catalog, snapshot, goals }) {
  const budget = parseInt(process.env.LLM_TOTAL_BUDGET_MS || "180000"); // 3 minutes for full triad
  const t0 = Date.now();
  const left = () => Math.max(0, budget - (Date.now() - t0));
  if (!Array.isArray(shortlist) || !shortlist.length) throw new Error("Empty shortlist");

  const clock = new Date().toLocaleString("en-US", {
    timeZone: snapshot?.timezone || "America/Chicago",
    weekday: "short", hour: "numeric", minute: "2-digit"
  });

  // 1) Claude — strategist (JSON: strategy_for_now, ranked_venues[], risks)
  const claudeSys = [
    "You are a senior rideshare strategist and economist.",
    "Analyze the snapshot and listed venues only. Never invent venues.",
    "Return JSON: {\"strategy_for_now\":\"≤120 words\",\"ranked_venues\":[\"names\"],\"risks\":\"one sentence\"}"
  ].join(" ");
  const claudeUser = [
    `Clock: ${clock}`,
    `Location: ${snapshot?.city || ""}, ${snapshot?.state || ""}`,
    `Weather: ${snapshot?.weather || ""} | AQI: ${snapshot?.air_quality || ""} | Airport: ${snapshot?.airport_context || ""}`,
    `Driver goals: ${goals || "maximize $/hr, minimize unpaid miles"}`,
    "Shortlist (DO NOT add venues):",
    ...shortlist.map(v => `- ${v.name} (potential $${v.data?.potential || 0}, ${v.data?.driveTimeMinutes || 0} min, surge ${v.data?.surge || 1.0}x)`),
    'Return JSON only: {"strategy_for_now":"...","ranked_venues":["..."],"risks":"..."}'
  ].join("\n");

  const claudeCtrl = new AbortController();
  const claudeTimer = setTimeout(() => claudeCtrl.abort(), Math.min(parseInt(process.env.CLAUDE_TIMEOUT_MS || "15000"), left()));
  let strategist = {};
  try {
    const raw = await callClaude45Raw({
      system: claudeSys,
      user: claudeUser,
      abortSignal: claudeCtrl.signal
    });
    strategist = safeJson(raw) || {};
  } finally { clearTimeout(claudeTimer); }

  // Guard: Single-path only - GPT-5 requires valid Claude strategy
  if (!strategist?.strategy_for_now) {
    throw new Error("Claude strategist failed - triad pipeline aborted (single-path only)");
  }

  // 2) GPT-5 — planner (JSON: strategy_for_now, per_venue[{name,pro_tips[]}], staging[{name,notes}])
  // Step 2: GPT-5 Tactical Planning (60s hard timeout - no waiting)
  const plannerDeadline = 60000; // 60 seconds max
  console.log(`[triad] ⏱️  GPT-5 planner deadline: ${plannerDeadline}ms (hard timeout)`);

  const dev = [
    "You are a rideshare planner.",
    "Use only the provided venues; do not add venues or facts.",
    "Derive staging and per-venue pro tips from the strategist plan and the seeded shortlist.",
    "Caps: strategy ≤120 words; ≤4 bullets/venue; ≤140 chars/bullet; staging notes ≤200 chars.",
    "Return JSON only with keys: strategy_for_now, per_venue[{name,pro_tips[]}], staging[{name,notes}]"
  ].join(" ");
  const usr = [
    `Clock: ${clock}`,
    `Driver goals: ${goals || "maximize $/hr, minimize unpaid miles"}`,
    `Strategist plan: ${JSON.stringify(strategist)}`,
    "Shortlist (DO NOT add venues):",
    ...shortlist.map(v => `- ${v.name} (potential $${v.data?.potential || 0}, ${v.data?.driveTimeMinutes || 0} min, surge ${v.data?.surge || 1.0}x)`),
    "Return JSON only."
  ].join("\n");

  const gptCtrl = new AbortController();
  const gptTimer = setTimeout(() => gptCtrl.abort(), Math.min(plannerDeadline, left()));
  let planner = {};
  try {
    const raw = await callGPT5({
      developer: dev,
      user: usr,
      abortSignal: gptCtrl.signal
    });
    planner = safeJson(raw) || {};
  } finally { clearTimeout(gptTimer); }

  // 3) Gemini — validate planner and add seed additions strictly from catalog not in shortlist
  const notInShortlist = catalog
    .filter(v => !shortlist.find(s => s.name === v.name))
    .map(v => v.name);

  const gemSys = [
    "You are a strict JSON normalizer and validator.",
    "Tasks:",
    "1) Ensure plan uses only shortlist venues.",
    "2) Enforce caps/shape. Return normalized JSON only (no prose).",
    "3) Propose up to 2 seed_additions choosing ONLY from catalog_names_not_in_shortlist that maximize ROI."
  ].join(" ");
  const gemUser = JSON.stringify({
    snapshot: {
      city: snapshot?.city, state: snapshot?.state,
      weather: snapshot?.weather, aqi: snapshot?.air_quality,
      airport: snapshot?.airport_context, clock
    },
    shortlist_names: shortlist.map(v => v.name),
    catalog_names_not_in_shortlist: notInShortlist,
    planner
  });

  const gemCtrl = new AbortController();
  const gemTimer = setTimeout(() => gemCtrl.abort(), Math.min(parseInt(process.env.GEMINI_TIMEOUT_MS || "20000"), left()));
  let validated = {};
  try {
    const raw = await callGeminiGenerateContent({
      systemInstruction: gemSys,
      userText: gemUser,
      abortSignal: gemCtrl.signal
    });
    validated = safeJson(raw) || {};
  } finally { clearTimeout(gemTimer); }

  const names = new Set(shortlist.map(v => v.name));
  const final = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    strategy_for_now: String(validated?.strategy_for_now || planner?.strategy_for_now || strategist?.strategy_for_now || "Work the nearest high-ROI venues now.").slice(0, 900),
    per_venue: normPerVenue(validated?.per_venue || planner?.per_venue || [], names),
    staging: normStaging(validated?.staging || planner?.staging || [], names),
    seed_additions: normSeeds(validated?.seed_additions || [], catalog),
    model_route: "claude→gpt5→gemini",
    validation: { status: "ok", flags: [] }
  };
  return final;
}

function normPerVenue(arr, allowed) {
  return (Array.isArray(arr) ? arr : [])
    .filter(x => x && allowed.has(x.name))
    .map(x => ({ name: x.name, pro_tips: (x.pro_tips || []).slice(0,4).map(s => String(s).slice(0,140)) }));
}
function normStaging(arr, allowed) {
  return (Array.isArray(arr) ? arr : [])
    .filter(s => s && allowed.has(s.name))
    .map(s => ({ name: s.name, notes: String(s.notes || "").slice(0,200) }))
    .slice(0, 6);
}
function normSeeds(arr, catalog) {
  const byName = new Map(catalog.map(v => [v.name, v]));
  return (Array.isArray(arr) ? arr : [])
    .map(s => typeof s === "string" ? { name: s, reason: "exploration" } : s)
    .filter(s => s && byName.has(s.name))
    .slice(0, 2)
    .map(s => ({ venueId: byName.get(s.name).venue_id || byName.get(s.name).id, name: s.name, reason: String(s.reason || "exploration").slice(0,140) }));
}
function safeJson(s){ try{ return JSON.parse(firstBalanced(s)); } catch{ return undefined; } }
function firstBalanced(s){ let d=0,st=-1; for(let i=0;i<s.length;i++){const c=s[i]; if(c==="{"){if(!d)st=i; d++;} else if(c==="}"){d--; if(!d&&st!==-1) return s.slice(st,i+1);} } return s; }