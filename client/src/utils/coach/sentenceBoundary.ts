/**
 * Pure function that finds the next flushable sentence boundary in a streaming buffer.
 *
 * Powers chunked TTS for the Coach: as Gemini deltas arrive,
 * useStreamingReadAloud calls this repeatedly, slicing complete sentences off
 * the buffer for sequential playback.
 *
 * Rules:
 *   - Sentence terminators: '.', '!', '?'
 *   - Must be followed by whitespace (waiting for whitespace prevents premature
 *     splits when a token boundary lands right after a period)
 *   - Skip terminators inside [...] action tags (e.g. [SAVE_NOTE:{...}])
 *   - Skip decimals (digit on both sides of a period, e.g. "3.14")
 *   - Skip common abbreviations (Mr. Mrs. Dr. St. Inc. etc. vs. e.g. i.e.)
 *   - "\n\n" alone counts as a boundary — useStreamingReadAloud's flush()
 *     exploits this to drain the final fragment
 */

const ABBREVIATIONS = new Set([
  'Mr', 'Mrs', 'Ms', 'Dr', 'St', 'Ave', 'Blvd', 'Rd',
  'Inc', 'Ltd', 'Co', 'Corp', 'LLC',
  'etc', 'vs', 'e.g', 'i.e', 'a.m', 'p.m',
  'U.S', 'U.K', 'No', 'Jr', 'Sr', 'Prof', 'Sgt', 'Capt',
]);

/**
 * Find the index immediately after the next flushable sentence boundary.
 * Returns -1 if no boundary is present yet.
 *
 * The returned index is suitable for `buffer.slice(0, index)` (the completed
 * sentence including terminator + trailing whitespace) and `buffer.slice(index)`
 * (the remainder to keep buffering).
 */
export function findSentenceBoundary(buffer: string): number {
  if (!buffer) return -1;

  let bracketDepth = 0;

  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];

    // Track action-tag bracket depth — never break inside [...]
    if (ch === '[') {
      bracketDepth++;
      continue;
    }
    if (ch === ']') {
      if (bracketDepth > 0) bracketDepth--;
      continue;
    }
    if (bracketDepth > 0) continue;

    // Paragraph break — flush() exploits this to coerce a final boundary
    if (ch === '\n' && buffer[i + 1] === '\n') {
      let j = i + 2;
      while (j < buffer.length && /\s/.test(buffer[j])) j++;
      return j;
    }

    if (ch !== '.' && ch !== '!' && ch !== '?') continue;

    // Need trailing whitespace to commit this boundary; if buffer ends here, wait
    const next = buffer[i + 1];
    if (next === undefined) continue;
    if (!/\s/.test(next)) continue;

    if (ch === '.') {
      // Decimal: digit on both sides of the period (e.g. "3.14")
      const prev = buffer[i - 1];
      if (prev && /\d/.test(prev) && /\d/.test(next)) continue;

      // Abbreviation: walk back to find the word ending at this period
      let wordStart = i - 1;
      while (wordStart >= 0 && /[A-Za-z.]/.test(buffer[wordStart])) {
        wordStart--;
      }
      const word = buffer.slice(wordStart + 1, i);
      if (ABBREVIATIONS.has(word)) continue;
    }

    // Boundary confirmed — skip trailing whitespace to land at next sentence start
    let j = i + 1;
    while (j < buffer.length && /\s/.test(buffer[j])) j++;
    return j;
  }

  return -1;
}
