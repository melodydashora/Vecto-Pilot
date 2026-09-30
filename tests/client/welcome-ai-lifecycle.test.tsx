import React from 'react';
import { jest, test, expect, beforeEach, afterEach } from '@jest/globals';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SlideAICoPilot } from '@/pages/welcome/slides';
let finish: (response: Response) => void;
beforeEach(() => { jest.useFakeTimers(); global.fetch = jest.fn<typeof fetch>(() => new Promise<Response>(resolve => { finish = resolve; })); });
afterEach(() => { cleanup(); jest.clearAllTimers(); jest.useRealTimers(); });
test('unmount aborts a pending kiosk request and ignores its late response', async () => {
  const { unmount } = render(<SlideAICoPilot />);
  fireEvent.click(screen.getByRole('button', { name: /Generate Starter/ }));
  const signal = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1]?.signal;
  unmount(); expect(signal?.aborted).toBe(true);
  await act(async () => { finish({ ok: true, json: async () => ({ ok: true, text: 'Late synthetic answer' }) } as Response); });
});
test('rapid duplicate input admits one icebreaker request', async () => {
  render(<SlideAICoPilot />);
  const button = screen.getByRole('button', { name: /Generate Starter/ });
  act(() => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ ok: true, json: async () => ({ ok: true, text: 'One synthetic answer' }) } as Response); });
});
test('unmount during retry delay prevents another paid request', async () => {
  global.fetch = jest.fn<typeof fetch>(async () => ({ ok: false, status: 503, json: async () => ({ ok: false }) }) as Response);
  const { unmount } = render(<SlideAICoPilot />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Generate Starter/ })); });
  unmount();
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
