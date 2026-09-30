import { useSyncExternalStore } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from '@/contexts/auth-context';
import { RunSetupProvider } from '@/contexts/run-setup-context';
import { LocationProvider } from '@/contexts/location-context-clean';
import { CoPilotProvider } from '@/contexts/co-pilot-context';
import ErrorBoundary from './components/ErrorBoundary';
import SafeScaffold from './pages/SafeScaffold';
import { router } from './routes';

import './index.css';

// 2026-09-13: the single app QueryClient lives in @/lib/queryClient (same defaults);
// a second module-scope client here meant apiRequest callers and the provider disagreed.

function App() {
  const pathname = useSyncExternalStore(
    router.subscribe,
    () => router.state.location.pathname,
    () => router.state.location.pathname,
  );
  // Public guests must never mount driver identity, snapshots, or briefing providers,
  // including when a signed-in driver opens their guest link in the same browser.
  if (pathname === '/c' || pathname.startsWith('/c/')) {
    return <ErrorBoundary fallback={<SafeScaffold />}><RouterProvider router={router} /></ErrorBoundary>;
  }
  return (
    <ErrorBoundary fallback={<SafeScaffold />}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RunSetupProvider>
          <LocationProvider>
            {/* CoPilotProvider wraps router so it persists across route changes */}
            <CoPilotProvider allowPartialCoach={pathname === '/co-pilot/coach'}>
              <RouterProvider router={router} />
            </CoPilotProvider>
          </LocationProvider>
          </RunSetupProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
