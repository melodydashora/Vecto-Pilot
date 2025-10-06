// server/routes/blocks-triad-strict.js
// Strict single-path triad: Claude → GPT-5 → Gemini. No fallbacks.
// If a stage fails or returns the wrong shape, respond with explicit error.

import express from "express";
import { loadAssistantPolicy } from "../eidolon/policy-loader.js";
import { policyGuard } from "../eidolon/policy-middleware.js";

const router = express.Router();
const policy = loadAssistantPolicy(process.env.ASSISTANT_POLICY_PATH || "config/assistant-policy.json");

router.use(policyGuard(policy));

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_URL    = "https://api.openai.com/v1/chat/completions";
const GEMINI_URL    = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";
const GPT5_MODEL   = process.env.OPENAI_MODEL || "gpt-5";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-pro";

router.post("/api/blocks-triad", async (req, res) => {
  const started = Date.now();
  const shortlist = Array.isArray(req.body?.shortlist) ? req.body.shortlist : [];
  const snapshot  = req.body?.snapshot || {};
  if (!shortlist.length) {
    return res.status(400).json({ error: "empty_shortlist" });
  }

  const clock = new Date().toLocaleString("en-US", {
    timeZone: snapshot?.timezone || "America/Chicago",
    weekday: "short", hour: "numeric", minute: "2-digit"
  });

  try {
    const strategist = await runClaudeStrategist({ shortlist, snapshot, clock, policy });
    if (!isStrategistOk(strategist)) {
      return res.status(422).json({ error: "strategist_invalid", details: strategist });
    }

    const planner = await runGpt5Planner({ shortlist, strategist, clock, policy });
    if (!isPlannerOk(planner)) {
      return res.status(422).json({ error: "planner_invalid", details: planner });
    }

    const validated = await runGeminiValidator({ shortlist, planner, snapshot, clock, policy });
    if (!isValidatedOk(validated)) {
      return res.status(422).json({ error: "validator_invalid", details: validated });
    }

    return res.status(200).json({
      version: "1.0",
      generatedAt: new Date().toISOString(),
      strategy_for_now: String(validated.strategy_for_now || planner.strategy_for_now).slice(0, 900),
      per_venue: validated.per_venue,
      staging: validated.staging || [],
      seed_additions: validated.seed_additions || [],
      model_route: "claude→gpt5→gemini",
      validation: { status: "ok", flags: [] },
      elapsed_ms: Date.now() - started
    });
  } catch (e) {
    return res.status(500).json({ error: "triad_exception", message: e?.message || String(e) });
  }
});

function isStrategistOk(x) {
  return x && typeof x.strategy_for_now === "string" && Array.isArray(x.ranked_venues);
}
function isPlannerOk(x) {
  if (!x || typeof x.strategy_for_now !== "string" || !Array.isArray(x.per_venue)) return false;
  return x.per_venue.every(v => v && typeof v.name === "string" && Array.isArray(v.pro_tips));
}
function isValidatedOk(x) {
  if (!x) return false;
  if (typeof x.strategy_for_now !== "string") return false;
  if (!Array.isArray(x.per_venue)) return false;
  return x.per_venue.every(v => v && typeof v.name === "string" && Array.isArray(v.pro_tips));
}

async function runClaudeStrategist({ shortlist, snapshot, clock, policy }) {
  const sys = [
    "You are a senior rideshare strategist and economist.",
    "Analyze the snapshot and listed venues only. Never invent venues.",
    'Return JSON only: {"strategy_for_now":"≤120 words","ranked_venues":["names"],"risks":"one sentence"}'
  ].join(" ");
  const user = [
    `Clock: ${clock}`,
    `Location: ${snapshot?.city || ""}, ${snapshot?.state || ""}`,
    `Weather: ${snapshot?.weather || ""} | AQI: ${snapshot?.air_quality || ""} | Airport: ${snapshot?.airport_context || ""}`,
    `Driver goals: ${reqGoals(snapshot)}`,
    "Shortlist (DO NOT add venues):",
    ...shortlist.map(v => `- ${v.name} (potential $${v.data?.potential}, ${v.data?.driveTimeMinutes} min, surge ${v.data?.surge}x)`),
    'Return JSON only: {"strategy_for_now":"...","ranked_venues":["..."],"risks":"..."}'
  ].join("\n");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), policy?.triad?.budgets?.timeouts?.claude_ms ?? 15000);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": process.env.ANTHROPIC_API_KEY
      },
      body: JSON.stringify({ 
        model: CLAUDE_MODEL, 
        max_tokens: policy?.triad?.budgets?.tokens?.claude_max ?? 64000, 
        temperature: parseFloat(process.env.ANTHROPIC_TEMPERATURE || "0.2"),
        system: sys, 
        messages: [{ role: "user", content: user }] 
      }),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`anthropic_${res.status}`);
    const j = await res.json();
    const txt = (j?.content || []).map(p => p?.text || "").join("").trim();
    return safeJson(stripFences(txt));
  } finally { clearTimeout(t); }
}

async function runGpt5Planner({ shortlist, strategist, clock, policy }) {
  const dev = [
    "You are a rideshare planner.",
    "Use only the provided venues; do not add venues or facts.",
    "Derive staging and per-venue pro tips from the strategist plan and the seeded shortlist.",
    "Caps: strategy ≤120 words; ≤4 bullets/venue; ≤140 chars/bullet; staging notes ≤200 chars.",
    "Return JSON only with keys: strategy_for_now, per_venue[{name,pro_tips[]}], staging[{name,notes}]"
  ].join(" ");
  const usr = [
    `Clock: ${clock}`,
    `Driver goals: ${reqGoals()}`,
    `Strategist plan: ${JSON.stringify(strategist)}`,
    "Shortlist (DO NOT add venues):",
    ...shortlist.map(v => `- ${v.name} (potential $${v.data?.potential}, ${v.data?.driveTimeMinutes} min, surge ${v.data?.surge}x)`),
    "Return JSON only."
  ].join("\n");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), policy?.triad?.budgets?.timeouts?.gpt5_ms ?? 120000);
  try {
    const body = {
      model: GPT5_MODEL,
      reasoning_effort: policy?.triad?.invariants?.gpt5_reasoning_effort || "high",
      max_completion_tokens: policy?.triad?.budgets?.tokens?.gpt5_max_completion ?? 16384,
      messages: [{ role: "developer", content: dev }, { role: "user", content: usr }]
    };
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`openai_${res.status}`);
    const j = await res.json();
    const msg = j?.choices?.[0]?.message || {};
    const txt = typeof msg.content === "string" ? msg.content : Array.isArray(msg.content) ? msg.content.map(p => p?.text || "").join("") : "";
    return safeJson(stripFences(txt));
  } finally { clearTimeout(t); }
}

async function runGeminiValidator({ shortlist, planner, snapshot, clock, policy }) {
  const systemInstruction = [
    "You are a strict JSON normalizer and validator.",
    "Tasks:",
    "1) Ensure plan uses only shortlist venues.",
    "2) Enforce caps/shape. Return normalized JSON only (no prose).",
    "3) Propose up to 2 seed_additions choosing ONLY from catalog_names_not_in_shortlist if provided."
  ].join(" ");
  const shortlistNames = shortlist.map(v => v.name);
  const userText = JSON.stringify({
    shortlist_names: shortlistNames,
    planner,
    snapshot: { city: snapshot?.city, state: snapshot?.state, weather: snapshot?.weather, aqi: snapshot?.air_quality, airport: snapshot?.airport_context, clock }
  });

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), policy?.triad?.budgets?.timeouts?.gemini_ms ?? 20000);
  try {
    const url = `${GEMINI_URL(GEMINI_MODEL)}?key=${process.env.GEMINI_API_KEY}`;
    const body = {
      systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: userText }]}],
      generationConfig: {
        maxOutputTokens: policy?.triad?.budgets?.tokens?.gemini_max_output ?? 2048,
        temperature: parseFloat(process.env.GEMINI_TEMPERATURE || "0.2"),
        responseMimeType: "application/json"
      },
      safetySettings: [
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUAL_CONTENT",    threshold: "BLOCK_NONE" }
      ]
    };
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) throw new Error(`gemini_${res.status}`);
    const j = await res.json();
    const parts = j?.candidates?.[0]?.content?.parts || [];
    const txt = parts.map(p => p?.text || "").join("").trim();
    const normalized = safeJson(stripFences(txt));
    if (!normalized) return null;

    const allowed = new Set(shortlistNames);
    const out = {
      strategy_for_now: String(normalized.strategy_for_now || planner.strategy_for_now || "").slice(0, 900),
      per_venue: Array.isArray(normalized.per_venue) ? normalized.per_venue : [],
      staging: Array.isArray(normalized.staging) ? normalized.staging : [],
      seed_additions: Array.isArray(normalized.seed_additions) ? normalized.seed_additions : []
    };
    out.per_venue = out.per_venue.filter(v => v && allowed.has(v.name))
      .map(v => ({ name: v.name, pro_tips: (v.pro_tips || []).slice(0,4).map(s => String(s).slice(0,140)) }));
    out.staging = out.staging.filter(s => s && allowed.has(s.name))
      .map(s => ({ name: s.name, notes: String(s.notes || "").slice(0,200) })).slice(0,6);
    return out;
  } finally { clearTimeout(t); }
}

function reqGoals(snapshot) { return "maximize $/hr, minimize unpaid miles"; }
function stripFences(s){ return (s||"").replace(/```json\s*([\s\S]*?)```/gi,"$1").trim(); }
function safeJson(s){ try{ return JSON.parse(firstBalanced(s)); } catch{ return null; } }
function firstBalanced(s){ let d=0,st=-1; for (let i=0;i<s.length;i++){const c=s[i]; if(c==="{"){if(!d)st=i; d++;} else if(c==="}"){d--; if(!d&&st!==-1) return s.slice(st,i+1);} } return s; }

export default router;
