import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, Clock, AlertCircle, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

type StrategyAttempt = {
  snapshot_id: string;
  status: 'pending' | 'complete' | 'failed' | 'write_failed';
  created_at: string;
  updated_at: string;
};

interface StrategyHistoryPanelProps {
  userId: string;
  currentSnapshotId: string | null;
}

const statusConfig = {
  pending: {
    icon: Clock,
    label: 'Generating',
    variant: 'secondary' as const,
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
  },
  complete: {
    icon: CheckCircle2,
    label: 'Complete',
    variant: 'success' as const,
    className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
  },
  failed: {
    icon: AlertCircle,
    label: 'Failed',
    variant: 'destructive' as const,
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
  },
  write_failed: {
    icon: AlertTriangle,
    label: 'Write Failed',
    variant: 'warning' as const,
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
  }
};

export function StrategyHistoryPanel({ userId, currentSnapshotId }: StrategyHistoryPanelProps) {
  const { data, isLoading } = useQuery<{ ok: boolean; attempts: StrategyAttempt[] }>({
    queryKey: ['/api/strategy/history', userId],
    enabled: !!userId,
    refetchInterval: 5000, // Refresh every 5 seconds to show new attempts
  });

  if (isLoading) {
    return (
      <Card data-testid="card-history-loading">
        <CardHeader>
          <CardTitle className="text-lg">Strategy History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8 text-muted-foreground" data-testid="text-loading">
            <Clock className="w-4 h-4 mr-2 animate-spin" />
            Loading history...
          </div>
        </CardContent>
      </Card>
    );
  }

  const attempts = data?.attempts || [];

  if (attempts.length === 0) {
    return (
      <Card data-testid="card-history-empty">
        <CardHeader>
          <CardTitle className="text-lg">Strategy History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground" data-testid="text-no-history">
            No strategy attempts yet
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-history">
      <CardHeader>
        <CardTitle className="text-lg">Strategy History</CardTitle>
        <p className="text-sm text-muted-foreground">
          {attempts.length} {attempts.length === 1 ? 'attempt' : 'attempts'}
        </p>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-3">
            {attempts.map((attempt, index) => {
              const config = statusConfig[attempt.status];
              const Icon = config.icon;
              const isCurrent = attempt.snapshot_id === currentSnapshotId;
              const timestamp = new Date(attempt.created_at);
              const timeStr = timestamp.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit',
                hour12: true 
              });
              const dateStr = timestamp.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
              });

              return (
                <div
                  key={attempt.snapshot_id}
                  data-testid={`item-history-${index}`}
                  className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                    isCurrent 
                      ? 'border-primary bg-primary/5' 
                      : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    <Icon className="w-5 h-5" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge 
                        variant={config.variant}
                        className={config.className}
                        data-testid={`badge-status-${attempt.status}`}
                      >
                        {config.label}
                      </Badge>
                      {isCurrent && (
                        <Badge variant="outline" className="text-xs" data-testid="badge-current">
                          Current
                        </Badge>
                      )}
                    </div>
                    
                    <div className="text-sm text-muted-foreground">
                      <span data-testid={`text-time-${index}`}>{dateStr} at {timeStr}</span>
                    </div>
                    
                    <div className="text-xs text-muted-foreground mt-1 font-mono truncate">
                      {attempt.snapshot_id.slice(0, 8)}...
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
