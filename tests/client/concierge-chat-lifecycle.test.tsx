import React from 'react';
import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AskConcierge } from '@/components/concierge/AskConcierge';

const props = { token: 'fixture-bookmark', lat: 0, lng: 0, timezone: 'UTC' };
beforeEach(() => { Element.prototype.scrollIntoView = jest.fn(); });
afterEach(() => { cleanup(); jest.restoreAllMocks(); });
test('changing location or leaving chat aborts its request', async () => {
  global.fetch = jest.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(() => {}));
  const view = render(<AskConcierge {...props} />);
  fireEvent.change(screen.getByLabelText('Ask the concierge'), { target: { value: 'Hello' } });
  fireEvent.click(screen.getByLabelText('Send question'));
  const signal = jest.mocked(fetch).mock.calls[0][1]?.signal;
  expect(signal?.aborted).toBe(false);
  view.unmount();
  expect(signal?.aborted).toBe(true);
});
test('duplicate submits in the same render cannot dispatch two model requests', async () => {
  global.fetch = jest.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(() => {}));
  render(<AskConcierge {...props} />);
  fireEvent.change(screen.getByLabelText('Ask the concierge'), { target: { value: 'Hello' } });
  const form = screen.getByLabelText('Ask the concierge').closest('form')!;
  await act(async () => { fireEvent.submit(form); fireEvent.submit(form); });
  expect(fetch).toHaveBeenCalledTimes(1);
});
