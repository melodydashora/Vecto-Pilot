// server/lib/validator-gemini.js
// Validator using GPT-5 (renamed file for compatibility, now uses OpenAI)
import { runOpenAI } from './adapters/openai-unified.js';

export async function validateWithGemini({
  plannerDraft, shortlistNames, schema,
  model = null, // Ignored - uses TRIAD_VALIDATOR_MODEL from env
  timeoutMs = Number(process.env.VALIDATOR_DEADLINE_MS || 1800)
}) {
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

  const input = `${systemInstruction}\n\n${userText}`;

  try {
    const txt = await runOpenAI('TRIAD_VALIDATOR', input, { timeoutMs });
    
    console.log(`🔍 [validator-gpt5] Response length:`, txt?.length || 0, `first 100 chars:`, txt?.slice(0, 100) || '');
    
    if (!txt) return { raw: "", parsed: undefined, status: "empty", issues: ["validator_empty"] };

    const raw = txt.replace(/```json\s*([\s\S]*?)```/gi, "$1").trim();
    let parsed; 
    try { 
      parsed = JSON.parse(firstBalanced(raw)); 
    } catch (e) {
      console.error(`🔍 [validator-gpt5] JSON parse error:`, e.message);
    }
    
    return { 
      raw, 
      parsed, 
      status: parsed ? "ok" : "nonjson", 
      issues: parsed ? [] : ["validator_nonjson"] 
    };

  } catch (err) {
    console.error(`🔍 [validator-gpt5] Error:`, err.message);
    return { 
      raw: "", 
      parsed: undefined, 
      status: "error", 
      issues: [`validator_error: ${err.message}`] 
    };
  }
}

function firstBalanced(s){ let d=0, st=-1; for(let i=0;i<s.length;i++){const c=s[i]; if(c==="{"){if(!d)st=i; d++;} else if(c==="}"){d--; if(!d&&st!==-1) return s.slice(st,i+1);} } return s; }
