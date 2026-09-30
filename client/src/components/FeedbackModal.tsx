import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import type { VenueFeedbackReceipt } from '@/hooks/useVenueFeedback';
import { useToast } from '@/hooks/useToast';
import { API_ROUTES } from '@/constants/apiRoutes';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialSentiment?: 'up' | 'down' | null;
  venueName?: string;
  placeId?: string;
  snapshotId?: string;
  rankingId?: string;
  userId?: string;
  isStrategyFeedback?: boolean;
  isAppFeedback?: boolean;
  onSuccess?: (sentiment: 'up' | 'down') => void;
  onVenueSubmit?: (sentiment: 'up' | 'down', comment: string) => Promise<VenueFeedbackReceipt | null>;
  onVenueReload?: () => Promise<boolean | undefined>;
}

export function FeedbackModal({
  isOpen,
  onClose,
  initialSentiment = null,
  venueName = '',
  placeId,
  snapshotId,
  rankingId,
  userId: _userId,
  isStrategyFeedback = false,
  isAppFeedback = false,
  onSuccess,
  onVenueSubmit,
  onVenueReload
}: FeedbackModalProps) {
  const [sentiment, setSentiment] = useState<'up' | 'down' | null>(initialSentiment);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user, token } = useAuth();
  const scopeKey = JSON.stringify([user?.userId, token, snapshotId, rankingId, placeId, isOpen]);
  const scopeRef = useRef({ key: scopeKey, active: true, busy: false });
  if (scopeRef.current.key !== scopeKey) {
    scopeRef.current.active = false;
    scopeRef.current = { key: scopeKey, active: true, busy: false };
  }
  const { toast } = useToast();

  // Sync sentiment state when modal opens or initialSentiment changes
  useEffect(() => {
    if (isOpen) {
      setSentiment(initialSentiment);
      setComment('');
      setIsSubmitting(false);
      setError(null);
    }
  }, [isOpen, initialSentiment, scopeKey]);

  useEffect(() => {
    const scope = scopeRef.current;
    scope.active = true;
    return () => { scope.active = false; };
  }, [scopeKey]);

  // Reset state when modal closes
  const handleClose = () => {
    if (scopeRef.current.busy) return;
    setSentiment(null);
    setComment('');
    onClose();
  };

  const handleSubmit = async () => {
    if (!sentiment) {
      toast({
        title: 'Select thumbs up or down',
        description: 'Please select whether you liked or disliked this.',
        variant: 'destructive',
      });
      return;
    }

    const scope = scopeRef.current;
    if (scope.busy) return;
    const current = () => scope.active && scopeRef.current === scope;

    // App feedback doesn't require ranking data.
    if (!isAppFeedback && (!snapshotId || !rankingId)) {
      toast({
        title: 'No strategy loaded yet',
        description: 'Please wait for a strategy to load before giving feedback.',
        variant: 'default',
      });
      return;
    }
    if (!token || !user?.userId) { setError('Please sign in before sending feedback.'); return; }
    scope.busy = true;
    setIsSubmitting(true);
    setError(null);

    const endpoint = isAppFeedback
      ? API_ROUTES.FEEDBACK.APP
      : (isStrategyFeedback ? API_ROUTES.FEEDBACK.STRATEGY : API_ROUTES.FEEDBACK.VENUE);
    try {
      let receipt: VenueFeedbackReceipt | null = null;
      if (!isAppFeedback && !isStrategyFeedback) {
        if (!onVenueSubmit) throw new Error('Venue feedback is unavailable. Reload the strategy and retry.');
        receipt = await onVenueSubmit(sentiment, comment.trim());
        if (!current() || !receipt) return;
      } else {
        const response = await fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ snapshot_id: snapshotId || null, ...(isStrategyFeedback && { ranking_id: rankingId }), sentiment, comment: comment.trim() || null }),
        });
        if (!current()) return;
        if (!response.ok) throw new Error(response.status === 429 ? 'Too many requests. Wait a moment, then retry.' : 'Feedback was not confirmed. Please retry.');
        const result = await response.json();
        if (!current()) return;
        if (result?.ok !== true) throw new Error('The server did not confirm your feedback. Please retry.');
      }
      onSuccess?.(sentiment);
      setComment('');
      onClose();
      toast({ title: receipt?.action === 'dismiss' ? 'Venue removed from this strategy' : 'Feedback saved',
        description: receipt?.replacement_status === 'replaced' ? `${receipt.replacement?.name} is now in your list. You can undo this choice.`
          : receipt?.replacement_status === 'exhausted' ? 'No alternative is available in this strategy. You can undo this choice.' : 'Thanks for sharing your feedback.' });
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : 'Feedback was not confirmed. Please retry.');
    } finally {
      scope.busy = false;
      if (current()) setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md" data-testid="feedback-modal">
        <DialogHeader>
          <DialogTitle>
            {initialSentiment 
              ? 'Add Your Feedback' 
              : isAppFeedback
                ? 'App Feedback'
                : isStrategyFeedback 
                  ? 'Strategy Feedback' 
                  : `Feedback for ${venueName}`}
          </DialogTitle>
          <DialogDescription>
            {initialSentiment
              ? `You selected ${initialSentiment === 'up' ? '👍 thumbs up' : '👎 thumbs down'}. Add optional comments below.`
              : isAppFeedback
                ? 'How is your experience with Vecto Pilot?'
                : isStrategyFeedback 
                  ? 'Was this strategy helpful for your driving session?'
                  : 'How was your experience at this venue?'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!isAppFeedback && !isStrategyFeedback && sentiment === 'down' && (
            <p className="text-sm text-gray-600">Remove this venue from your current strategy and show an available alternative. You can undo after it saves.</p>
          )}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {error && !isAppFeedback && !isStrategyFeedback && onVenueReload && (
            <Button variant="outline" size="sm" disabled={isSubmitting} onClick={async () => {
              const scope = scopeRef.current;
              if (scope.busy) return;
              scope.busy = true; setIsSubmitting(true);
              try {
                const loaded = await onVenueReload();
                if (scope.active && scopeRef.current === scope && loaded) setError(null);
              } finally {
                scope.busy = false;
                if (scope.active && scopeRef.current === scope) setIsSubmitting(false);
              }
            }}>Reload saved choices</Button>
          )}
          {/* Sentiment Buttons - Only show if no initial sentiment */}
          {!initialSentiment && (
            <div className="flex items-center justify-center gap-4">
              <Button
                type="button"
                variant={sentiment === 'up' ? 'default' : 'outline'}
                size="lg"
                onClick={() => setSentiment('up')}
                disabled={isSubmitting}
                className={sentiment === 'up' ? 'bg-green-600 hover:bg-green-700' : ''}
                data-testid="button-thumbs-up"
              >
                <ThumbsUp className="w-5 h-5 mr-2" />
                Thumbs Up
              </Button>
              <Button
                type="button"
                variant={sentiment === 'down' ? 'default' : 'outline'}
                size="lg"
                onClick={() => setSentiment('down')}
                disabled={isSubmitting}
                className={sentiment === 'down' ? 'bg-red-600 hover:bg-red-700' : ''}
                data-testid="button-thumbs-down"
              >
                <ThumbsDown className="w-5 h-5 mr-2" />
                Thumbs Down
              </Button>
            </div>
          )}

          {/* Optional Comment */}
          <div>
            <label htmlFor="feedback-comment" className="text-sm font-medium text-gray-700 mb-1 block">
              Additional comments (optional)
            </label>
            <Textarea
              id="feedback-comment"
              placeholder="Share more details about your experience..."
              value={comment}
              disabled={isSubmitting}
              onChange={(e) => setComment(e.target.value.slice(0, 1000))}
              rows={3}
              maxLength={1000}
              data-testid="input-feedback-comment"
            />
            <p className="text-xs text-gray-500 mt-1">{comment.length}/1000 characters</p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
            data-testid="button-cancel-feedback"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!sentiment || isSubmitting}
            data-testid="button-submit-feedback"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
