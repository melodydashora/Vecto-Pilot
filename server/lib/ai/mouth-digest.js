// server/lib/ai/mouth-digest.js — "what the brain learned" digest for the voice mouth
//
// 2026-08-14 (feed-the-mouth / learning loop): assembles the brain's learned,
// user-curated knowledge of a driver — top coach memos + behavioral notes —
// into one compact string for a voice session's instructions
// (VoiceTokenContext.learned, consumed by buildMouthInstructions on the
// client). The brain renders these same sources into its own prompt at
// 280 chars per item (rideshare-coach-dal.js formatContextForPrompt); this is
// the mouth-sized cut of that same knowledge.
//
// OPTIONAL-data contract: the token mint must NEVER fail because the digest
// did. Any error → console.warn (counts only, never content) → null. Nothing
// learned yet → null (the mint omits the field; no fabricated filler).

import { rideshareCoachDAL } from './rideshare-coach-dal.js';

// Mirror the brain's own 280-char item render (dal.js formatContextForPrompt).
const ITEM_CHAR_CAP = 280;
// Top 8 of each — the DAL pre-orders (notes: pinned > importance > recency;
// memos: recency), so slicing the head keeps the highest-signal items.
const ITEM_COUNT = 8;
// Whole digest cap. Enforced by dropping WHOLE items once the joined string
// would pass it — items are never mid-truncated below the 280-char item cut.
const DIGEST_CHAR_CAP = 1500;
// 2026-08-14 (live-verified priority inversion): memos-first fill let 5
// recency-ordered memos (mostly product-inbox items) eat the whole budget and
// starve every behavioral note — the exact "do not repeatedly bring up X"
// knowledge the mouth exists to obey. NOTES fill first (they are ABOUT the
// driver, ranked pinned > importance); memos keep a reserved floor so a big
// note pile can't fully silence them either.
const MEMO_RESERVE_CHARS = 400;
const SEPARATOR = ' | ';

/**
 * Build the learned-about-this-driver digest for the voice mouth.
 * @param {string} userId - Authenticated user id (never the request body's)
 * @returns {Promise<string|null>} Compact digest, or null when there is
 *   nothing to say or anything went wrong (optional data — never throws).
 */
export async function buildLearnedDigest(userId) {
  if (!userId) return null;

  try {
    const [memos, notes] = await Promise.all([
      rideshareCoachDAL.getCoachMemosForContext(userId, ITEM_COUNT),
      rideshareCoachDAL.getUserNotes(userId, ITEM_COUNT),
    ]);

    const noteItems = [];
    for (const n of notes || []) {
      const body = [n.title, n.content].filter(Boolean).join(' — ').trim();
      if (body) noteItems.push(`[note] ${body.substring(0, ITEM_CHAR_CAP)}`);
    }
    const memoItems = [];
    for (const m of memos || []) {
      const body = [m.title, m.detail].filter(Boolean).join(' — ').trim();
      if (body) memoItems.push(`[memo] ${body.substring(0, ITEM_CHAR_CAP)}`);
    }
    if (noteItems.length === 0 && memoItems.length === 0) return null;

    // Three-pass whole-item fill, rank order preserved within each source:
    // 1. notes up to (cap − memo reserve, when memos exist);
    // 2. memos up to the cap;
    // 3. remaining notes into whatever the memos left unused.
    // Items are never mid-truncated below the 280-char item cut.
    const keptNotes = [];
    const keptMemos = [];
    let total = 0;
    const cost = (item) => item.length + (keptNotes.length + keptMemos.length > 0 ? SEPARATOR.length : 0);
    const memoReserve = memoItems.length > 0 ? MEMO_RESERVE_CHARS : 0;
    let noteIdx = 0;
    for (; noteIdx < noteItems.length; noteIdx++) {
      if (total + cost(noteItems[noteIdx]) > DIGEST_CHAR_CAP - memoReserve) break;
      total += cost(noteItems[noteIdx]);
      keptNotes.push(noteItems[noteIdx]);
    }
    for (const item of memoItems) {
      if (total + cost(item) > DIGEST_CHAR_CAP) break;
      total += cost(item);
      keptMemos.push(item);
    }
    for (; noteIdx < noteItems.length; noteIdx++) {
      if (total + cost(noteItems[noteIdx]) > DIGEST_CHAR_CAP) break;
      total += cost(noteItems[noteIdx]);
      keptNotes.push(noteItems[noteIdx]);
    }
    const kept = [...keptNotes, ...keptMemos];
    if (kept.length === 0) return null;

    // Counts only — never digest content — in logs.
    console.log(
      `[COACH] [MOUTH-DIGEST] built: ${keptNotes.length}/${noteItems.length} notes + ${keptMemos.length}/${memoItems.length} memos, ${total} chars for user ${userId.slice(0, 8)}`
    );
    return kept.join(SEPARATOR);
  } catch (err) {
    console.warn('[COACH] [MOUTH-DIGEST] failed (omitting digest):', err.message);
    return null;
  }
}
