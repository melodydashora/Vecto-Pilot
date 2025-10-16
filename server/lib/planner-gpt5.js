// server/lib/planner-gpt5.js
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  if (!Array.isArray(shortlist) || !shortlist.length) throw new Error("Empty shortlist.");

  // Use environment variable for reasoning effort - no hardcoded defaults
  const reasoningEffort = process.env.OPENAI_REASONING_EFFORT || process.env.GPT5_REASONING_EFFORT;
  console.log(`🔍 [planner-gpt5] Using reasoning_effort: ${reasoningEffort}`);
  
  // Use environment variable for token allocation - no hardcoded defaults
  const maxTokens = parseInt(process.env.OPENAI_MAX_COMPLETION_TOKENS || process.env.OPENAI_MAX_TOKENS || "32000", 10);
  const body = {
    model: "gpt-5",
    reasoning_effort: reasoningEffort,
    response_format: { type: "json_object" },
    max_completion_tokens: maxTokens,  // Configured via environment variables
    messages: [
      { role: "developer", content: plannerSystem() },
      { role: "user", content: plannerUser({ clock, shortlist, goals, strategistGuidance }) }
    ],
    stream
  };
  
  // Allow override from env if needed
  if (process.env.OPENAI_MAX_TOKENS) {
    body.max_completion_tokens = parseInt(process.env.OPENAI_MAX_TOKENS, 10);
  }

  const controller = new AbortController();
  const killer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text().catch(()=> "")}`);

    if (!stream) {
      const j = await res.json();
      console.log(`🔍 [planner-gpt5] Full OpenAI response:`, JSON.stringify(j).substring(0, 500));
      
      const msg = j.choices?.[0]?.message || {};
      console.log(`🔍 [planner-gpt5] Message keys:`, Object.keys(msg));
      console.log(`🔍 [planner-gpt5] msg.content type:`, typeof msg.content, `value:`, JSON.stringify(msg.content)?.substring(0, 200));
      
      let raw = msg.parsed ? JSON.stringify(msg.parsed)
              : typeof msg.content === "string" ? msg.content
              : Array.isArray(msg.content) ? msg.content.map(p => p?.text || "").join("")
              : "";
      if (!raw) throw new Error("Planner returned empty content.");
      raw = stripFences(raw);
      return { raw, parsed: safeParse(raw), elapsed_ms: Date.now() - t0 };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    let previewSent = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });

      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const j = JSON.parse(data);
          
          // Debug: log the first few chunks to see structure
          if (buf.length < 100) {
            console.log(`🔍 [planner-gpt5] Stream chunk:`, JSON.stringify(j).substring(0, 300));
          }
          
          const delta = j.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            buf += delta;
            if (onPreview && !previewSent) {
              const preview = sniffStrategyPreview(buf);
              if (preview && preview.length > 20) {
                onPreview(preview);
                previewSent = true;
              }
            }
          }
        } catch { }
      }
    }

    const raw = stripFences(buf);
    return { raw, parsed: safeParse(raw), elapsed_ms: Date.now() - t0 };
  } finally {
    clearTimeout(killer);
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
