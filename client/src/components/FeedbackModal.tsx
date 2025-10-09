import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

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
  onSuccess?: (sentiment: 'up' | 'down') => void;
}

export function FeedbackModal({
  isOpen,
  onClose,
  initialSentiment = null,
  venueName = '',
  placeId,
  snapshotId,
  rankingId,
  userId,
  isStrategyFeedback = false,
  onSuccess
}: FeedbackModalProps) {
  const [sentiment, setSentiment] = useState<'up' | 'down' | null>(initialSentiment);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  // Reset state when modal closes or when initialSentiment changes
  const handleClose = () => {
    setSentiment(initialSentiment);
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

    if (!snapshotId || !rankingId) {
      toast({
        title: 'No strategy loaded yet',
        description: 'Please wait for a strategy to load before giving feedback.',
        variant: 'default',
      });
      onClose(); // Close the modal
      return;
    }

    setIsSubmitting(true);

    const endpoint = isStrategyFeedback ? '/api/feedback/strategy' : '/api/feedback/venue';
    
    const payload = isStrategyFeedback 
      ? {
          userId,
          snapshot_id: snapshotId,
          ranking_id: rankingId,
          sentiment,
          comment: comment.trim() || null,
        }
      : {
          userId,
          snapshot_id: snapshotId,
          ranking_id: rankingId,
          place_id: placeId || null,
          venue_name: venueName,
          sentiment,
          comment: comment.trim() || null,
        };

    // Close modal immediately for better UX
    onSuccess?.(sentiment);
    setSentiment(initialSentiment);
    setComment('');
    onClose();

    // Submit feedback in background
    toast({
      title: 'Thanks for the feedback!',
      description: 'Your feedback helps us improve recommendations.',
    });

    apiRequest('POST', endpoint, payload)
      .catch((error: any) => {
        console.error('Feedback submission error:', error);
        
        if (error.message?.includes('429')) {
          toast({
            title: 'Too many requests',
            description: 'Please wait a moment before submitting more feedback.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Failed to submit feedback',
            description: 'Please try again later.',
            variant: 'destructive',
          });
        }
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md" data-testid="feedback-modal">
        <DialogHeader>
          <DialogTitle>
            {initialSentiment 
              ? 'Add Your Feedback' 
              : isStrategyFeedback 
                ? 'Strategy Feedback' 
                : `Feedback for ${venueName}`}
          </DialogTitle>
          <DialogDescription>
            {initialSentiment
              ? `You selected ${initialSentiment === 'up' ? '👍 thumbs up' : '👎 thumbs down'}. Add optional comments below.`
              : isStrategyFeedback 
                ? 'Was this strategy helpful for your driving session?'
                : 'How was your experience at this venue?'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Sentiment Buttons - Only show if no initial sentiment */}
          {!initialSentiment && (
            <div className="flex items-center justify-center gap-4">
              <Button
                type="button"
                variant={sentiment === 'up' ? 'default' : 'outline'}
                size="lg"
                onClick={() => setSentiment('up')}
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
