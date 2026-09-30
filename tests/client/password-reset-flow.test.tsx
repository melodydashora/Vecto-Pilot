import React from 'react';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis,{TextEncoder,TextDecoder,ResizeObserver:class { observe() {} unobserve() {} disconnect() {} }});
const { MemoryRouter } = await import('react-router-dom');
const { default: ResetPasswordPage } = await import('@/pages/auth/ResetPasswordPage');

beforeEach(() => { global.fetch = jest.fn<typeof fetch>().mockResolvedValue({ok:true,json:async()=>({ok:true})} as Response); });
afterEach(() => cleanup());
function mount(path: string) { render(<MemoryRouter initialEntries={[path]}><ResetPasswordPage /></MemoryRouter>); }
function passwords() {
  fireEvent.change(screen.getByLabelText('New Password'), {target:{value:'SyntheticPass123'}});
  fireEvent.change(screen.getByLabelText('Confirm New Password'), {target:{value:'SyntheticPass123'}});
}
describe('password reset flow-specific validation', () => {
  it('submits an email token with valid passwords without an invisible email error', async () => {
    mount('/auth/reset-password?token=synthetic-reset-token'); passwords();
    fireEvent.click(screen.getByRole('button',{name:'Reset Password'}));
    await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith('/api/auth/reset-password', expect.objectContaining({body:JSON.stringify({token:'synthetic-reset-token',newPassword:'SyntheticPass123'})}));
    await screen.findByText('Password Reset!');
  });
  it('requires email and six-digit code in the SMS flow', async () => {
    mount('/auth/reset-password'); passwords();
    fireEvent.click(screen.getByRole('button',{name:'Reset Password'}));
    await screen.findByText('Please enter a valid email');
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Email'), {target:{value:'driver@example.invalid'}});
    fireEvent.change(screen.getByLabelText('Verification Code'), {target:{value:'123456'}});
    fireEvent.click(screen.getByRole('button',{name:'Reset Password'}));
    await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith('/api/auth/reset-password', expect.objectContaining({body:JSON.stringify({code:'123456',email:'driver@example.invalid',newPassword:'SyntheticPass123'})}));
  });
});
