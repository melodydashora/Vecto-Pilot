// tests/coach/parse-actions.test.js
// 2026-09-11: desktop-coach-review.md item 2 — malformed action tags must be REPORTED,
// not silently dropped, so the completion path can refuse a false "saved" claim.
import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { parseActions, extractBalancedJson } from '../../server/api/chat/parse-actions.js';

beforeEach(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });

const DESKTOP_FIXTURE = 'Saved your report. [COACH_MEMO: {"type":"bug","title":"Synthetic issue","detail":"Synthetic detail",}]';

describe('parseActions parse-failure reporting', () => {
  test('Desktop fixture: trailing comma → zero actions, ONE parse error, broken tag removed, prose kept', () => {
    const { actions, cleanedText, parseErrors } = parseActions(DESKTOP_FIXTURE);
    expect(Object.values(actions).every(list => list.length === 0)).toBe(true);
    expect(parseErrors).toHaveLength(1);
    expect(parseErrors[0]).toMatch(/^COACH_MEMO: malformed action JSON/);
    expect(parseErrors[0]).toMatch(/not saved/);
    expect(cleanedText).toBe('Saved your report.');
    expect(cleanedText).not.toContain('[COACH_MEMO');
  });

  test('unclosed braces → parse error, nothing executed', () => {
    const { actions, parseErrors } = parseActions('Noted. [COACH_MEMO: {"type":"bug","title":"x"');
    expect(actions.coachMemos).toHaveLength(0);
    expect(parseErrors).toEqual([expect.stringMatching(/^COACH_MEMO: malformed action data/)]);
  });

  test('well-formed inline tag → one action, no errors, tag stripped', () => {
    const { actions, cleanedText, parseErrors } = parseActions('Saved. [COACH_MEMO: {"type":"bug","title":"Real","detail":"d"}] Done.');
    expect(actions.coachMemos).toEqual([{ type: 'bug', title: 'Real', detail: 'd' }]);
    expect(parseErrors).toEqual([]);
    expect(cleanedText).toBe('Saved.  Done.');
  });

  test('one good and one broken tag → the good one executes, the broken one is reported', () => {
    const text = '[SAVE_NOTE: {"title":"ok","content":"fine"}] and [COACH_MEMO: {"type":"bug",}]';
    const { actions, parseErrors } = parseActions(text);
    expect(actions.notes).toHaveLength(1);
    expect(actions.coachMemos).toHaveLength(0);
    expect(parseErrors).toHaveLength(1);
  });

  test('JSON envelope that fails to parse is reported and the regex fallback still runs', () => {
    const text = '```json\n{"actions": [ {"type": "COACH_MEMO", "data": {"title": "x"}}, ], "response": "hi"}\n```\n[SAVE_NOTE: {"title":"t","content":"c"}]';
    const { actions, parseErrors } = parseActions(text);
    expect(parseErrors.some(e => /JSON action envelope could not be parsed/.test(e))).toBe(true);
    expect(actions.notes).toHaveLength(1);
  });

  test('valid JSON envelope → actions parsed, no errors', () => {
    const text = '```json\n{"actions": [{"type": "COACH_MEMO", "data": {"type": "bug", "title": "x"}}], "response": "Logged it."}\n```';
    const { actions, cleanedText, parseErrors } = parseActions(text);
    expect(actions.coachMemos).toEqual([{ type: 'bug', title: 'x' }]);
    expect(cleanedText).toBe('Logged it.');
    expect(parseErrors).toEqual([]);
  });

  test('extractBalancedJson handles nested braces and strings with braces', () => {
    const s = 'x{"a":{"b":"}"},"c":[1]}y';
    expect(extractBalancedJson(s, 1)).toEqual({ json: '{"a":{"b":"}"},"c":[1]}', endIndex: s.length - 2 });
    expect(extractBalancedJson('nope', 0).json).toBeNull();
  });
});
