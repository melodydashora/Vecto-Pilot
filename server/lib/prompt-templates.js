// server/lib/prompt-templates.js
export const plannerSystem = `You are a rideshare strategy planner.
Only use the provided venues and fields; do not invent venues or facts.
Output concise, non-hedged tactics tailored to the current clock.
Hard caps: strategy ≤120 words, ≤4 bullets per venue, ≤140 chars per bullet.
Prefer short paid hops over long unpaid drives. If info is insufficient, say so briefly.`;

export function plannerUser({ clock, shortlist, goals }) {
  return `Clock: ${clock}

Driver goals: ${goals || "maximize $/hr, minimize unpaid miles"}

Shortlist (DO NOT add venues):
${shortlist.map(v => `- ${v.name} (potential $${v.data.potential}, ${v.data.driveTimeMinutes} min, surge ${v.data.surge}x)`).join("\n")}

Return ONLY valid JSON in this exact format:
{
  "strategy_for_now": "your strategy text here (≤120 words)",
  "per_venue": [
    {
      "name": "venue name exactly as listed above",
      "pro_tips": ["tip 1 (≤140 chars)", "tip 2", "tip 3", "tip 4"]
    }
  ]
}

Include ALL venues from the shortlist. Each venue must have 1-4 pro tips.`;
}

export const validatorSystem = `You are a strict JSON normalizer and schema enforcer.
Compare the planner draft against the shortlist and constraints.
Remove unsupported claims, clamp numbers to legal ranges, enforce word caps,
strip numeric ranges into single integers, and return only the final JSON object.
If any hard invariant fails, return {"validation":{"status":"invalid","flags": [...]}} and a sanitized payload.`;

export function validatorUser({ schema, shortlist, plannerDraft }) {
  return `Schema: ${JSON.stringify(schema)}
Shortlist names: ${shortlist.map(v => v.name).join(", ")}
Planner draft (untrusted): ${plannerDraft}`;
}

export const explainerSystem = `You write a 3–5 sentence explainer of *why* tonight's plan works.
No directives that contradict the validated plan. Avoid numbers not in the input.`;
