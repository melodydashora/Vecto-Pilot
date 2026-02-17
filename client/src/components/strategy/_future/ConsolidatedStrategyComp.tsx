
import { useStrategy } from '../../hooks/useStrategy';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Sparkles, Brain, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';

export function ConsolidatedStrategyComp({ snapshotId }: { snapshotId?: string }) {
  const { data, loading } = useStrategy(snapshotId);

  if (!snapshotId || loading) {
    return null; // Don't show coach until data is ready
  }

  const min = data?.strategy?.min;
  const consolidated = data?.strategy?.consolidated;
  const status = data?.status;
  const isPartial = status === 'ok_partial';

  if (!min && !consolidated) {
    return (
      <Card className="bg-gradient-to-br from-gray-50 to-gray-100 border-gray-300" data-testid="strategy-coach-empty">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-gray-400" />
            <p className="text-sm text-gray-600">Strategy coach will appear once analysis is ready.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 border-purple-300" data-testid="strategy-coach-card">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-purple-100">
            <Sparkles className="w-5 h-5 text-purple-600" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-semibold text-sm text-purple-900">AI Coach</h3>
              <Badge variant="outline" className="text-xs border-purple-300 text-purple-700 bg-white">
                {isPartial ? 'Partial Analysis' : 'Live Analysis'}
              </Badge>
            </div>
            
            {isPartial && (
              <Alert className="mb-3 bg-yellow-50 border-yellow-300" data-testid="partial-strategy-warning">
                <AlertCircle className="h-4 w-4 text-yellow-600" />
                <AlertTitle className="text-yellow-900 text-sm font-semibold">Partial Strategy</AlertTitle>
                <AlertDescription className="text-yellow-800 text-xs">
                  Showing synthesized plan from tactical analysis and market intelligence. All data is current.
                </AlertDescription>
              </Alert>
            )}
            
            <CoachBody min={min} consolidated={consolidated} />
            {data?.strategy?.holiday && (
              <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
                <strong>Holiday Alert:</strong> {data.strategy.holiday.name || 'Special event detected'}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CoachBody({ min, consolidated }: { min?: string; consolidated?: string }) {
  // Prefer consolidated strategy (final output from AI consolidator)
  const text = consolidated || min || '';
  
  if (!text) {
    return <p className="text-sm text-gray-500">Analyzing...</p>;
  }

  // If it looks like JSON, parse and display nicely
  if (text.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      return <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans">{JSON.stringify(parsed, null, 2)}</pre>;
    } catch {
      // Fall through to plain text
    }
  }

  return (
    <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap" data-testid="strategy-coach-text">
      {text}
    </p>
  );
}
