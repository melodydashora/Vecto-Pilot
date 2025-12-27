import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { LocationProvider } from '@/contexts/location-context-clean';
import ErrorBoundary from './components/ErrorBoundary';
import SafeScaffold from './pages/SafeScaffold';
import { router } from './routes';

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
  console.log('[App] Rendering App component with React Router');
  return (
    <ErrorBoundary fallback={<SafeScaffold />}>
      <QueryClientProvider client={queryClient}>
        <LocationProvider>
          <RouterProvider router={router} />
        </LocationProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
