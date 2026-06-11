/**
 * server/lib/events/pipeline/canonicalizeMatchup.js
 *
 * Canonicalize a "versus" matchup title so team/competitor order doesn't matter.
 * "cowboys vs eagles" and "eagles vs cowboys" both canonicalize to "cowboys vs eagles".
 *
 * 2026-06-11: Closes the reversed-matchup dedup gap logged in claude_memory #346
 * ("reversed-matchup titles 'A vs B' / 'B vs A' still aren't deduped"). Applied in BOTH
 * the semantic stage (deduplicateEventsSemantic.normalizeTitleForComparison) AND the hash
 * stage (hashEvent.buildHashInput) — if only one stage canonicalized, the two dedup layers
 * would disagree (one merges the reversed pair, the other creates a duplicate row).
 *
 * CONSERVATIVE BY DESIGN — only fires on an explicit "vs" / "versus" separator token, and
 * only when there is exactly one such token with a non-empty side on each end. Bare "v" and
 * "at" are intentionally NOT treated as separators: "v" collides with real names (e.g.
 * "Stevie V"), and "at" is already consumed upstream as an "at <Venue>" suffix stripper.
 * Anything ambiguous is returned unchanged — no over-merging.
 *
 * INPUT CONTRACT: expects an ALREADY-normalized title — lowercase, special chars stripped,
 * single-spaced (i.e. the output of normalizeTitleForComparison / normalizeForHash, where
 * "vs." has already collapsed to the bare token "vs"). Calling it on a raw title is a no-op
 * for most inputs but is not the intended contract.
 *
 * @param {string} normalized - normalized lowercase token string
 * @returns {string} order-invariant matchup, or the input unchanged
 */
export function canonicalizeMatchup(normalized) {
  if (!normalized || typeof normalized !== 'string') return normalized;

  const tokens = normalized.split(' ');
  const sepIndexes = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === 'vs' || tokens[i] === 'versus') sepIndexes.push(i);
  }

  // Only canonicalize an unambiguous two-sided matchup (exactly one separator).
  if (sepIndexes.length !== 1) return normalized;

  const sep = sepIndexes[0];
  const left = tokens.slice(0, sep).join(' ').trim();
  const right = tokens.slice(sep + 1).join(' ').trim();
  if (!left || !right) return normalized;

  const [a, b] = [left, right].sort();
  return `${a} vs ${b}`;
}
