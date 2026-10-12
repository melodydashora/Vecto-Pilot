import React from 'react';
import { Check, Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { useStrategyLoadingMessages } from '@/hooks/useStrategyLoadingMessages';

interface StrategyPreparationStatusProps {
  phase: 'preparing' | 'starting' | 'generating' | 'ready';
  progress: number;
  messages: ReturnType<typeof useStrategyLoadingMessages>;
}

/** Display only: location preparation and explicit Strategy admission stay separate. */
export function StrategyPreparationStatus({ phase, progress, messages }: StrategyPreparationStatusProps) {
  const ready = phase === 'ready';
  const generating = phase === 'generating';
  const title = ready ? 'Ready for your Strategy'
    : phase === 'preparing' ? 'Preparing location and Briefing'
      : phase === 'starting' ? 'Starting your Strategy' : 'Generating your Strategy';
  const description = ready ? 'Your location, Briefing and saved preferences are ready. Start whenever you are ready.'
    : phase === 'preparing' ? 'Gathering the context for your Strategy. You can review your preferences while this finishes.'
      : phase === 'starting' ? 'Confirming your saved preferences and prepared context.'
        : `${messages.icon} ${messages.text}`;
  const displayedProgress = Math.min(100, Math.max(0, progress));

  return (
    <Card className="mb-6 overflow-hidden border-primary/25 bg-gradient-to-br from-primary/10 via-background to-primary/5 shadow-md"
      data-testid={generating ? 'strategy-pending-card' : ready ? 'strategy-ready-status' : 'strategy-preparation-status'}>
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center" aria-hidden="true">
            {!ready && <span className="absolute inset-0 rounded-full border-2 border-primary/20 border-t-primary motion-safe:animate-spin" />}
            <span className={`flex h-9 w-9 items-center justify-center rounded-full ${ready ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'}`}>
              {ready ? <Check className="h-5 w-5" /> : <Sparkles className="h-5 w-5 motion-safe:animate-pulse" />}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div role="status" aria-live="polite" aria-atomic="true">
              <p className="font-semibold text-foreground">{title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </div>
            {!ready && (
              <div className="mt-4 space-y-2">
                <div role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100}
                  {...(generating ? { 'aria-valuenow': displayedProgress } : {})}
                  className="h-2 overflow-hidden rounded-full bg-primary/15">
                  <div className={`h-full rounded-full bg-primary ${generating ? 'transition-all duration-500 motion-reduce:transition-none' : 'w-1/3 motion-safe:animate-pulse'}`}
                    style={generating ? { width: `${displayedProgress}%` } : undefined} />
                </div>
                {generating && <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{messages.step}</span><span>{messages.timeRemaining || `${displayedProgress}%`}</span>
                </div>}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
