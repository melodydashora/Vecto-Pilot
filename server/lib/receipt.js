/**
 * RECEIPT LAYER - Deterministic LLM Response Validation
 * 
 * Treats every model response as an untrusted byte stream.
 * Returns either a validated object or a precise, actionable failure.
 * No guessing, no silent fixes, no dependence on response size.
 */

import Ajv from 'ajv';

/**
 * Build a receiver for a specific schema
 * @template T
 * @param {object} schema - JSON Schema definition
 * @returns {function(string): ReceiptResult<T>}
 */
export function createReceiver(schema) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  return function receive(rawInput) {
    const raw = rawInput ?? "";
    const bytes = Buffer.byteLength(raw, "utf8");

    if (!raw.trim()) {
      return { status: "empty", raw, bytes };
    }

    // 1) Strip common fences safely; never modify content otherwise
    const defenced = stripCodeFences(raw);

    // 2) Extract exactly one complete top-level JSON object from the text
    const extracted = extractFirstJsonObject(defenced);
    if (extracted.status !== "ok") {
      if (extracted.reason === "truncated_braces") {
        return { status: "incomplete", raw, bytes, reason: "truncated_braces" };
      }
      return { status: "nonjson", raw, bytes };
    }

    // 3) Parse without "helping." If it throws, payload is not valid JSON
    let obj;
    try {
      obj = JSON.parse(extracted.json);
    } catch {
      return { status: "nonjson", raw, bytes };
    }

    // 4) Validate against schema. If invalid, return all errors
    if (!validate(obj)) {
      const errors = (validate.errors ?? []).map(e =>
        `${e.instancePath || "/"} ${e.message || "invalid"}`
      );
      return { status: "invalid", raw, bytes, errors };
    }

    return { status: "ok", value: obj, raw, bytes };
  };
}

/**
 * Removes ```json … ``` or ``` … ``` wrappers if present; no other edits
 */
function stripCodeFences(s) {
  const trimmed = s.trimStart();
  if (!trimmed.startsWith("```")) return s;

  // First fence line (may be ```json or ```JSON or ```anything)
  const firstNewline = trimmed.indexOf("\n");
  if (firstNewline === -1) return s; // one-line fence—let later steps handle
  const afterFence = trimmed.slice(firstNewline + 1);

  // Closing fence
  const closeIdx = afterFence.lastIndexOf("```");
  if (closeIdx === -1) return s; // no closing fence—don't guess
  const inner = afterFence.slice(0, closeIdx);
  return inner;
}

/**
 * Finds the first complete top-level JSON object by brace balance.
 * Does not "repair" anything—only detects completeness.
 */
function extractFirstJsonObject(s) {
  const start = s.indexOf("{");
  if (start < 0) return { status: "err", reason: "no_brace" };

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;

    if (depth === 0) {
      const json = s.slice(start, i + 1);
      return { status: "ok", json };
    }
  }

  return { status: "err", reason: "truncated_braces" };
}
