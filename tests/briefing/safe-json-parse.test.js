import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import { safeJsonParse } from '../../server/lib/briefing/shared/safe-json-parse.js';

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test.each([
  ['carriage return', { text: 'line one\rline two' }],
  ['literal escapes', { text: String.raw`literal \n and \r sequences` }],
  ['backslash path', { path: String.raw`C:\new\route` }],
  ['markdown fence content', { text: 'Keep ```json and ``` literally' }],
  ['links and braces', { text: 'Read [policy](https://example.test/policy), } and ]' }],
])('preserves valid JSON values: %s', (_name, value) => {
  expect(safeJsonParse(JSON.stringify(value))).toEqual(value);
  expect(safeJsonParse('```json\n' + JSON.stringify(value) + '\n```')).toEqual(value);
  expect(safeJsonParse('Here is your result:\n' + JSON.stringify(value))).toEqual(value);
});

test.each([
  ['trailing comma', '{"text":"keep , } and , ]",}', { text: 'keep , } and , ]' }],
  ['structural escaped whitespace', String.raw`{\n"ok":true\r\n}`, { ok: true }],
  ['literal newline inside string', '{"text":"line one\nline two"}', { text: 'line one\nline two' }],
  ['literal tab inside string', '{"text":"one\ttwo"}', { text: 'one\ttwo' }],
  ['unquoted property', '{ok:true,}', { ok: true }],
  ['single quotes', "{'ok':true,'text':'a } b'}", { ok: true, text: 'a } b' }],
  ['structural comment', '{"text":"http://example.test // keep", // remove\n"ok":true}', { text: 'http://example.test // keep', ok: true }],
])('repairs only formatting: %s', (_name, input, value) => {
  expect(safeJsonParse(input)).toEqual(value);
});

test('extracts a complete root without counting brackets inside strings or trailing citations', () => {
  const value = [{ text: 'literal } and ] and escaped " quote' }, { text: 'second' }];
  expect(safeJsonParse('Answer:\n' + JSON.stringify(value) + '\nSources [1]')).toEqual(value);
  expect(safeJsonParse('[aside]\n{"text":"literal }","ok":true}\n[end]'))
    .toEqual({ text: 'literal }', ok: true });
  expect(safeJsonParse('[1]\n{"recommendations":"Wait at { curb","airports":[{"code":"AAA"}]}\n[2]'))
    .toEqual({ recommendations: 'Wait at { curb', airports: [{ code: 'AAA' }] });
  expect(safeJsonParse('[1]\n[]')).toEqual([]);
});

test('preserves commented outer envelopes even when the comment contains braces and quotes', () => {
  expect(safeJsonParse('Answer:\n{ // } " formatting comment\n"airports":[{"code":"AAA"}]}'))
    .toEqual({ airports: [{ code: 'AAA' }] });
  expect(() => safeJsonParse('Answer:\n{ // } " formatting comment\n"airports":[{"code":"AAA"}]'))
    .toThrow(/JSON parse failed/);
});

test.each([
  '[{"ok":1},{"bad":}]',
  'Answer:\n[{"ok":1},{"bad":}]\nSources [1]',
  '[{"ok":1},{"ok":2},{"bad":}]',
  '[{"ok":1}',
  String.raw`[\n{"ok":1},{"bad":}]`,
  '[not json, {"ok":1}]',
  '[undefined,{"ok":1}]',
  '{broken,"items":[{"ok":1}]}',
  '{"airports":[{"code":"AAA"} procedure]}',
])('does not turn malformed or incomplete envelopes into partial success: %s', input => {
  expect(() => safeJsonParse(input)).toThrow(/JSON parse failed/);
});

test.each(['', null, 'No response available'])('rejects absent/non-JSON input: %s', input => {
  expect(() => safeJsonParse(input)).toThrow(/JSON parse failed/);
});
