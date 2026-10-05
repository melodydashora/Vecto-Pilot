import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AndroidMacroDroidGuide from '../../client/src/components/offer-analyzer/AndroidMacroDroidGuide';
import SetupCard from '../../client/src/components/offer-analyzer/SetupCard';

jest.mock('../../client/src/hooks/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../../client/src/utils/co-pilot-helpers', () => ({ getAuthHeader: () => ({ Authorization: 'Bearer UI_TEST_ONLY' }) }));

describe('MacroDroid setup inside the Offer Analyzer rules form', () => {
  test('navigates every illustration without submitting or changing rules', () => {
    const submit = jest.fn((event) => event.preventDefault());
    const copy = jest.fn();
    render(<form onSubmit={submit}><AndroidMacroDroidGuide hookUrl="https://driver.example.test/api/hooks/analyze-offer" tokenReady onCopyToken={copy} /></form>);
    fireEvent.click(screen.getByText(/Android: MacroDroid screenshot setup/));
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    const pictures = new Set<string>();
    for (let step = 1; step <= 7; step++) {
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(`${step}.`);
      const picture = screen.getByRole('img');
      pictures.add(picture.getAttribute('src')!);
      expect(picture).toHaveAttribute('alt', expect.stringContaining('Setup diagram:'));
      if (step === 4) {
        expect(screen.getByText('https://driver.example.test/api/hooks/analyze-offer')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Copy my token' }));
      }
      if (step < 7) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    }
    expect(pictures.size).toBe(7);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(copy).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
  });

  test('cannot copy a token that has not loaded and points to the retry section', () => {
    const copy = jest.fn();
    render(<AndroidMacroDroidGuide hookUrl="https://driver.example.test/api/hooks/analyze-offer" tokenReady={false} onCopyToken={copy} />);
    fireEvent.click(screen.getByText(/Android: MacroDroid screenshot setup/));
    fireEvent.click(screen.getByRole('button', { name: 'Step 4: Insert your own token' }));
    expect(screen.getByRole('button', { name: 'Copy my token' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Copy my token' }));
    expect(copy).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Your shortcut token' })).toHaveAttribute('href', '#offer-shortcut-token');
  });

  test('copies the signed-in account token while keeping it masked by default', async () => {
    const token = 'TEST_ACCOUNT_TOKEN_FOR_UI_ONLY';
    const fetchBefore = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ token }) });
    const clipboardBefore = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      render(<SetupCard />);
      const input = await screen.findByLabelText('Your private shortcut token');
      expect(input).toHaveAttribute('type', 'password');
      fireEvent.click(screen.getByText(/Android: MacroDroid screenshot setup/));
      fireEvent.click(screen.getByRole('button', { name: 'Step 4: Insert your own token' }));
      fireEvent.click(screen.getByRole('button', { name: 'Copy my token' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(token));
      expect(writeText).not.toHaveBeenCalledWith('YOUR_SHORTCUT_TOKEN');
      expect(screen.getByRole('img').getAttribute('src')).not.toContain(token);
      fireEvent.click(screen.getByRole('button', { name: 'Show token' }));
      expect(input).toHaveAttribute('type', 'text');
      fireEvent.click(screen.getByRole('button', { name: 'Hide token' }));
      expect(input).toHaveAttribute('type', 'password');
    } finally {
      global.fetch = fetchBefore;
      if (clipboardBefore) Object.defineProperty(navigator, 'clipboard', clipboardBefore);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
});
