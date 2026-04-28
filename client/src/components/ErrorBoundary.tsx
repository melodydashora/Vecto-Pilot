import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Button } from './ui/button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // 2026-04-27: Verbose, defensive logging. The previous one-line console.error
    // produced empty {} in production logs whenever the thrown value wasn't an
    // Error instance, because Chrome's console formatter only surfaces enumerable
    // own properties — and Error.message / Error.stack are NON-enumerable, plus
    // non-Error throws (bare objects, undefined, Promises from Suspense) have no
    // useful own properties at all. The fix: probe shape, JSON-snapshot the value
    // forcing inclusion of non-enumerable props, and log structured fields a log
    // aggregator can search.
    const err = error as unknown;
    let snapshot: string;
    try {
      if (err == null) {
        snapshot = String(err); // 'null' or 'undefined'
      } else if (err instanceof Error) {
        // Force include non-enumerable .message and .stack
        snapshot = JSON.stringify(err, Object.getOwnPropertyNames(err));
      } else {
        snapshot = JSON.stringify(err);
      }
    } catch (snapErr) {
      snapshot = `(snapshot failed: ${String(snapErr)})`;
    }

    const diagnostic = {
      type: typeof err,
      ctor: err == null
        ? null
        : (err as { constructor?: { name?: string } })?.constructor?.name ?? null,
      message: (err as { message?: unknown })?.message,
      stack: (err as { stack?: unknown })?.stack,
      componentStack: errorInfo?.componentStack,
      snapshot,
      rawValue: err, // for Chrome DevTools' inspectable display
    };

    console.error('[ErrorBoundary] caught:', diagnostic);

    this.setState({
      error,
      errorInfo
    });

    // Log to external service in production
    if (import.meta.env.PROD) {
      // TODO: Send to error tracking service
      console.error('[ErrorBoundary] PROD error:', diagnostic);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="max-w-md w-full">
            <Alert variant="destructive">
              <AlertTitle>Something went wrong</AlertTitle>
              <AlertDescription className="mt-2">
                We apologize for the inconvenience. The application has encountered an error.
              </AlertDescription>
            </Alert>

            <div className="mt-4 space-y-2">
              <Button onClick={this.handleReset} className="w-full">
                Try Again
              </Button>
              <Button 
                variant="outline" 
                onClick={() => window.location.reload()} 
                className="w-full"
              >
                Reload Page
              </Button>
            </div>

            {import.meta.env.DEV && this.state.error && (
              <details className="mt-4 p-2 bg-gray-100 rounded text-xs">
                <summary className="cursor-pointer font-medium">Error Details</summary>
                <pre className="mt-2 whitespace-pre-wrap">
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;