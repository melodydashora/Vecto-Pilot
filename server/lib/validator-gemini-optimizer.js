// server/lib/validator-gemini-optimizer.js
// Gemini Validator/Optimizer - Reviews GPT-5's selections and suggests improvements

const GEMINI_URL = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export async function validateAndOptimize({
  plannerDraft,
  shortlist, // Full enriched shortlist with all candidates
  claudeStrategy, // Strategic context from Claude
  schema,
  model = process.env.GEMINI_MODEL || "gemini-2.5-pro",
  timeoutMs = Number(process.env.VALIDATOR_DEADLINE_MS || 60000)
}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY");

  const controller = new AbortController();
  const killer = setTimeout(() => controller.abort(), timeoutMs);

  // Build venue comparison table
  const venueTable = shortlist.map(v => 
    `${v.name} | ${v.category} | ${v.data.driveTimeMinutes}min | $${v.data.potential} | ${v.data.surge}x surge`
  ).join('\n');

  const systemInstruction = `You are a rideshare optimization expert with TWO critical jobs:

JOB 1: JSON CLEANER
- Enforce schema compliance (valid JSON, proper field types, word limits)
- Remove any hallucinated venues not in shortlist
- Fix formatting issues, normalize data

JOB 2: TRUE OPTIMIZER  
- Review planner's venue selections for maximum $/hr
- Validate choices against strategic context
- Suggest better alternatives from shortlist if found
- Ensure diversity (different categories, distance bands)
- Reorder/replace venues to improve earnings

Rules:
- ONLY use venues from the provided shortlist
- Can reorder, replace, or modify planner's selections
- Must return valid JSON matching schema
- Brief tactical explanation in strategy_for_now`;

  const userText = `STRATEGIC CONTEXT (from Claude):
${claudeStrategy}

AVAILABLE VENUES (shortlist):
${venueTable}

PLANNER'S SELECTIONS (GPT-5):
${plannerDraft}

TASK:
Review the planner's venue selections. Are they optimal given the strategic context?
- If YES: Return the planner's output (cleaned/validated)
- If NO: Suggest better venues from the shortlist and explain why

Return JSON matching this schema:
${JSON.stringify(schema, null, 2)}`;

  const body = {
    systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: userText }]}],
    generationConfig: {
      temperature: 0.0, // LOWEST - driver's only eyes until ML is trained
      maxOutputTokens: 4096,
      responseMimeType: "application/json" // Force JSON output
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
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini ${res.status}: ${errText}`);
    }
    
    const j = await res.json();
    console.log(`🔍 [validator-optimizer] Response:`, JSON.stringify(j).slice(0, 300));

    let txt = "";
    const cand = j.candidates?.[0];
    
    if (cand?.content?.parts?.length) {
      txt = cand.content.parts.map(p => p?.text || "").join("");
    }
    
    txt = (txt || "").trim();
    
    if (!txt) {
      console.log(`⚠️ [validator-optimizer] Empty response, using planner output`);
      // Fallback: use planner output directly
      try {
        const cleaned = plannerDraft.replace(/```json\s*([\s\S]*?)```/gi, "$1").trim();
        const parsed = JSON.parse(cleaned);
        return { status: 'fallback', parsed, issues: ['validator_empty'] };
      } catch {
        return { status: 'error', parsed: null, issues: ['validator_empty', 'parse_failed'] };
      }
    }

    // Parse optimized output
    const raw = txt.replace(/```json\s*([\s\S]*?)```/gi, "$1").trim();
    let parsed;
    
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.log(`⚠️ [validator-optimizer] Parse failed:`, err.message);
      // Fallback to planner
      try {
        const cleaned = plannerDraft.replace(/```json\s*([\s\S]*?)```/gi, "$1").trim();
        parsed = JSON.parse(cleaned);
        return { status: 'fallback', parsed, issues: ['validator_parse_error'] };
      } catch {
        return { status: 'error', parsed: null, issues: ['validator_parse_error', 'planner_parse_error'] };
      }
    }

    // Validate that Gemini only used venues from shortlist
    const shortlistNames = new Set(shortlist.map(v => v.name.toLowerCase()));
    const blocks = parsed.blocks || parsed.per_venue || [];
    const invalidVenues = blocks.filter(b => 
      !shortlistNames.has(b.name?.toLowerCase())
    );
    
    if (invalidVenues.length > 0) {
      console.log(`⚠️ [validator-optimizer] Hallucinated venues:`, invalidVenues.map(v => v.name));
      return { status: 'hallucination', parsed: null, issues: ['validator_hallucination'] };
    }

    console.log(`✅ [validator-optimizer] Optimized successfully`);
    return { status: 'ok', parsed, issues: [] };

  } catch (err) {
    console.error(`❌ [validator-optimizer] Error:`, err.message);
    
    // Fallback: use planner output
    try {
      const cleaned = plannerDraft.replace(/```json\s*([\s\S]*?)```/gi, "$1").trim();
      const parsed = JSON.parse(cleaned);
      return { status: 'error_fallback', parsed, issues: [err.message] };
    } catch {
      return { status: 'error', parsed: null, issues: [err.message] };
    }
  } finally {
    clearTimeout(killer);
  }
}
