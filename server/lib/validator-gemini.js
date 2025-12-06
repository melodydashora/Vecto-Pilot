// server/lib/validator-gemini.js
const GEMINI_URL = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export async function validateWithGemini({
  plannerDraft, 
  shortlistNames, 
  schema,
  // 1. UPDATED: Default to gemini-3-pro-preview if env var is missing
  model = process.env.GEMINI_MODEL || "gemini-3-pro-preview",
  timeoutMs = Number(process.env.VALIDATOR_DEADLINE_MS || 5000) // Increased slightly for Pro models
}) {
  // 2. UPDATED: Using the correct GEMINI_API_KEY from your .env
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY in .env");

  const controller = new AbortController();
  const killer = setTimeout(() => controller.abort(), timeoutMs);

  const systemInstruction = [
    "You are a strict JSON normalizer and schema enforcer.",
    "Compare the planner draft against the provided shortlist and the JSON Schema.",
    "Do not add venues. Clamp numbers to legal ranges. Enforce word caps.",
    "Return only the final JSON object. No prose, no code fences."
  ].join(" ");

  const userText =
    `Shortlist names: ${shortlistNames.join(", ")}\n` +
    `Schema: ${JSON.stringify(schema)}\n` +
    `Planner draft (untrusted): ${plannerDraft}`;

  // 3. UPDATED: Dynamic configuration pulling from .env
  const body = {
    systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: userText }]}],
    generationConfig: {
      // Native JSON enforcement for Gemini 3.0
      responseMimeType: "application/json", 
      // Parameters from your .env (defaulting to your requested values if missing)
      temperature: parseFloat(process.env.MODEL_TEMPERATURE) || 0.0,
      topP: parseFloat(process.env.MODEL_TOP_P) || 0.8,
      topK: parseInt(process.env.MODEL_TOP_K) || 40,
      maxOutputTokens: 4096
    },
    safetySettings: [
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" }
    ]
  };

  try {
    const res = await fetch(`${GEMINI_URL(model)}?key=${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => "Unknown Error");
        throw new Error(`Gemini ${res.status}: ${errText}`);
    }

    const j = await res.json();
    
    // Debug logging
    console.log(`🔍 [validator-gemini] Model: ${model}`);
    
    let txt = "";
    const cand = j.candidates?.[0];
    
    if (cand?.content?.parts?.length) {
      txt = cand.content.parts.map(p => p?.text || "").join("");
    }
    
    txt = (txt || "").trim();
    
    if (!txt) return { raw: "", parsed: undefined, status: "empty", issues: ["validator_empty"] };

    // Cleanup: Even with JSON mode, sometimes models add markdown blocks
    const raw = txt.replace(/```json\s*([\s\S]*?)```/gi, "$1").trim();
    
    let parsed; 
    try { 
        // using firstBalanced as a safety net
        parsed = JSON.parse(firstBalanced(raw)); 
    } catch (e) {
        console.error("JSON Parse Error:", e);
    }
    
    return { raw, parsed, status: parsed ? "ok" : "nonjson", issues: parsed ? [] : ["validator_nonjson"] };

  } finally {
    clearTimeout(killer);
  }
}

// Utility to find the first valid { ... } block
function firstBalanced(s){ let d=0, st=-1; for(let i=0;i<s.length;i++){const c=s[i]; if(c==="{"){if(!d)st=i; d++;} else if(c==="}"){d--; if(!d&&st!==-1) return s.slice(st,i+1);} } return s; }
