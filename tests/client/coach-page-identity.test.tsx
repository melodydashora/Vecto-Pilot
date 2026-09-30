// tests/client/coach-page-identity.test.tsx
// 2026-09-11: desktop-coach-review.md item 1 — CoachPage must key the Coach by the
// authenticated user, never by the never-written legacy localStorage key ('default').
import React from 'react';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, cleanup } from '@testing-library/react';

const received: Array<Record<string, unknown>> = [];
jest.unstable_mockModule('@/components/coach/CoachContextStatus', () => ({ CoachContextStatus: () => null }));
let authValue: { user: { userId: string; email: string } | null } = { user: null };

jest.unstable_mockModule('@/components/RideshareCoach', () => ({
  default: (props: Record<string, unknown>) => { received.push(props); return <div data-testid="coach-stub">{String(props.userId)}</div>; },
}));
jest.unstable_mockModule('@/contexts/co-pilot-context', () => ({
  useCoPilot: () => ({ lastSnapshotId: 'snap-1', strategyData: null, immediateStrategy: null, snapshotData: null, blocks: [] }),
}));
jest.unstable_mockModule('@/contexts/auth-context', () => ({ useAuth: () => authValue }));
const { default: CoachPage } = await import('@/pages/co-pilot/CoachPage');

describe('CoachPage identity', () => {
  beforeEach(() => { received.length = 0; localStorage.clear(); });
  afterEach(cleanup);

  it('renders nothing keyed while the user is unknown (no "default" or "" bucket)', () => {
    authValue = { user: null };
    localStorage.setItem('vecto_user_id', 'stale-legacy-id');
    render(<CoachPage />);
    expect(screen.getByTestId('coach-page-waiting-for-identity')).toBeTruthy();
    expect(received).toHaveLength(0);
  });

  it('passes the authenticated userId, ignoring any legacy localStorage value', () => {
    authValue = { user: { userId: '11111111-1111-4111-8111-111111111111', email: 'a@example.test' } };
    localStorage.setItem('vecto_user_id', 'stale-legacy-id');
    render(<CoachPage />);
    expect(screen.getByTestId('coach-stub').textContent).toBe('11111111-1111-4111-8111-111111111111');
    expect(received[0]).toMatchObject({ userId: '11111111-1111-4111-8111-111111111111', snapshotId: 'snap-1' });
    expect(received.some(p => p.userId === 'default' || p.userId === 'stale-legacy-id')).toBe(false);
  });

  it('a second account on the same device gets its own identity, not the first account\'s', () => {
    authValue = { user: { userId: '22222222-2222-4222-8222-222222222222', email: 'b@example.test' } };
    render(<CoachPage />);
    expect(received[0].userId).toBe('22222222-2222-4222-8222-222222222222');
  });
});
