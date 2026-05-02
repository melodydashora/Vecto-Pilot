// 2026-05-02: Workstream 6 Step 1 — extracted from briefing-service.js (commit 2/11).
// Multi-attempt JSON parser hardened against the various ways LLMs (Gemini, Claude,
// GPT) corrupt their JSON output: literal \n sequences, markdown code fences,
// citation links, single-quote delimiters, unquoted property names, trailing
// commas, embedded comments, malformed brackets from grounding citations, etc.
//
// Pure function — zero external dependencies (only stdlib + console).
// Imported by every pipeline module that parses an LLM response.

/**
 * Safely parse JSON from LLM responses.
 * Handles unescaped newlines, markdown blocks, citations, and other formatting issues.
 *
 * Attempts (in order):
 *   1. Direct JSON.parse after markdown-fence removal
 *   2. JSON.parse after applying common fixes (single-quote → double, unquoted keys, etc.)
 *   3. Strip markdown prose, extract first balanced [...] or {...}, parse
 *   4. Same as 3 but apply common fixes first
 *   5. Last resort: brace-matching extraction of individual top-level objects
 *
 * @param {string} jsonString - raw LLM output
 * @returns {object|array} parsed JSON value
 * @throws {Error} if all 5 attempts fail
 */
export function safeJsonParse(jsonString) {
  if (!jsonString || typeof jsonString !== 'string') {
    throw new Error('JSON parse failed: input is empty or not a string');
  }

  // 2026-04-05: PRE-PROCESSING — Replace literal \n sequences with real newlines BEFORE
  // any parse attempt. AI models sometimes return JSON with literal backslash-n between
  // tokens. Real newlines are valid JSON whitespace between tokens, and JSON.parse handles
  // \n escape sequences inside strings natively — so this global replacement is safe.
  // Also handle \\n (doubled backslash from stringify) and literal \r\n.
  jsonString = jsonString
    .replace(/\\r\\n/g, '\n')   // literal \r\n → real newline
    .replace(/\\r/g, '')         // literal \r → remove
    .replace(/\\n/g, '\n');      // literal \n → real newline

  function cleanMarkdown(str) {
    let cleaned = str.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    }
    cleaned = cleaned.replace(/```json/g, '').replace(/```/g, '').trim();
    return cleaned;
  }

  // 2026-02-26: FIX - Strip markdown prose/citations that google_search grounding injects.
  // Safety net for when the adapter-level suppression doesn't fully eliminate citations.
  function stripMarkdownProse(str) {
    let cleaned = str;

    // Remove inline markdown links: [text](url) → text
    cleaned = cleaned.replace(/\[([^\]]*)\]\([^)]+\)/g, '$1');

    // 2026-04-09: FIX (D-095) - Strip malformed markdown link artifacts that Gemini injects
    // into JSON string values. The valid markdown regex above only catches well-formed
    // [text](url). Malformed variants like ([collintimes.com) leave stray brackets/parens.
    cleaned = cleaned.replace(/\(\[([^\]]*?)\)(?!\s*[{[\],:}])/g, '$1');
    cleaned = cleaned.replace(/(?<=:\s*"[^"]*)\[([^\]]*)\](?!\s*[,\]}:({])/g, '$1');
    cleaned = cleaned.replace(/(?<=\w)\((?:https?:\/\/)?[a-zA-Z0-9.-]+\.[a-z]{2,}[^)]*\)/g, '');

    // Remove standalone markdown lines (headers, horizontal rules) that precede JSON
    const lines = cleaned.split('\n');
    const jsonLines = [];
    let foundJson = false;
    for (const line of lines) {
      if (!foundJson && /^#{1,6}\s|^\*{3,}$|^-{3,}$/.test(line.trim())) continue;
      if (!foundJson && line.trim() && !/[{[\]}",:]/.test(line)) continue;
      if (/[{[\]}]/.test(line)) foundJson = true;
      jsonLines.push(line);
    }

    return jsonLines.join('\n').trim();
  }

  // 2026-02-17: FIX - Three bugs that CORRUPTED valid JSON instead of fixing it:
  //   Bug 1: Single-quote regex treated English apostrophes as delimiters
  //   Bug 2: Unquoted-property regex matched word:colon inside string values
  //   Bug 3: Newline regex only fixed the LAST \n per string (greedy backtrack)
  function fixCommonJsonIssues(str) {
    let fixed = str;

    // 2026-02-17: Only convert single quotes to double quotes when the string is
    // Python-style output (no double quotes at all).
    const hasSingleQuoteDelimiters = !fixed.includes('"') && fixed.includes("'");
    if (hasSingleQuoteDelimiters) {
      fixed = fixed.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"');
    }

    // 2026-02-17: Only fix unquoted property names when the string doesn't already
    // have double-quoted properties.
    const hasDoubleQuotedProperties = /"[^"]+"\s*:/.test(fixed);
    if (!hasDoubleQuotedProperties) {
      fixed = fixed.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
    }

    // Remove trailing commas before } or ]
    fixed = fixed.replace(/,\s*([}\]])/g, '$1');

    // 2026-02-19: FIX - Strip carriage returns instead of escaping them.
    fixed = fixed.replace(/\r/g, '');

    // 2026-02-19: Strip JavaScript-style // line comments after JSON values.
    // Only strip when // follows a JSON value terminator to avoid matching URLs.
    fixed = fixed.replace(/([\]}"'\d])\s*\/\/[^\n]*$/gm, '$1');

    // 2026-02-17: FIX - Loop newline replacement to handle MULTIPLE newlines per string.
    // Only escapes newlines INSIDE quoted string values.
    let prevFixed;
    do {
      prevFixed = fixed;
      fixed = fixed.replace(/"([^"]*)\n([^"]*)"/g, (match, p1, p2) => `"${p1}\\n${p2}"`);
    } while (fixed !== prevFixed);

    // 2026-02-19: FIX - Replace tabs with spaces instead of escaping to literal \t.
    fixed = fixed.replace(/\t/g, ' ');

    return fixed;
  }

  const cleaned = cleanMarkdown(jsonString);

  // Attempt 1: Direct parse
  try {
    return JSON.parse(cleaned);
  } catch (_e1) {
    // Continue to next attempt
  }

  // Attempt 2: Parse with common fixes applied
  try {
    const fixed = fixCommonJsonIssues(cleaned);
    return JSON.parse(fixed);
  } catch (_e2) {
    // Continue to next attempt
  }

  // Attempt 3: Strip markdown prose, then extract JSON array or object
  // 2026-02-26: FIX - Apply stripMarkdownProse before regex to prevent markdown citations
  // (e.g., [Source](url)) from being captured as the start of a JSON array.
  const strippedInput = stripMarkdownProse(jsonString);
  const jsonMatch = strippedInput.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  if (jsonMatch) {
    // 2026-02-18: FIX - Hoist variable to outer scope so catch handler can access it
    let fixedExtracted = null;
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (_e3) {
      // Try with fixes
      try {
        fixedExtracted = fixCommonJsonIssues(jsonMatch[0]);
        return JSON.parse(fixedExtracted);
      } catch (e4) {
        // 2026-02-17: Enhanced logging — show BOTH raw extraction and post-fix to diagnose
        console.error('[BRIEFING] All 4 parse attempts failed:', e4.message);
        console.error('[BRIEFING] RAW extracted (first 500 chars):', jsonMatch[0].substring(0, 500));
        console.error('[BRIEFING] AFTER fixes (first 500 chars):', fixedExtracted?.substring(0, 500) ?? '(null)');
      }
    }
  }

  // Attempt 5: Extract individual JSON objects via balanced brace matching
  // 2026-02-26: Last resort when greedy regex fails due to markdown corruption.
  const objects = [];
  let braceDepth = 0;
  let objStart = -1;
  const src = strippedInput || jsonString;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '{') {
      if (braceDepth === 0) objStart = i;
      braceDepth++;
    } else if (src[i] === '}') {
      braceDepth--;
      if (braceDepth === 0 && objStart !== -1) {
        try {
          const obj = JSON.parse(src.slice(objStart, i + 1));
          objects.push(obj);
        } catch {
          // Skip malformed object, try next
        }
        objStart = -1;
      }
    }
  }
  if (objects.length > 0) {
    console.log(`[BRIEFING] Attempt 5: Extracted ${objects.length} individual JSON objects via brace matching`);
    return objects.length === 1 ? objects[0] : objects;
  }

  // 2026-02-17: Log the raw input that caused total parse failure
  console.error('[BRIEFING] RAW AI output (first 300 chars):', jsonString.substring(0, 300));
  throw new Error(`JSON parse failed after 5 attempts - raw AI response is malformed JSON`);
}
