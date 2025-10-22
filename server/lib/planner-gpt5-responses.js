// server/lib/planner-gpt5-responses.js
// Optional: GPT-5 Responses API with strict schema (no streaming, guaranteed valid JSON)
const RESP_URL = "https://api.openai.com/v1/responses";

export async function runPlannerGPT5Strict({ shortlist, clock, goals, timeoutMs = 3500 }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const controller = new AbortController();
  const killer = setTimeout(() => controller.abort(), timeoutMs);

  const schema = {
    type: "object",
    required: ["strategy_for_now","per_venue"],
    additionalProperties: false,
    properties: {
      strategy_for_now: { type:"string", maxLength: 900 },
      per_venue: {
        type:"array",
        items: {
          type:"object",
          required:["name","pro_tips"],
          additionalProperties: false,
          properties: {
            name: { type:"string" },
            pro_tips: { type:"array", maxItems: 4, items: { type:"string", maxLength: 140 } }
          }
        }
      }
    }
  };

  const body = {
    model: "gpt-5",
    reasoning_effort: "medium",
    response_format: { type: "json_schema", json_schema: { name: "Plan", strict: true, schema } },
    input: [
      { role: "developer", content: "You are a rideshare strategy planner. Only use the provided venues. Hard caps: strategy ≤120 words; ≤4 bullets/venue; ≤140 chars/bullet." },
      { role: "user", content:
        `Clock: ${clock}\nDriver goals: ${goals || "maximize $/hr, minimize unpaid miles"}\nShortlist (DO NOT add venues):\n` +
        shortlist.map(v => `- ${v.name} (potential $${v.data.potential}, ${v.data.driveTimeMinutes} min, surge ${v.data.surge}x)`).join("\n")
      }
    ],
    max_output_tokens: 1200
  };

  try {
    const res = await fetch(RESP_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text().catch(()=> "")}`);
    const j = await res.json();
    const parsed = j.output?.[0]?.content?.[0]?.parsed;
    if (!parsed) throw new Error("Planner (Responses API) returned no parsed object.");
    return { raw: JSON.stringify(parsed), parsed, elapsed_ms: 0 };
  } finally {
    clearTimeout(killer);
  }
}
