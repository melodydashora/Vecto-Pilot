// server/lib/offers/parse-model-json.js — tolerant parse of a Phase-1/Phase-2 model reply.
//
// 2026-08-17: extracted from analyze-offer.js (the inline two-tier ladder) and given a
// third tier after the live model bench found gemini-3.5-flash returning otherwise-valid
// JSON WITHOUT its closing brace on 7 of 42 calls (finishReason STOP) — each of those
// was a parse-fail → deterministic fallback (NO DATA on vision) in production.
//
// Tiers, first success wins:
//   1. strip ```json fences → JSON.parse
//   2. slice first "{" … last "}" (model preamble/epilogue)
//   3. slice from first "{" and close the object (drop a dangling comma) — the
//      "missing closing brace" repair. Only a single trailing brace is added; anything
//      deeper still fails loudly and the caller's rules engine answers.
// Returns { ok, value, tier } — `value` unwraps `parsed_data` when the model nested it
// (Phase-1 shape); pass { unwrap: false } to keep the envelope (Phase-2 shape).
// PURE (no db/model imports) — jest-safe.

export function parseModelJson(text, { unwrap: doUnwrap = true } = {}) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, value: null, tier: 0 };
  const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
  const unwrap = (raw) => (doUnwrap && raw && typeof raw === 'object' && raw.parsed_data && typeof raw.parsed_data === 'object') ? raw.parsed_data : raw;

  try {
    return { ok: true, value: unwrap(JSON.parse(cleaned)), tier: 1 };
  } catch { /* fall through */ }

  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return { ok: true, value: unwrap(JSON.parse(cleaned.slice(first, last + 1))), tier: 2 };
    } catch { /* fall through */ }
  }

  if (first !== -1) {
    try {
      const repaired = cleaned.slice(first).replace(/,\s*$/, '') + '}';
      return { ok: true, value: unwrap(JSON.parse(repaired)), tier: 3 };
    } catch { /* fall through */ }
  }

  return { ok: false, value: null, tier: 0 };
}
