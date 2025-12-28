import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
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
      refetchOnWindowFocus: false, // Don't refetch when switching back from Uber app
    },
  },
});

function App() {
  console.log('[App] Rendering App component with React Router');
  return (
    <ErrorBoundary fallback={<SafeScaffold />}>
      <QueryClientProvider client={queryClient}>
        <LocationProvider>
          {/* CoPilotProvider wraps router so it persists across route changes */}
          <CoPilotProvider>
            <RouterProvider router={router} />
          </CoPilotProvider>
        </LocationProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
