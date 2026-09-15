import { useSyncExternalStore } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from '@/contexts/auth-context';
import { LocationProvider } from '@/contexts/location-context-clean';
import { CoPilotProvider } from '@/contexts/co-pilot-context';
import ErrorBoundary from './components/ErrorBoundary';
import SafeScaffold from './pages/SafeScaffold';
import { router } from './routes';

import './index.css';

// QueryClient at module scope - singleton pattern
// Ensures cache persists across renders and app switches
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000, // Keep data in cache for 30 min
      refetchOnWindowFocus: false, // Don't refetch when switching back from the rideshare app
    },
  },
});

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
          <LocationProvider>
            {/* CoPilotProvider wraps router so it persists across route changes */}
            <CoPilotProvider allowPartialCoach={pathname === '/co-pilot/coach'}>
              <RouterProvider router={router} />
            </CoPilotProvider>
          </LocationProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
