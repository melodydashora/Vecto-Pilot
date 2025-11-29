import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Link, useLocation } from 'wouter';
import { LocationProvider } from '@/contexts/location-context-clean';
import { Toaster } from '@/components/ui/toaster';
import GlobalHeader from './components/GlobalHeader';
import ErrorBoundary from './components/ErrorBoundary';
import CoPilot from './pages/co-pilot';
import BriefingPage from './pages/BriefingPage';
import VenuePage from './pages/VenuePage';
import SafeScaffold from './pages/SafeScaffold';
import { FileText, Navigation, Wine } from 'lucide-react';

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

function BottomNavigation() {
  const [location] = useLocation();
  
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 safe-area-bottom">
      <div className="max-w-2xl mx-auto">
        <nav className="flex" aria-label="Bottom Navigation">
          <Link
            href="/"
            className={`flex-1 flex flex-col items-center py-3 px-2 transition-colors ${
              location === '/'
                ? 'text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            data-testid="nav-copilot"
          >
            <Navigation className={`h-5 w-5 ${location === '/' ? 'fill-blue-100' : ''}`} />
            <span className="text-xs mt-1 font-medium">Copilot</span>
          </Link>
          <Link
            href="/briefing"
            className={`flex-1 flex flex-col items-center py-3 px-2 transition-colors ${
              location === '/briefing'
                ? 'text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            data-testid="nav-briefing"
          >
            <FileText className={`h-5 w-5 ${location === '/briefing' ? 'fill-blue-100' : ''}`} />
            <span className="text-xs mt-1 font-medium">Briefing</span>
          </Link>
          <Link
            href="/venues"
            className={`flex-1 flex flex-col items-center py-3 px-2 transition-colors ${
              location === '/venues'
                ? 'text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            data-testid="nav-venues"
          >
            <Wine className={`h-5 w-5 ${location === '/venues' ? 'fill-blue-100' : ''}`} />
            <span className="text-xs mt-1 font-medium">Venues</span>
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
            
            <main className="main-content-with-header pb-16">
              <Switch>
                <Route path="/" component={CoPilot} />
                <Route path="/briefing" component={BriefingPage} />
                <Route path="/venues" component={VenuePage} />
                <Route>
                  <CoPilot />
                </Route>
              </Switch>
            </main>

            <BottomNavigation />
            <Toaster />
          </div>
        </LocationProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
