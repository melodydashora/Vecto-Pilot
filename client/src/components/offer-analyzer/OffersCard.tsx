// September 10, 2026: compact outcome editors and complete-period decision counts.
// September 11, 2026: scope editors and list requests to the signed-in driver.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { subscribeOfferAnalyzed } from '@/utils/co-pilot-helpers';
import { useAuth } from '@/contexts/auth-context';
import { API_ROUTES, QUERY_KEYS } from '@/constants/apiRoutes';
import { History, Loader2 } from 'lucide-react';
import OfferRow, { type AnalyzedOffer } from './OfferOutcomeRow';
import OffersDecisionChart from './OffersDecisionChart';
const OFFERS_LIMIT = 25;
interface OffersResponse { success: true; offers: AnalyzedOffer[]; }
export default function OffersCard() {
  const { user, token, isAuthenticated, isLoading } = useAuth();
  if (!user?.userId || !token || !isAuthenticated || isLoading) return null;
  // A new driver must never inherit mounted editors or an in-flight save.
  return <DriverOffersCard key={user.userId} userId={user.userId} token={token} />;
}

function DriverOffersCard({ userId, token }: { userId: string; token: string }) {
  const queryClient = useQueryClient();
  const offersQueryKey = useMemo(() => [...QUERY_KEYS.OFFER_ANALYZER_OFFERS(OFFERS_LIMIT), userId], [userId]);
  const { data, isLoading, error, refetch } = useQuery<OffersResponse>({
    queryKey: offersQueryKey,
    // Capture this driver's token and consume Query cancellation on unmount/logout.
    queryFn: async ({ signal }) => {
      const res = await fetch(API_ROUTES.OFFER_ANALYZER.OFFERS(OFFERS_LIMIT), {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        signal,
      });
      if (!res.ok) throw new Error(`Failed to load offers (${res.status})`);
      const result = await res.json();
      if (result?.success !== true || !Array.isArray(result.offers)) throw new Error('The server did not return your offer list.');
      return result;
    },
    staleTime: 30 * 1000,
    // 2026-08-17 (race/SSE review finding #2): the headline flow runs the Shortcut
    // FROM the rideshare app — this tab is backgrounded, iOS drops the EventSource, and
    // the offer_analyzed event fires while it is down. Coming back must refresh:
    // window focus (when stale) + the server's `state` handshake on SSE reconnect
    // (below). Was `false`, which left the card stale until a manual Refresh.
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  // Live refresh when the Shortcut sends a new offer through the analyzer — and on
  // every SSE (re)connect, when the server sends a `state` handshake naming the
  // newest stored offer (skipped when the card already shows it). The handshake joins
  // an in-flight fetch (cancelRefetch:false — mount + handshake overlap); a REAL
  // offer_analyzed event keeps the default cancel-and-restart so the response is
  // guaranteed to be read after the row committed.
  useEffect(() => {
    const unsubscribe = subscribeOfferAnalyzed((event) => {
      if (event?.handshake) {
        const cached = queryClient.getQueryData<OffersResponse>(offersQueryKey);
        if (event.offer_id && cached?.offers?.some((o) => o.id === event.offer_id)) return;
        refetch({ cancelRefetch: false });
        return;
      }
      refetch();
    });
    return unsubscribe;
  }, [refetch, queryClient, offersQueryKey]);

  const [savedCount, setSavedCount] = useState(0);
  const [draftOffers, setDraftOffers] = useState<Map<string, AnalyzedOffer>>(() => new Map());
  const trackDraft = useCallback((offer: AnalyzedOffer, dirty: boolean) => {
    setDraftOffers(current => {
      if (dirty && current.get(offer.id) === offer) return current;
      if (!dirty && !current.has(offer.id)) return current;
      const next = new Map(current);
      if (dirty) next.set(offer.id, offer); else next.delete(offer.id);
      return next;
    });
  }, []);
  const offers = data?.offers ?? [];
  const recentIds = new Set(offers.map(offer => offer.id));
  const retainedDrafts = [...draftOffers.values()].filter(offer => !recentIds.has(offer.id));
  const visibleOffers = [...offers, ...retainedDrafts];
  return (
    <Card className="bg-white border-gray-200 shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <History className="h-5 w-5 text-indigo-500" />
          Recent Offers
        </CardTitle>
        <CardDescription>What we recommended vs. what you did</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <OffersDecisionChart refreshToken={`${offers.map(offer => `${offer.id}:${offer.outcome_revision ?? 0}`).join(',')}:${savedCount}`} />
        <p className="text-xs text-gray-500">Latest {OFFERS_LIMIT} offers across all dates. Saved outcomes stay compact; choose Edit to change one.</p>
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
          </div>
        )}

        {!isLoading && error != null && (
          <div className="flex items-center justify-between gap-2">
            <p role="alert" className="text-sm text-gray-500">{data
              ? 'Could not refresh your offers. Your list and open drafts are still here.'
              : 'Could not load your offers.'}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        )}

        {(data || visibleOffers.length > 0) && (
          <>
            {visibleOffers.length === 0 ? (
              <p className="text-sm text-gray-400 italic">
                No offers yet — run the Shortcut on your next ping and it will show up here.
              </p>
            ) : (
              <div className="space-y-3">
                {visibleOffers.map((offer) => (
                  <div key={offer.id} className="space-y-1">
                    {!recentIds.has(offer.id) && <p className="text-xs text-gray-500">Older offer with an open draft. It leaves this list after Save or Cancel.</p>}
                    <OfferRow offer={offer} onDraftChange={trackDraft} onOutcomeSaved={() => { setSavedCount(count => count + 1); void refetch(); }} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
