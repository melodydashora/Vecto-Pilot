import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Link, useLocation } from 'wouter';
import { LocationProvider } from '@/contexts/location-context-clean';
import { Toaster } from '@/components/ui/toaster';
import GlobalHeader from './components/GlobalHeader';
import ErrorBoundary from './components/ErrorBoundary';
import CoPilot from './pages/co-pilot';
import BriefingPage from './pages/BriefingPage';

import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000,
    },
  },
});

function NavigationTabs() {
  const [location] = useLocation();
  
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
            Copilot
          </Link>
          <Link
            href="/briefing"
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              location === '/briefing'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            data-testid="tab-briefing"
          >
            Briefing
          </Link>
        </nav>
      </div>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <LocationProvider>
          <div className="App min-h-screen bg-gray-50">
            <GlobalHeader />
            <NavigationTabs />
            
            <main className="main-content-with-header">
              <Switch>
                <Route path="/briefing" component={BriefingPage} />
                <Route path="/:rest*" component={CoPilot} />
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
