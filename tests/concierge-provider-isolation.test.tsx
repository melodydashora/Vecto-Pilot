import { jest, test, expect } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react';

const mounts = { auth: jest.fn(), location: jest.fn(), copilot: jest.fn() };
const router = { subscribe: () => () => {}, state: { location: { pathname: '/c/c1.anonymous.bookmark' } } };
jest.unstable_mockModule('../client/src/routes', () => ({ router }));
jest.unstable_mockModule('react-router-dom', () => ({ RouterProvider: () => <div>Anonymous guest route</div> }));
for (const [path, name, spy] of [
  ['../client/src/contexts/auth-context', 'AuthProvider', mounts.auth],
  ['../client/src/contexts/location-context-clean', 'LocationProvider', mounts.location],
  ['../client/src/contexts/co-pilot-context', 'CoPilotProvider', mounts.copilot],
] as const) {
  jest.unstable_mockModule(path, () => ({ [name]: ({ children }: { children: React.ReactNode }) => { spy(); return children; } }));
}
jest.unstable_mockModule('../client/src/components/ErrorBoundary', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
jest.unstable_mockModule('../client/src/pages/SafeScaffold', () => ({ default: () => <div>Error</div> }));
jest.unstable_mockModule('../client/src/index.css', () => ({}));
const { default: App } = await import('../client/src/App');

test('a bookmarked guest route never mounts driver identity, GPS snapshot, or briefing providers', () => {
  localStorage.setItem('auth_token', 'existing-driver-session');
  render(<App />);
  expect(screen.getByText('Anonymous guest route')).toBeInTheDocument();
  expect(mounts.auth).not.toHaveBeenCalled();
  expect(mounts.location).not.toHaveBeenCalled();
  expect(mounts.copilot).not.toHaveBeenCalled();
  localStorage.removeItem('auth_token');
});
