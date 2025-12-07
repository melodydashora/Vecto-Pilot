import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocationProvider } from '@/contexts/location-context-clean';
import { Toaster } from '@/components/ui/toaster';
import GlobalHeader from './components/GlobalHeader';
import ErrorBoundary from './components/ErrorBoundary';
import CoPilot from './pages/co-pilot';
import SafeScaffold from './pages/SafeScaffold';

import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000,
    },
  },
});

function App() {
  console.log('[App] Rendering App component');
  return (
    <ErrorBoundary fallback={<SafeScaffold />}>
      <QueryClientProvider client={queryClient}>
        <LocationProvider>
          <div className="App min-h-screen bg-gray-50">
            <GlobalHeader />

            <main className="main-content-with-header">
              <CoPilot />
            </main>

            <Toaster />
          </div>
        </LocationProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;