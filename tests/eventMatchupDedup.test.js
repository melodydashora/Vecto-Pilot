// tests/eventMatchupDedup.test.js
// 2026-06-11: Reversed sports-matchup dedup (follow-up to the events dedup session).
// "Cowboys vs Eagles" and "Eagles vs Cowboys" are the SAME event — both the semantic
// stage (titlesMatch) and the hash stage (generateEventHash) must treat them identically,
// or a re-scrape that flips team order creates a duplicate row. See claude_memory #346
// "KNOWN LIMITATION (still open): reversed-matchup titles ... aren't deduped".
import { describe, it, expect } from '@jest/globals';
import {
  titlesMatch,
  normalizeTitleForComparison,
} from '../server/lib/events/pipeline/deduplicateEventsSemantic.js';
import { generateEventHash } from '../server/lib/events/pipeline/hashEvent.js';

describe('reversed matchup — semantic stage (titlesMatch)', () => {
  it('treats "A vs B" and "B vs A" as the same event', () => {
    expect(titlesMatch('Cowboys vs Eagles', 'Eagles vs Cowboys')).toBe(true);
  });

  it('handles multi-word team names regardless of order', () => {
    expect(
      titlesMatch(
        'Dallas Cowboys vs Philadelphia Eagles',
        'Philadelphia Eagles vs Dallas Cowboys',
      ),
    ).toBe(true);
  });

  it('handles "versus" spelled out and dotted "vs."', () => {
    expect(titlesMatch('Lakers vs. Celtics', 'Celtics versus Lakers')).toBe(true);
  });

  // Regression guards — canonicalization must NOT over-merge.
  it('does NOT match genuinely different matchups', () => {
    expect(titlesMatch('Cowboys vs Eagles', 'Giants vs Jets')).toBe(false);
  });

  it('leaves non-matchup titles unaffected', () => {
    expect(titlesMatch('Taylor Swift', 'Taylor Swift')).toBe(true);
    expect(titlesMatch('Taylor Swift', 'Olivia Rodrigo')).toBe(false);
  });

  it('does not treat a single-word "v" inside a name as a matchup separator', () => {
    // "Stevie V" must not be split on the lone "v"; it stays one identity.
    expect(titlesMatch('Stevie V', 'V Stevie')).toBe(false);
  });
});

describe('reversed matchup — hash stage (generateEventHash)', () => {
  const base = {
    venue_name: 'AT&T Stadium',
    address: '1 AT&T Way',
    city: 'Arlington',
    event_start_date: '2026-09-13',
  };

  it('is order-invariant for reversed matchups at the same venue/date/city', () => {
    const a = generateEventHash({ ...base, title: 'Cowboys vs Eagles' });
    const b = generateEventHash({ ...base, title: 'Eagles vs Cowboys' });
    expect(a).toBe(b);
  });

  it('still distinguishes the same matchup on different dates', () => {
    const a = generateEventHash({ ...base, title: 'Cowboys vs Eagles', event_start_date: '2026-09-13' });
    const b = generateEventHash({ ...base, title: 'Eagles vs Cowboys', event_start_date: '2026-12-25' });
    expect(a).not.toBe(b);
  });

  it('still distinguishes different matchups on the same date', () => {
    const a = generateEventHash({ ...base, title: 'Cowboys vs Eagles' });
    const b = generateEventHash({ ...base, title: 'Giants vs Jets' });
    expect(a).not.toBe(b);
  });
});

describe('normalizeTitleForComparison — matchup canonicalization', () => {
  it('produces the same normalized form for both orderings', () => {
    const a = normalizeTitleForComparison('Cowboys vs Eagles');
    const b = normalizeTitleForComparison('Eagles vs Cowboys');
    expect(a).toBe(b);
  });
});

describe('matchup vs non-matchup must not over-merge (containment guard)', () => {
  // 2026-06-11: adversarial review caught that the containment rule lets a bare team name
  // absorb into a full matchup: "Cowboys vs Eagles".includes("cowboys") === true. A generic
  // "Cowboys" event must NOT merge into the "Cowboys vs Eagles" game.
  it('does not merge a bare team name into a full matchup', () => {
    expect(titlesMatch('Cowboys vs Eagles', 'Cowboys')).toBe(false);
    expect(titlesMatch('Cowboys', 'Cowboys vs Eagles')).toBe(false);
  });

  it('still merges legit non-matchup containment (regression guard)', () => {
    expect(titlesMatch('Jon Wolfe', 'Jon Wolfe Live')).toBe(true);
  });

  it('still merges reversed matchups (feature preserved)', () => {
    expect(titlesMatch('Cowboys vs Eagles', 'Eagles vs Cowboys')).toBe(true);
  });
});
