// client/src/components/RouteErrorBoundary.tsx
// 2026-08-21: Route-level error boundary for the data router.
// Until now no route defined errorElement, so any render/effect throw under a
// route match fell through to react-router's built-in default boundary — the
// unbranded "Unexpected Application Error" screen that white-screened the whole
// co-pilot page when a Google Maps marker constructor threw. Mounted via
// errorElement in routes.tsx. When attached to a child route it renders inside
// CoPilotLayout's <Outlet />, so the bottom nav stays alive and the driver can
// switch tabs instead of losing the entire app.

import { useEffect } from 'react';
import { useRouteError, isRouteErrorResponse, Link } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Button } from './ui/button';

// Same defensive-snapshot idiom as ErrorBoundary.componentDidCatch: Error.message
// and .stack are non-enumerable, so a bare console.error(error) can print {} in
// production logs. Force-include them.
function snapshotError(err: unknown): string {
  try {
    if (err == null) return String(err);
    if (err instanceof Error) return JSON.stringify(err, Object.getOwnPropertyNames(err));
    return JSON.stringify(err);
  } catch (snapErr) {
    return `(snapshot failed: ${String(snapErr)})`;
  }
}

const RouteErrorBoundary: React.FC = () => {
  const error = useRouteError();

  useEffect(() => {
    console.error('[RouteErrorBoundary] caught:', {
      type: typeof error,
      ctor: error == null ? null : (error as { constructor?: { name?: string } })?.constructor?.name ?? null,
      message: (error as { message?: unknown })?.message,
      stack: (error as { stack?: unknown })?.stack,
      snapshot: snapshotError(error),
      rawValue: error,
    });
  }, [error]);

  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error);

  return (
    <div className="flex items-center justify-center p-4 py-12">
      <div className="max-w-md w-full">
        <Alert variant="destructive">
          <AlertTitle>This page hit an error</AlertTitle>
          <AlertDescription className="mt-2">
            The rest of the app is still running — you can retry or head back to Strategy.
          </AlertDescription>
        </Alert>

        <div className="mt-4 space-y-2">
          <Button onClick={() => window.location.reload()} className="w-full">
            Try Again
          </Button>
          <Button variant="outline" asChild className="w-full">
            <Link to="/co-pilot/strategy">Back to Strategy</Link>
          </Button>
        </div>

        {import.meta.env.DEV && (
          <details className="mt-4 p-2 bg-gray-100 rounded text-xs">
            <summary className="cursor-pointer font-medium">Error Details</summary>
            <pre className="mt-2 whitespace-pre-wrap">
              {detail}
              {error instanceof Error && error.stack ? `\n\n${error.stack}` : ''}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
};

export default RouteErrorBoundary;
