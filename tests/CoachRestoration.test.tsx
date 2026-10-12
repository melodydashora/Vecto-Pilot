import React from 'react';
import { render, renderHook, act, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { jest, test, expect, afterEach } from '@jest/globals';
import { TextEncoder, TextDecoder } from 'node:util';
import { ReportedMemos } from '../client/src/components/coach/ReportedMemos';
import { confirmedCoachReply } from '../client/src/utils/coach/confirmedReply';
import { applyDonePayload } from '../client/src/utils/coach/actionsResult';
import { readCoachEvents } from '../client/src/utils/coach/readCoachEvents';
import { useCanonicalVoiceSend } from '../client/src/hooks/coach/useCanonicalVoiceSend';

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; localStorage.clear(); });

test('Coach refresh is a completed request for browser capture, never a saved-settings receipt', () => {
  const onRefreshCoachSnapshot = jest.fn();
  const onNotesSaved = jest.fn();
  const request = { requested: true as const, reason: 'Current location is needed for nearby guidance.' };
  applyDonePayload({ done: true, actions_result: { saved: 0, coach_snapshot_refresh: request } }, { onRefreshCoachSnapshot, onNotesSaved });
  expect(onRefreshCoachSnapshot).toHaveBeenCalledTimes(1);
  expect(onNotesSaved).not.toHaveBeenCalled();
  onRefreshCoachSnapshot.mockClear();
  for (const payload of [
    { actions_result: { saved: 0, coach_snapshot_refresh: request } },
    { done: true, error: true, actions_result: { saved: 0, coach_snapshot_refresh: request } },
    { done: true, actions_result: { saved: 0, coach_snapshot_refresh: { ...request, reason: ' ' } } },
  ]) applyDonePayload(payload, { onRefreshCoachSnapshot });
  expect(onRefreshCoachSnapshot).not.toHaveBeenCalled();
});

test('settings receipts show exactly saved changes even if another action or history write failed', () => {
  const offer_rules = { version: 8, hash: 'verified', changed: true, changes: [
    { path: 'gates.block_share', label: 'Block shared rides', before: false, after: true },
    { path: 'limits.pickup_minutes_max', label: 'Maximum pickup minutes', before: 15, after: 8 },
  ] };
  const result = confirmedCoachReply('Everything saved!', { done: true,
    actions_result: { saved: 1, offer_rules, errors: ['Note failed'] }, persistence_error: 'history failed' });
  expect(result).toContain('Offer Analyzer settings saved.');
  expect(result).toContain('Block shared rides: Off → On');
  expect(result).toContain('Maximum pickup minutes: 15 → 8');
  expect(result).toContain('Note failed');
  expect(result).not.toContain('Everything saved!');
  expect(result).toContain('Confirmed changes above remain saved');
  const changed = jest.fn();
  applyDonePayload({ done: true, actions_result: { saved: 1, offer_rules } }, { onOfferRulesSaved: changed });
  expect(changed).toHaveBeenCalledWith(offer_rules);
  changed.mockClear();
  for (const payload of [
    { actions_result: { saved: 1, offer_rules } },
    { done: true, error: true, actions_result: { saved: 1, offer_rules } },
    { done: true, actions_result: { saved: 0, offer_rules: { ...offer_rules, changed: false } } },
    { done: true, actions_result: { saved: 1, offer_rules: { ...offer_rules, version: null } } },
  ]) applyDonePayload(payload, { onOfferRulesSaved: changed });
  expect(changed).not.toHaveBeenCalled();
  expect(confirmedCoachReply('', { done: true, actions_result: { saved: 0,
    offer_rules: { ...offer_rules, changed: false, changes: [] } } })).toContain('already match');
  const rates = confirmedCoachReply('', { done: true, actions_result: { saved: 1, offer_rules: {
    ...offer_rules, changes: [{ path: 'tiers.standard.accept_ladder', label: 'Standard acceptance conditions',
      before: [{ min_per_mile: 1.25, max_total_min_excl: 25 }], after: [{ min_per_mile: 1.5, max_total_min: 20 }] }],
  } } });
  expect(rates).toContain('at least $1.25/mi, under 25 minutes → at least $1.5/mi, up to 20 minutes');
  expect(rates).not.toContain('max_total_min');
});

test('confirmed reply distinguishes memo receipt from generated save claims and failed writes', () => {
  expect(confirmedCoachReply('Saved!', undefined)).toContain('before Coach could confirm');
  const failed = confirmedCoachReply('Saved!', { done: true, actions_result: { saved: 0, errors: ['Memo write failed'] } });
  expect(failed).toContain('not saved');
  expect(failed).not.toContain('Saved!');
  const saved = confirmedCoachReply('Thank you.', { done: true, actions_result: { saved: 1, memos: [{ id: '12345678-abc', title: 'Map bug', type: 'bug', created_at: '2026-09-10' }] } });
  expect(saved).toContain('Saved reported memo: Map bug (receipt 12345678)');
  expect(confirmedCoachReply('Partial claim', { done: true, error: 'Provider unavailable' })).toBe('Provider unavailable');
  expect(confirmedCoachReply('{"actions":[]}', { done: true, response_text: 'Readable answer' })).toBe('Readable answer');
});

test('reported memos distinguishes loading, empty, failed load and retry', async () => {
  let release: (value: unknown) => void = () => {};
  const fetchMock = jest.fn<() => Promise<unknown>>()
    .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ memos: [{ id: '12345678-abc', type: 'bug', title: 'Map bug', detail: 'Pin missing', status: 'new', created_at: '2026-09-10T12:00:00Z' }] }) });
  globalThis.fetch = fetchMock as typeof fetch;
  render(<ReportedMemos userId="alice" />);
  expect(screen.getByRole('status').textContent).toContain('Loading');
  release({ ok: true, json: async () => ({ memos: [] }) });
  await screen.findByText('No reported memos yet.');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh reported memos' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('No reported memos yet.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh reported memos' }));
  await screen.findByText('Map bug');
  expect(screen.getByText('Receipt 12345678')).toBeTruthy();
});

test('switching users clears old memos and ignores a late response from the old user', async () => {
  let resolveAlice: (value: unknown) => void = () => {};
  globalThis.fetch = jest.fn<() => Promise<unknown>>()
    .mockImplementationOnce(() => new Promise(resolve => { resolveAlice = resolve; }))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ memos: [] }) }) as typeof fetch;
  const view = render(<ReportedMemos userId="alice" />);
  view.rerender(<ReportedMemos userId="bob" />);
  await screen.findByText('No reported memos yet.');
  resolveAlice({ ok: true, json: async () => ({ memos: [{ id: 'a', type: 'bug', title: 'Private Alice', detail: 'Do not leak', created_at: '2026-09-10' }] }) });
  await waitFor(() => expect(screen.queryByText('Private Alice')).toBeNull());
});

test('chunk ending after valid JSON before newline produces one delta and one receipt', async () => {
  const previousDecoder = globalThis.TextDecoder;
  globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"delta":"One answer"}',
    '\n\ndata: {"done":true,"actions_result":{"saved":1,"memos":[{"id":"receipt-1","type":"bug","title":"Issue","created_at":"2026-09-10"}]}}',
    '\n',
  ].map(text => encoder.encode(text));
  const reader = {
    read: jest.fn(async () => chunks.length ? { done: false, value: chunks.shift() } : { done: true }),
    cancel: jest.fn(async () => {}), releaseLock: jest.fn(),
  };
  try {
    const events = [];
    for await (const event of readCoachEvents({ getReader: () => reader } as unknown as ReadableStream<Uint8Array>)) events.push(event);
    expect(events.filter(event => event.delta)).toHaveLength(1);
    expect(events.filter(event => event.done)).toHaveLength(1);
    expect(events[1].actions_result?.memos).toHaveLength(1);
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    const tail = [{ done: false, value: encoder.encode('data: {"done":true}') }, { done: true }];
    const tailReader = { ...reader, read: jest.fn(async () => tail.shift()!) };
    const tailEvents = [];
    for await (const event of readCoachEvents({ getReader: () => tailReader } as unknown as ReadableStream<Uint8Array>)) tailEvents.push(event);
    expect(tailEvents).toEqual([{ done: true }]);
  } finally { globalThis.TextDecoder = previousDecoder; }
});

test('silence and manual finalizers send a spoken utterance to the canonical chat once', async () => {
  let transcript = 'Report the missing map pin';
  let finish: () => void = () => {};
  const send = jest.fn<(text: string) => Promise<void>>(() => new Promise(resolve => { finish = resolve; }));
  const clearTranscript = jest.fn(() => { transcript = ''; });
  const hook = renderHook(() => useCanonicalVoiceSend(send, clearTranscript));
  await act(async () => {
    void hook.result.current(transcript); // speech silence finalizer
    void hook.result.current(transcript); // simultaneous manual finalizer
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith('Report the missing map pin');
  expect(clearTranscript).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
  await act(async () => { await hook.result.current(transcript); }); // delayed old finalizer
  expect(send).toHaveBeenCalledTimes(1);
});
