// server/lib/validator-gemini.js
const GEMINI_URL = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export async function validateWithGemini({
  plannerDraft, shortlistNames, schema,
  model = process.env.GEMINI_MODEL || "gemini-3-pro-preview",
  timeoutMs = Number(process.env.VALIDATOR_DEADLINE_MS || 1800)
}) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY");

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

  const body = {
    systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: userText }]}],
    generationConfig: {
      temperature: 0.1,
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
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text().catch(()=> "")}`);
    const j = await res.json();
    
    console.log(`🔍 [validator-gemini] Full Gemini response:`, JSON.stringify(j).slice(0, 500));

    let txt = "";
    const cand = j.candidates?.[0];
    console.log(`🔍 [validator-gemini] Candidate:`, cand ? 'exists' : 'missing', `finishReason:`, cand?.finishReason);
    if (cand?.content?.parts?.length) {
      txt = cand.content.parts.map(p => p?.text || "").join("");
    }
    if (!txt && cand?.groundingMetadata?.webSearchQueries?.length) {
      txt = "";
    }
    txt = (txt || "").trim();
    console.log(`🔍 [validator-gemini] Extracted text length:`, txt.length, `first 100 chars:`, txt.slice(0, 100));
    if (!txt) return { raw: "", parsed: undefined, status: "empty", issues: ["validator_empty"] };

    const raw = txt.replace(/```json\s*([\s\S]*?)```/gi, "$1").trim();
    let parsed; try { parsed = JSON.parse(firstBalanced(raw)); } catch {}
    return { raw, parsed, status: parsed ? "ok" : "nonjson", issues: parsed ? [] : ["validator_nonjson"] };

  } finally {
    clearTimeout(killer);
  }
}

function firstBalanced(s){ let d=0, st=-1; for(let i=0;i<s.length;i++){const c=s[i]; if(c==="{"){if(!d)st=i; d++;} else if(c==="}"){d--; if(!d&&st!==-1) return s.slice(st,i+1);} } return s; }
