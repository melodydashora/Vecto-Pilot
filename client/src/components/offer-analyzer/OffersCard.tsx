// Daily outcome queue; the rolling history chart lives on its own tab.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { subscribeOfferAnalyzed } from '@/utils/co-pilot-helpers';
import { useAuth } from '@/contexts/auth-context';
import { useLocation } from '@/contexts/location-context-clean';
import { driverLocalDate, driverTimeZone, todayForDriver } from '@/lib/offer-local-date';
import { History, Loader2, RotateCcw } from 'lucide-react';
import OfferRow, { type AnalyzedOffer, type OfferOutcomeDraft } from './OfferOutcomeRow';

interface OffersResponse {
  success: true;
  date: string;
  timeZone: string;
  total: number;
  include_removed: boolean;
  offers: AnalyzedOffer[];
}
interface RetainedDraft { offer: AnalyzedOffer; draft: OfferOutcomeDraft; }

export default function OffersCard({ selectedDate, onSelectedDateChange, onDataChanged }: {
  selectedDate?: string;
  onSelectedDateChange?: (date: string) => void;
  onDataChanged?: () => void;
} = {}) {
  const { user, token, isAuthenticated, isLoading } = useAuth();
  if (!user?.userId || !token || !isAuthenticated || isLoading) return null;
  return <DriverOffersCard key={user.userId} userId={user.userId} token={token}
    selectedDate={selectedDate} onSelectedDateChange={onSelectedDateChange} onDataChanged={onDataChanged} />;
}

function DriverOffersCard({ userId, token, selectedDate, onSelectedDateChange, onDataChanged }: {
  userId: string;
  token: string;
  selectedDate?: string;
  onSelectedDateChange?: (date: string) => void;
  onDataChanged?: () => void;
}) {
  const queryClient = useQueryClient();
  const { timeZone } = useLocation();
  const zone = driverTimeZone(timeZone);
  const [localDate, setLocalDate] = useState(() => todayForDriver(timeZone));
  const activeDate = selectedDate ?? localDate;
  const changeDate = (date: string) => {
    if (onSelectedDateChange) onSelectedDateChange(date);
    else setLocalDate(date);
  };
  const [view, setView] = useState<'pending' | 'reviewed' | 'removed'>('pending');
  const [draftOffers, setDraftOffers] = useState<Map<string, RetainedDraft>>(() => new Map());
  const [lastRemovedOffer, setLastRemovedOffer] = useState<AnalyzedOffer | null>(null);
  const [removalError, setRemovalError] = useState('');

  const requestUrl = useMemo(() => {
    const query = new URLSearchParams({ date: activeDate, timeZone: zone.timeZone, include_removed: '1' });
    return `/api/offer-analyzer/offers?${query.toString()}`;
  }, [activeDate, zone.timeZone]);
  const offersQueryKey = useMemo(() => ['offer-day', userId, requestUrl], [userId, requestUrl]);
  const { data, isLoading, error, refetch } = useQuery<OffersResponse>({
    queryKey: offersQueryKey,
    queryFn: async ({ signal }) => {
      const res = await fetch(requestUrl, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        signal, cache: 'no-store',
      });
      if (!res.ok) throw new Error(`Failed to load offers (${res.status})`);
      const result = await res.json();
      if (result?.success !== true || !Array.isArray(result.offers)) {
        throw new Error('The server did not return the selected day’s complete offer list.');
      }
      if (result.date !== activeDate || result.timeZone !== zone.timeZone) {
        throw new Error('The server returned offers for a different day or timezone. Your offers were not changed.');
      }
      if (result.include_removed !== true || !Number.isSafeInteger(result.total)
        || result.total !== result.offers.length) {
        throw new Error('The server did not return the complete selected-day offer list, including removal status. Your offers were not changed.');
      }
      return result as OffersResponse;
    },
    staleTime: 15 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const refetchCurrent = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['offer-day', userId] });
  }, [queryClient, userId]);
  const notifyDataChanged = useCallback(() => {
    refetchCurrent();
    onDataChanged?.();
  }, [refetchCurrent, onDataChanged]);
  useEffect(() => {
    const unsubscribe = subscribeOfferAnalyzed(notifyDataChanged);
    return unsubscribe;
  }, [notifyDataChanged]);

  const trackDraft = useCallback((offer: AnalyzedOffer, dirty: boolean, draft?: OfferOutcomeDraft) => {
    setDraftOffers(current => {
      if (dirty && draft && current.get(offer.id)?.offer === offer
        && JSON.stringify(current.get(offer.id)?.draft) === JSON.stringify(draft)) return current;
      if (!dirty && !current.has(offer.id)) return current;
      const next = new Map(current);
      if (dirty && draft) next.set(offer.id, { offer, draft }); else next.delete(offer.id);
      return next;
    });
  }, []);

  const canonicalOffers = data?.offers ?? [];
  const currentIds = new Set(canonicalOffers.map(offer => offer.id));
  const retainedDrafts = [...draftOffers.values()].filter(({ offer }) =>
    !currentIds.has(offer.id)
    && !offer.removed_at
    && !!offer.created_at
    && driverLocalDate(new Date(offer.created_at), zone.timeZone) === activeDate,
  );
  const allOffers = [...canonicalOffers, ...retainedDrafts.map(({ offer }) => offer)];
  const dayOffers = allOffers.filter(offer => !offer.removed_at);
  const pending = dayOffers.filter(offer => !offer.driver_decision);
  const reviewed = dayOffers.filter(offer => !!offer.driver_decision);
  const removed = allOffers.filter(offer => !!offer.removed_at);
  const visibleCount = view === 'pending' ? pending.length : view === 'reviewed' ? reviewed.length : removed.length;
  const accepted = reviewed.filter(offer => offer.driver_decision === 'Accepted' || offer.driver_decision === 'Completed');
  const dayLoaded = data != null;
  const earningsRecorded = accepted.filter(offer =>
    [offer.actual_pay, offer.reimbursements, offer.extras, offer.other]
      .some(amount => amount != null && Number.isFinite(Number(amount))),
  );
  const knownEarnings = earningsRecorded.reduce((total, offer) => total + (Number(offer.total_earned) || 0), 0);

  const changeRemovalState = async (offer: AnalyzedOffer, action: 'remove' | 'restore') => {
    setRemovalError('');
    if (!token) throw new Error('Sign in again before changing an offer.');
    try {
      const response = await fetch(`/api/offer-analyzer/offers/${encodeURIComponent(offer.id)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ expected_removal_revision: offer.removal_revision ?? 0 }),
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 409) throw new Error('This offer changed elsewhere. Refresh the day before trying again.');
      if (!response.ok || payload?.success !== true || payload.offer?.id !== offer.id) {
        throw new Error(payload?.message || `Could not ${action} this offer (${response.status}). It is still available.`);
      }
      const changed = { ...offer, ...payload.offer } as AnalyzedOffer;
      queryClient.setQueryData<OffersResponse>(offersQueryKey, current => current && ({
        ...current,
        offers: current.offers.map(item => item.id === offer.id ? { ...item, ...payload.offer } : item),
      }));
      if (action === 'remove') setLastRemovedOffer({
        ...changed,
      });
      else if (lastRemovedOffer?.id === offer.id) setLastRemovedOffer(null);
      notifyDataChanged();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Could not update this offer. It is still available.';
      setRemovalError(message);
      throw new Error(message);
    }
  };
  const lastRemoved = lastRemovedOffer?.created_at
    && driverLocalDate(new Date(lastRemovedOffer.created_at), zone.timeZone) === activeDate
    ? lastRemovedOffer : null;

  return (
    <Card className="bg-white border-gray-200 shadow-sm">
      <CardHeader className="space-y-3 pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <History className="h-5 w-5 text-indigo-500" /> Daily Offers
        </CardTitle>
        <CardDescription>Review each capture and record what happened. Saving an outcome does not remove the offer.</CardDescription>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="space-y-1 text-sm font-medium text-gray-700" htmlFor="offers-local-date">
            <span>Offer date</span>
            <input id="offers-local-date" type="date" value={activeDate}
              onChange={event => { if (event.target.value) changeDate(event.target.value); }}
              className="block min-h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900" />
          </label>
          <p className="text-xs text-gray-500 sm:max-w-48">
            <time dateTime={activeDate}>{activeDate}</time>
            <br />{zone.source === 'GPS' ? 'Driver timezone' : 'Device timezone'}: {zone.timeZone}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center">
          <p className="text-xs text-gray-600"><strong className="block text-lg text-gray-900">{dayLoaded ? pending.length : '—'}</strong>Needs review</p>
          <p className="text-xs text-gray-600"><strong className="block text-lg text-gray-900">{dayLoaded ? reviewed.length : '—'}</strong>Reviewed</p>
          <p className="text-xs text-gray-600"><strong className="block text-lg text-gray-900">{dayLoaded ? `$${knownEarnings.toFixed(2)}` : '—'}</strong>Known earnings ({dayLoaded ? `${earningsRecorded.length}/${accepted.length}` : '—'} reported)</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {lastRemoved && <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <span>Offer removed from this day’s totals and charts.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => { void changeRemovalState(lastRemoved, 'restore').catch(() => {}); }}>
            <RotateCcw className="mr-1 h-4 w-4" />Undo
          </Button>
        </div>}
        {removalError && <p role="alert" className="text-sm text-red-700">{removalError}</p>}
        <Tabs value={view} onValueChange={(value) => setView(value as typeof view)} className="space-y-3">
          <TabsList aria-label="Daily offer review status" className="grid h-auto w-full grid-cols-3">
            <TabsTrigger value="pending" className="px-1.5 text-xs sm:text-sm">Pending ({dayLoaded ? pending.length : '—'})</TabsTrigger>
            <TabsTrigger value="reviewed" className="px-1.5 text-xs sm:text-sm">Reviewed ({dayLoaded ? reviewed.length : '—'})</TabsTrigger>
            <TabsTrigger value="removed" className="px-1.5 text-xs sm:text-sm">Removed ({dayLoaded ? removed.length : '—'})</TabsTrigger>
          </TabsList>
          <TabsContent value={view} forceMount className="mt-0 space-y-3">
            {isLoading && <div role="status" className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>}
            {!isLoading && error && <div className="flex items-center justify-between gap-2">
              <p role="alert" className="text-sm text-red-700">{data
                ? 'Could not refresh this day. The displayed list and open drafts are retained.'
                : error instanceof Error ? error.message : 'Could not load this day’s offers.'}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>Retry</Button>
            </div>}
            {!isLoading && !error && visibleCount === 0 && (
              <p className="rounded-lg border border-dashed border-gray-300 p-5 text-center text-sm text-gray-500">
                {view === 'pending' ? 'No offers yet for this day; none need review.' : view === 'reviewed' ? 'No offers have been reviewed for this day.' : 'No offers have been removed for this day.'}
              </p>
            )}
            {allOffers.map(offer => {
              const status = offer.removed_at ? 'removed' : offer.driver_decision ? 'reviewed' : 'pending';
              return <div key={offer.id} className={status === view ? '' : 'hidden'}>
                <OfferRow offer={offer}
                onDraftChange={trackDraft}
                initialDraft={draftOffers.get(offer.id)?.draft}
                onOutcomeSaved={notifyDataChanged}
                onRemove={() => changeRemovalState(offer, 'remove')}
                onRestore={() => changeRemovalState(offer, 'restore')}
                isRemoved={!!offer.removed_at}
                />
              </div>;
            })}
          </TabsContent>
        </Tabs>
        {!isLoading && !error && <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>Refresh offers</Button>}
      </CardContent>
    </Card>
  );
}