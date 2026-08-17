// tests/offers/parse-model-json.test.js — the tolerant model-reply parser (2026-08-17).
import { parseModelJson } from '../../server/lib/offers/parse-model-json.js';

describe('parseModelJson', () => {
  test('tier 1: clean JSON, fences stripped, parsed_data unwrapped', () => {
    expect(parseModelJson('{"decision":"ACCEPT","per_mile":1.4}')).toEqual({ ok: true, tier: 1, value: { decision: 'ACCEPT', per_mile: 1.4 } });
    expect(parseModelJson('```json\n{"decision":"REJECT"}\n```').value).toEqual({ decision: 'REJECT' });
    expect(parseModelJson('{"parsed_data":{"price":9.1},"decision":"REJECT"}').value).toEqual({ price: 9.1 });
    expect(parseModelJson('{"parsed_data":{"price":9.1},"decision":"REJECT"}', { unwrap: false }).value).toEqual({ parsed_data: { price: 9.1 }, decision: 'REJECT' });
  });

  test('tier 2: preamble/epilogue around the object', () => {
    const r = parseModelJson('Sure! Here is the JSON:\n{"decision":"ACCEPT","reason":"$1.40 6.1mi"}\nHope this helps.');
    expect(r.ok).toBe(true); expect(r.tier).toBe(2); expect(r.value.decision).toBe('ACCEPT');
  });

  test('tier 3: missing closing brace is repaired (live-observed on gemini-3.5-flash)', () => {
    const truncated = '{\n  "price": 8.54,\n  "per_mile": 1.4,\n  "notices": [\n    "Verified Rider",\n    "Filter Detected"\n  ],\n  "decision": "ACCEPT",\n  "reason": "$1.40 6.1mi"';
    const r = parseModelJson(truncated);
    expect(r.ok).toBe(true); expect(r.tier).toBe(3);
    expect(r.value.decision).toBe('ACCEPT'); expect(r.value.notices).toEqual(['Verified Rider', 'Filter Detected']);
  });

  test('tier 3 tolerates a dangling comma but not deeper damage', () => {
    expect(parseModelJson('{"decision":"REJECT",').value).toEqual({ decision: 'REJECT' });
    expect(parseModelJson('{"decision":"REJECT","notices":["a"').ok).toBe(false); // unclosed array — fail loud
  });

  test('empty / non-JSON → ok:false', () => {
    expect(parseModelJson('').ok).toBe(false);
    expect(parseModelJson('No ride offer visible.').ok).toBe(false);
    expect(parseModelJson(null).ok).toBe(false);
  });
});
