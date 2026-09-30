// Shared reconstruction for model-backed Briefing sections. Pure: no provider/DB calls.
// 2026-09-30: Preserve the original text before attempting repairs. The previous
// global escape/fence replacements corrupted valid strings, and object-by-object
// salvage silently discarded malformed array items. Original evidence is retained
// in the September 30 parser review; tests exercise the real parser and airport path.

/** Repair formatting without changing characters inside valid JSON strings. */
function repairFormatting(source) {
  // Retain single-quoted model output without touching apostrophes in JSON strings.
  let input = source;
  if (!input.includes('"') && input.includes("'")) {
    input = input.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g,
      (_match, value) => '"' + value.replace(/\\'/g, "'").replace(/"/g, '\\"') + '"');
  }

  let result = '';
  let inString = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (inString) {
      if (char === '\\') {
        // Preserve existing escapes, including escaped backslashes and quotes.
        result += char;
        if (i + 1 < input.length) result += input[++i];
      } else if (char === '"') {
        inString = false;
        result += char;
      } else if (char.charCodeAt(0) < 32) {
        // Escape a literal control character without losing its value.
        result += JSON.stringify(char).slice(1, -1);
      } else {
        result += char;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
    } else if (char === '\\' && /[nrt]/.test(input[i + 1] || '')) {
      // Literal escape sequences BETWEEN tokens represent structural whitespace.
      result += ' ';
      i++;
    } else if (char === '/' && input[i + 1] === '/') {
      // Comments outside strings only; URLs and // inside values are preserved.
      while (i + 1 < input.length && input[i + 1] !== '\n') i++;
    } else if (char === ',' && /^\s*[}\]]/.test(input.slice(i + 1))) {
      // A structural trailing comma is recoverable; ", }" in a value is data.
      continue;
    } else if (/[A-Za-z_$]/.test(char) && /[{,]\s*$/.test(result)) {
      const property = input.slice(i).match(/^([A-Za-z_$][\w$]*)(\s*:)/);
      if (property) {
        result += JSON.stringify(property[1]) + property[2];
        i += property[0].length - 1;
      } else {
        result += char;
      }
    } else {
      result += char;
    }
  }
  return result;
}

/** Find one complete JSON root, respecting nested arrays, strings and escapes. */
function extractRoot(source) {
  for (let start = 0; start < source.length; start++) {
    const open = source[start];
    if (open !== '{' && open !== '[') continue;
    const tail = source.slice(start + 1).replace(/^(?:\s|\\[nrt]|\/\/[^\n]*(?:\n|$))*/, '');
    // Skip prose annotations such as [Source] / [aside]. Never skip a malformed
    // JSON-shaped envelope to recover only its valid nested children.
    if (open === '[') {
      const citation = source.slice(start).match(/^\[\d+(?:\s*,\s*\d+)*\]\s*(?=[{\[])/);
      if (citation) { start += citation[0].length - 1; continue; }
      if (!/^(?:[\[\]{"'\d-]|true\b|false\b|null\b)/.test(tail)) {
        const annotation = source.slice(start).match(/^\[[A-Za-z][\w .:-]*\](?:\([^)]*\))?/);
        if (annotation) { start += annotation[0].length - 1; continue; }
        return source.slice(start);
      }
    }

    const stack = [open];
    let quote = null;
    for (let end = start + 1; end < source.length; end++) {
      const char = source[end];
      if (quote) {
        if (char === '\\') end++;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === '/' && source[end + 1] === '/') {
        while (end + 1 < source.length && source[end + 1] !== '\n') end++;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '{' || char === '[') {
        stack.push(char);
      } else if (char === '}' || char === ']') {
        const expected = char === '}' ? '{' : '[';
        if (stack.pop() !== expected) return source.slice(start);
        if (stack.length === 0) return source.slice(start, end + 1);
      }
    }
    // Preserve the incomplete envelope so parsing fails; do not salvage children.
    return source.slice(start);
  }
  return null;
}

/**
 * Reconstruct a complete JSON value from model text, fences and surrounding prose.
 * Valid values are parsed untouched. Repairs affect structural formatting only;
 * missing fields, truncated arrays and malformed siblings are never discarded.
 * @param {string} jsonString
 * @returns {object|array}
 * @throws {Error} when the complete response value cannot be reconstructed
 */
export function safeJsonParse(jsonString) {
  if (typeof jsonString !== 'string' || !jsonString.trim()) {
    throw new Error('JSON parse failed: input is empty or not a string');
  }

  const original = jsonString.trim();
  try { return JSON.parse(original); } catch { /* reconstruct the envelope */ }

  // Remove only an enclosing fence, never markdown syntax inside string values.
  const fence = original.match(/^```(?:json)?\s*\n?([\s\S]*?)\s*```$/i);
  const unwrapped = fence ? fence[1].trim() : original;
  try { return JSON.parse(unwrapped); } catch { /* structural repair */ }

  const repaired = repairFormatting(unwrapped);
  try { return JSON.parse(repaired); } catch { /* prose may surround the root */ }

  // Extract BEFORE any content cleanup. Citation links and brackets in strings
  // are data; citations outside the root do not belong to the returned value.
  const root = extractRoot(unwrapped);
  if (root) {
    try { return JSON.parse(root); } catch { /* formatting inside the root */ }
    try { return JSON.parse(repairFormatting(root)); } catch { /* fail complete */ }
  } else {
    // Escaped structural newlines may have hidden the initial JSON token shape.
    const repairedRoot = extractRoot(repaired);
    if (repairedRoot) {
      try { return JSON.parse(repairedRoot); } catch { /* fail complete */ }
    }
  }

  throw new Error('JSON parse failed: response is malformed or incomplete');
}
