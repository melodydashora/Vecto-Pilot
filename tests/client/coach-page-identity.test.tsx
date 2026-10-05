// tests/client/coach-page-identity.test.tsx
// 2026-09-11: desktop-coach-review.md item 1 — CoachPage must key the Coach by the
// authenticated user, never by the never-written legacy localStorage key ('default').
import React from 'react';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, cleanup } from '@testing-library/react';

const received: Array<Record<string, unknown>> = [];
const receivedStatus: Array<Record<string, unknown>> = [];
jest.unstable_mockModule('@/components/coach/CoachContextStatus', () => ({
  CoachContextStatus: (props: Record<string, unknown>) => { receivedStatus.push(props); return null; },
}));
let authValue: { user: { userId: string; email: string } | null; sessionId?: string } = { user: null };
let coPilotValue: Record<string, unknown>;

jest.unstable_mockModule('@/components/RideshareCoach', () => ({
  default: (props: Record<string, unknown>) => { received.push(props); return <div data-testid="coach-stub">{String(props.userId)}</div>; },
}));
jest.unstable_mockModule('@/contexts/co-pilot-context', () => ({
  useCoPilot: () => coPilotValue,
}));
jest.unstable_mockModule('@/contexts/auth-context', () => ({ useAuth: () => authValue }));
const { default: CoachPage } = await import('@/pages/co-pilot/CoachPage');

describe('CoachPage identity', () => {
  beforeEach(() => {
    received.length = 0;
    receivedStatus.length = 0;
    localStorage.clear();
    authValue = { user: { userId: '11111111-1111-4111-8111-111111111111', email: 'a@example.test' }, sessionId: 'session-1' };
    coPilotValue = { lastSnapshotId: 'snap-1', contextSnapshotId: null, strategyData: null,
      immediateStrategy: null, snapshotData: null, blocks: [], criticalError: null };
  });
  afterEach(cleanup);

  it('renders nothing keyed while the user is unknown (no "default" or "" bucket)', () => {
    authValue = { user: null };
    localStorage.setItem('vecto_user_id', 'stale-legacy-id');
    render(<CoachPage />);
    expect(screen.getByTestId('coach-page-waiting-for-identity')).toBeTruthy();
    expect(received).toHaveLength(0);
    expect(receivedStatus).toHaveLength(0);
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

  it('gives both Coach surfaces the owned context before Strategy admission, including failed Briefing', () => {
    coPilotValue = { ...coPilotValue, lastSnapshotId: null, contextSnapshotId: 'current-context',
      criticalError: { type: 'briefing_failed', message: 'Events unavailable' } };
    render(<CoachPage />);
    expect(receivedStatus.at(-1)?.snapshotId).toBe('current-context');
    expect(received.at(-1)).toMatchObject({ snapshotId: 'current-context', strategyReady: false });
    expect(screen.getByRole('status').textContent).toContain('Some current data is unavailable');
  });

  it('keeps the admitted snapshot and its Strategy props when newer upstream context arrives', () => {
    const savedSnapshot = { snapshot_id: 'snap-1', city: 'Dallas', timezone: 'America/Chicago' };
    const savedBlocks = [{ name: 'Saved venue' }];
    coPilotValue = { ...coPilotValue, contextSnapshotId: 'new-context', strategyData: { strategyId: 'strategy-1' },
      immediateStrategy: 'Saved guidance', snapshotData: savedSnapshot, blocks: savedBlocks };
    render(<CoachPage />);
    expect(receivedStatus.at(-1)?.snapshotId).toBe('snap-1');
    expect(received.at(-1)).toMatchObject({ snapshotId: 'snap-1', strategyId: 'strategy-1',
      strategy: 'Saved guidance', snapshot: savedSnapshot, blocks: savedBlocks, strategyReady: true });
  });

  it('does not invent a snapshot when neither context nor admitted Strategy exists', () => {
    coPilotValue = { ...coPilotValue, lastSnapshotId: null };
    render(<CoachPage />);
    expect(receivedStatus.at(-1)?.snapshotId).toBeUndefined();
    expect(received.at(-1)?.snapshotId).toBeUndefined();
  });

  it('drops the old snapshot when the same account receives a reset session context', () => {
    coPilotValue = { ...coPilotValue, lastSnapshotId: null, contextSnapshotId: 'old-context' };
    const { rerender } = render(<CoachPage />);
    expect(received.at(-1)?.snapshotId).toBe('old-context');
    authValue = { ...authValue, sessionId: 'session-2' };
    coPilotValue = { ...coPilotValue, contextSnapshotId: null };
    rerender(<CoachPage />);
    expect(receivedStatus.at(-1)?.snapshotId).toBeUndefined();
    expect(received.at(-1)?.snapshotId).toBeUndefined();
    coPilotValue = { ...coPilotValue, contextSnapshotId: 'new-session-context' };
    rerender(<CoachPage />);
    expect(receivedStatus.at(-1)?.snapshotId).toBe('new-session-context');
    expect(received.at(-1)?.snapshotId).toBe('new-session-context');
  });

  it('unmounts both surfaces on logout and does not carry context into another account', () => {
    const { rerender } = render(<CoachPage />);
    authValue = { user: null };
    received.length = 0;
    receivedStatus.length = 0;
    rerender(<CoachPage />);
    expect(received).toHaveLength(0);
    expect(receivedStatus).toHaveLength(0);
    authValue = { user: { userId: '22222222-2222-4222-8222-222222222222', email: 'b@example.test' }, sessionId: 'other-session' };
    coPilotValue = { ...coPilotValue, lastSnapshotId: null, contextSnapshotId: null };
    rerender(<CoachPage />);
    expect(receivedStatus.at(-1)?.snapshotId).toBeUndefined();
    expect(received.at(-1)).toMatchObject({ userId: authValue.user?.userId, snapshotId: undefined });
  });
});
