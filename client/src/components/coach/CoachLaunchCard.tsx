// 2026-04-25 (Phase A, Pass 1): Compact launcher for the Coach tab.
// Strategy used to mount the full coach surface here; that lifecycle
// now lives at /co-pilot/coach. This card stays small and never
// requests mic permission or mints Realtime tokens.

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MessageSquare, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function CoachLaunchCard() {
  const navigate = useNavigate();
  return (
    <Card className="p-4 my-4 border-blue-100 bg-blue-50/30" data-testid="coach-launch-card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-blue-600 shrink-0" />
          <div>
            <div className="font-semibold text-sm">Ask the Coach</div>
            <div className="text-xs text-gray-600">Strategy questions, venue advice, ride decisions</div>
          </div>
        </div>
        <Button
          size="sm"
          variant="default"
          onClick={() => navigate('/co-pilot/coach')}
          className="shrink-0"
          data-testid="coach-launch-open"
        >
          Open <ArrowRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </Card>
  );
}
