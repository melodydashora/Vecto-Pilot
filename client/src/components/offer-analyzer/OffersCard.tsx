// client/src/components/offer-analyzer/OffersCard.tsx
// 2026-07-03 (todo #10): Live offer history + outcome capture (design §7-§8).
// 2026-08-24: Upfront-fare validation (Earnings Log Module). Accepted offers
// settle through a panel that assumes the payout equals the accepted upfront
// fare (fare pre-filled and locked); tips/tolls/extras go on top, and "Paid
// different than what I accepted" unlocks the fare and records a mismatch —
// the per-offer test that the platform honors its upfront fares. Saving stamps
// settled_at and the offer leaves the queue (Show settled reveals history).
// Refetches on the offer_analyzed SSE event. Row shape is the FLAT
// offer_intelligence LEFT JOIN offer_outcomes row that
// GET /api/offer-analyzer/offers returns (server/api/offer-analyzer/index.js).

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/useToast';
import { getAuthHeader, subscribeOfferAnalyzed } from '@/utils/co-pilot-helpers';
import { API_ROUTES, QUERY_KEYS } from '@/constants/apiRoutes';
import { History, Loader2 } from 'lucide-react';

const OFFERS_LIMIT = 25;

type DriverDecision = 'Accepted' | 'Rejected' | 'Cancelled' | 'Completed';

interface AnalyzedOffer {
  id: string;
  decision: string; // 'ACCEPT' | 'REJECT' | 'NO DATA'
  decision_reasoning?: string | null;
  price?: number | null;
  per_mile?: number | null;
  total_miles?: number | null;
  product_type?: string | null;
  created_at?: string | null;
  // LEFT JOINed outcome columns (flat, null when no outcome recorded)
  outcome_id?: string | null;
  driver_decision?: DriverDecision | null;
  actual_pay?: number | null;
  reimbursements?: number | null;
  extras?: number | null;
  other?: number | null;
  total_earned?: number | null;
  // Upfront-fare validation (2026-08-24)
  tips?: number | null;
  tolls?: number | null;
  upfront_price?: number | null;
  fare_matched_upfront?: boolean | null;
  settled_at?: string | null;
  total_realized?: number | null; // total_earned + tips + tolls (computed server-side)
}

// Mirrors GET /api/offer-analyzer/offers stats (server/api/offer-analyzer/index.js).
interface OffersStats {
  analyzed?: number;
  analyzer_accepted?: number;
  analyzer_rejected?: number;
  driver_accepted?: number;
  disagreements?: number;
  realized_total?: number;
  fares_validated?: number;
  fare_mismatches?: number;
}

interface OffersResponse {
  success?: boolean;
  offers?: AnalyzedOffer[];
  stats?: OffersStats;
}

/** pg can return numerics as strings depending on the column type — coerce once. */
function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function decisionBadgeClass(decision: string): string {
  if (decision === 'ACCEPT') return 'bg-green-100 text-green-800 border-transparent';
  if (decision === 'REJECT') return 'bg-red-100 text-red-800 border-transparent';
  return 'bg-gray-100 text-gray-600 border-transparent'; // NO DATA
}

// 2026-07-03 review fix: "Followed the call" used to store NULL, which conflated
// "unrecorded" with "followed" — it now resolves to the concrete decision implied
// by our recommendation (ACCEPT→Accepted, REJECT→Rejected).
const DECISION_OPTIONS = [
  { value: 'followed', label: 'Followed the call' },
  { value: 'Accepted', label: 'Accepted' },
  { value: 'Rejected', label: 'Rejected' },
  { value: 'Cancelled', label: 'Cancelled' },
  { value: 'Completed', label: 'Completed' },
] as const;

// Earnings Log Module fields (product spec §3, Offer Analyzer tab): baseline
// fare + tips + toll reimbursements + extras. Fare is handled separately (it is
// the upfront-price validation target); these three stack on top of it.
const ADDON_FIELDS = [
  { key: 'tips', label: 'Tips' },
  { key: 'tolls', label: 'Tolls' },
  { key: 'extras', label: 'Extras' },
] as const;

type AddonKey = (typeof ADDON_FIELDS)[number]['key'];

interface SettleDraft extends Record<AddonKey, string> {
  fare: string;
}

function draftFromOffer(offer: AnalyzedOffer): SettleDraft {
  const s = (v: number | null | undefined) => (v != null ? String(v) : '');
  // Default assumption: the payout equals the accepted upfront fare.
  const fare = toNum(offer.actual_pay) ?? toNum(offer.price);
  return {
    fare: s(fare),
    tips: s(toNum(offer.tips)),
    tolls: s(toNum(offer.tolls)),
    extras: s(toNum(offer.extras)),
  };
}

function fmtMoney(v: number | null | undefined): string {
  return v != null ? `$${v.toFixed(2)}` : '—';
}

interface OfferRowProps {
  offer: AnalyzedOffer;
  onOutcomeSaved: () => void;
}

function OfferRow({ offer, onOutcomeSaved }: OfferRowProps) {
  const { toast } = useToast();
  const [isPosting, setIsPosting] = useState(false);
  const [draft, setDraft] = useState<SettleDraft>(() => draftFromOffer(offer));
  const [fareDiffers, setFareDiffers] = useState(offer.fare_matched_upfront === false);

  const driverDecision = offer.driver_decision ?? null;
  // No outcome recorded → placeholder, never a pre-selected answer.
  const selectValue = driverDecision ?? '';
  const isTaken = driverDecision === 'Accepted' || driverDecision === 'Completed';
  const isSettled = offer.settled_at != null;
  const upfrontPrice = toNum(offer.price);
  const showSettlePanel = isTaken && !isSettled;

  // Re-sync the draft when a refetch brings back the saved outcome.
  useEffect(() => {
    setDraft(draftFromOffer(offer));
    setFareDiffers(offer.fare_matched_upfront === false);
    // Keyed to the joined outcome values, not the whole row object identity.
  }, [offer.outcome_id, offer.actual_pay, offer.tips, offer.tolls, offer.extras, offer.fare_matched_upfront, offer.settled_at]);

  const postOutcome = async (body: Record<string, unknown>, successTitle: string) => {
    setIsPosting(true);
    try {
      const res = await fetch(API_ROUTES.OFFER_ANALYZER.OFFER_OUTCOME(offer.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Failed to save outcome (${res.status})`);
      toast({ title: successTitle });
      onOutcomeSaved();
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save outcome',
        variant: 'destructive',
      });
    } finally {
      setIsPosting(false);
    }
  };

  const handleDecisionChange = (value: string) => {
    // "Followed the call" resolves to the concrete decision our recommendation
    // implies — it is a real outcome, not a null.
    const resolved = value === 'followed'
      ? (offer.decision === 'ACCEPT' ? 'Accepted' : 'Rejected')
      : value;
    const taken = resolved === 'Accepted' || resolved === 'Completed';
    // Rejected/Cancelled have nothing to validate — they settle (and leave the
    // queue) immediately, with earnings cleared so no phantom dollars linger.
    // Accepted/Completed stay OPEN: the fare-validation panel must be saved
    // before the offer settles, so picking a decision never skips the fare test.
    postOutcome(
      {
        driver_decision: resolved,
        actual_pay: taken ? toNum(offer.actual_pay) : null,
        tips: taken ? toNum(offer.tips) : null,
        tolls: taken ? toNum(offer.tolls) : null,
        extras: taken ? toNum(offer.extras) : null,
        reimbursements: taken ? toNum(offer.reimbursements) : null,
        other: taken ? toNum(offer.other) : null,
        upfront_price: taken ? toNum(offer.upfront_price) : null,
        fare_matched_upfront: taken ? offer.fare_matched_upfront ?? null : null,
        settled: !taken,
      },
      taken ? 'Marked as taken — confirm the fare below' : 'Outcome recorded'
    );
  };

  const numeric = (v: string): number | null => {
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const fareValue = fareDiffers || upfrontPrice == null ? numeric(draft.fare) : upfrontPrice;
  const draftTotal = (fareValue ?? 0)
    + ADDON_FIELDS.reduce((sum, f) => sum + (numeric(draft[f.key]) ?? 0), 0);

  const saveSettlement = () => {
    // The whole point of the upfront test: unless the driver flags a difference,
    // the fare saved IS the accepted upfront price — copied exactly, never typed.
    postOutcome(
      {
        driver_decision: driverDecision,
        actual_pay: fareValue,
        tips: numeric(draft.tips),
        tolls: numeric(draft.tolls),
        extras: numeric(draft.extras),
        reimbursements: toNum(offer.reimbursements),
        other: toNum(offer.other),
        upfront_price: upfrontPrice,
        fare_matched_upfront: upfrontPrice != null ? !fareDiffers : null,
        settled: true,
      },
      'Offer settled'
    );
  };

  const perMile = toNum(offer.per_mile);
  const totalMiles = toNum(offer.total_miles);
  const price = toNum(offer.price);
  const totalRealized = toNum(offer.total_realized) ?? toNum(offer.total_earned);

  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Badge className={decisionBadgeClass(offer.decision)}>{offer.decision}</Badge>
        <span className="text-xs text-gray-400">{timeAgo(offer.created_at)}</span>
      </div>

      <div className="flex items-baseline gap-2 text-sm text-gray-800">
        {perMile != null && <span className="font-semibold tabular-nums">${perMile.toFixed(2)}/mi</span>}
        {totalMiles != null && <span className="text-gray-500 tabular-nums">{totalMiles.toFixed(1)} mi</span>}
        {price != null && <span className="text-gray-500 tabular-nums">${price.toFixed(2)}</span>}
        {offer.product_type && <span className="text-xs text-gray-400">{offer.product_type}</span>}
      </div>

      {offer.decision_reasoning && <p className="text-xs text-gray-500">{offer.decision_reasoning}</p>}

      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-600">What did you do?</label>
        {/* key: re-mount Radix Select when a refetch changes the recorded outcome */}
        <Select
          key={`${offer.id}-${selectValue}`}
          value={selectValue}
          onValueChange={handleDecisionChange}
          disabled={isPosting}
        >
          <SelectTrigger className="bg-white border-gray-300 text-gray-800">
            <SelectValue placeholder="What did you do?" />
          </SelectTrigger>
          <SelectContent>
            {DECISION_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {showSettlePanel && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
          <span className="text-xs font-medium text-gray-600">
            {upfrontPrice != null ? 'Confirm what it paid' : 'What did it pay?'}
          </span>

          <div className="space-y-1">
            <label className="text-xs text-gray-500">
              {upfrontPrice != null ? 'Fare — as accepted' : 'Fare'}
            </label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={fareDiffers || upfrontPrice == null ? draft.fare : String(upfrontPrice)}
              disabled={upfrontPrice != null && !fareDiffers}
              onChange={(e) => setDraft({ ...draft, fare: e.target.value })}
              className="bg-white border-gray-300 text-gray-900 disabled:bg-gray-100 disabled:text-gray-500"
            />
          </div>

          {upfrontPrice != null && (
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={fareDiffers}
                onChange={(e) => {
                  setFareDiffers(e.target.checked);
                  // Unchecking snaps the fare back to the accepted upfront price.
                  setDraft({ ...draft, fare: String(upfrontPrice) });
                }}
                className="h-4 w-4 rounded border-gray-300"
                disabled={isPosting}
              />
              Paid different than what I accepted
            </label>
          )}

          <div className="grid grid-cols-3 gap-2">
            {ADDON_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <label className="text-xs text-gray-500">{f.label}</label>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={draft[f.key]}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  className="bg-white border-gray-300 text-gray-900"
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-sm text-gray-600">
              Total: <span className="font-semibold text-gray-900 tabular-nums">${draftTotal.toFixed(2)}</span>
            </span>
            <Button type="button" size="sm" onClick={saveSettlement} disabled={isPosting}>
              {isPosting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      )}

      {isSettled && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {isTaken && (
            <span className="text-gray-600">
              Earned <span className="font-semibold text-gray-900 tabular-nums">{fmtMoney(totalRealized)}</span>
            </span>
          )}
          {offer.fare_matched_upfront === true && (
            <Badge className="bg-emerald-100 text-emerald-800 border-transparent">Fare matched</Badge>
          )}
          {offer.fare_matched_upfront === false && (
            <Badge className="bg-amber-100 text-amber-800 border-transparent">
              Paid {fmtMoney(toNum(offer.actual_pay))} vs {fmtMoney(toNum(offer.upfront_price))} accepted
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

export default function OffersCard() {
  const queryClient = useQueryClient();
  const [showSettled, setShowSettled] = useState(false);
  const offersQueryKey = useMemo(() => QUERY_KEYS.OFFER_ANALYZER_OFFERS(OFFERS_LIMIT), []);
  const { data, isLoading, error, refetch } = useQuery<OffersResponse>({
    queryKey: offersQueryKey,
    // The default queryClient queryFn sends no auth header and force-logs-out on
    // 401 — always pass an explicit queryFn with getAuthHeader().
    queryFn: async () => {
      const res = await fetch(API_ROUTES.OFFER_ANALYZER.OFFERS(OFFERS_LIMIT), {
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      });
      if (!res.ok) throw new Error(`Failed to load offers (${res.status})`);
      return res.json();
    },
    staleTime: 30 * 1000,
    // 2026-08-17 (race/SSE review finding #2): the headline flow runs the Shortcut
    // FROM the Uber app — this tab is backgrounded, iOS drops the EventSource, and
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

  const offers = data?.offers ?? [];
  const stats = data?.stats;

  // The queue: settled offers leave the list ("once the user saves the offer
  // goes away" — Melody). Show settled reveals the history for recovery.
  const pendingOffers = offers.filter((o) => o.settled_at == null);
  const settledOffers = offers.filter((o) => o.settled_at != null);
  const visibleOffers = showSettled ? offers : pendingOffers;

  const tiles = [
    {
      label: 'Analyzed',
      value: String(stats?.analyzed ?? offers.length),
      caption: 'All offers',
      captionClass: 'text-gray-400',
    },
    {
      label: 'We said accept',
      value: String(stats?.analyzer_accepted ?? offers.filter((o) => o.decision === 'ACCEPT').length),
      caption: 'Our call',
      captionClass: 'text-blue-600',
    },
    {
      label: 'You accepted',
      value: String(
        stats?.driver_accepted ??
          offers.filter((o) => o.driver_decision === 'Accepted' || o.driver_decision === 'Completed').length
      ),
      caption: 'Your call',
      captionClass: 'text-emerald-600',
    },
    {
      label: 'Realized',
      value: `$${(
        stats?.realized_total ??
        offers.reduce((s, o) => s + (toNum(o.total_realized) ?? toNum(o.total_earned) ?? 0), 0)
      ).toFixed(2)}`,
      caption: 'Your call',
      captionClass: 'text-emerald-600',
    },
  ];

  const faresValidated = stats?.fares_validated ?? 0;
  const fareMismatches = stats?.fare_mismatches ?? 0;

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
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
          </div>
        )}

        {!isLoading && error != null && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-gray-500">Could not load your offers.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        )}

        {!isLoading && error == null && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {tiles.map((tile) => (
                <div key={tile.label} className="rounded-lg border border-gray-200 p-3">
                  <p className="text-xs text-gray-500">{tile.label}</p>
                  <p className="text-xl font-semibold text-gray-900">{tile.value}</p>
                  <p className={`text-[10px] uppercase tracking-wide ${tile.captionClass}`}>{tile.caption}</p>
                </div>
              ))}
            </div>

            {faresValidated > 0 && (
              <p className="text-xs text-gray-500">
                Upfront fares checked: <span className="font-semibold text-gray-700">{faresValidated}</span>
                {' · '}mismatches:{' '}
                <span className={`font-semibold ${fareMismatches > 0 ? 'text-amber-600' : 'text-gray-700'}`}>
                  {fareMismatches}
                </span>
              </p>
            )}

            {offers.length === 0 ? (
              <p className="text-sm text-gray-400 italic">
                No offers yet — run the Shortcut on your next ping and it will show up here.
              </p>
            ) : (
              <>
                {visibleOffers.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">
                    All caught up — settled offers are under Show settled.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {visibleOffers.map((offer) => (
                      <OfferRow key={offer.id} offer={offer} onOutcomeSaved={() => refetch()} />
                    ))}
                  </div>
                )}

                {settledOffers.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-gray-500"
                    onClick={() => setShowSettled((v) => !v)}
                  >
                    {showSettled ? 'Hide settled' : `Show settled (${settledOffers.length})`}
                  </Button>
                )}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
