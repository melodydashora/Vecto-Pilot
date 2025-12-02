import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Link, useLocation as useWouterLocation } from 'wouter';
import { LocationProvider } from '@/contexts/location-context-clean';
import { Toaster } from '@/components/ui/toaster';
import GlobalHeader from './components/GlobalHeader';
import ErrorBoundary from './components/ErrorBoundary';
import CoPilot from './pages/co-pilot';
import MapPage from './pages/map-page';
import SafeScaffold from './pages/SafeScaffold';

import './index.css';

// Feature flag to hide navigation during stabilization
const FF_HIDE_NAV = import.meta.env.VITE_FF_HIDE_NAV === 'true';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000,
    },
  },
});

function NavigationTabs() {
  const [location] = useWouterLocation();
  
  // Hide navigation if feature flag is enabled
  if (FF_HIDE_NAV) {
    return null;
  }
  
  return (
    <div className="border-b border-gray-200 bg-white">
      <div className="max-w-7xl mx-auto px-4">
        <nav className="flex space-x-8" aria-label="Tabs">
          <Link
            href="/"
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              location === '/'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            data-testid="tab-copilot"
          >
            Co-Pilot
          </Link>
          <Link
            href="/map"
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              location === '/map'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            data-testid="tab-map"
          >
            Map
          </Link>
        </nav>
      </div>
    </div>
  );
}

function App() {
  console.log('[App] Rendering App component');
  return (
    <ErrorBoundary fallback={<SafeScaffold />}>
      <QueryClientProvider client={queryClient}>
        <LocationProvider>
          <div className="App min-h-screen bg-gray-50">
            <GlobalHeader />
            <NavigationTabs />
            
            <main className="main-content-with-header">
              <Switch>
                <Route path="/" component={CoPilot} />
                <Route path="/map" component={MapPage} />
              </Switch>
            </main>

            <Toaster />
          </div>
        </LocationProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
