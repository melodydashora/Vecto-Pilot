// client/src/components/offer-analyzer/OffersCard.tsx
// 2026-07-03 (todo #10): Live offer history + outcome capture (design §7-§8).
// Shows the analyzer's recommendation per offer ("our call") and lets the driver
// record what actually happened ("your call") — the disagreements feed the coach.
// Refetches on the offer_analyzed SSE event; earnings unlock on Accepted/Completed.
// Row shape is the FLAT offer_intelligence LEFT JOIN offer_outcomes row that
// GET /api/offer-analyzer/offers returns (server/api/offer-analyzer/index.js).

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
}

// Mirrors GET /api/offer-analyzer/offers stats (server/api/offer-analyzer/index.js).
interface OffersStats {
  analyzed?: number;
  analyzer_accepted?: number;
  analyzer_rejected?: number;
  driver_accepted?: number;
  disagreements?: number;
  realized_total?: number;
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
// "unrecorded" with "followed", blocked earnings capture for followed ACCEPTs,
// and excluded the most common outcome from every stat. It now resolves to the
// concrete decision implied by our recommendation (ACCEPT→Accepted, REJECT→Rejected);
// unrecorded offers show a placeholder instead of a pre-selected answer.
const DECISION_OPTIONS = [
  { value: 'followed', label: 'Followed the call' },
  { value: 'Accepted', label: 'Accepted' },
  { value: 'Rejected', label: 'Rejected' },
  { value: 'Cancelled', label: 'Cancelled' },
  { value: 'Completed', label: 'Completed' },
] as const;

const EARNINGS_FIELDS = [
  { key: 'actual_pay', label: 'Actual pay' },
  { key: 'reimbursements', label: 'Reimbursements' },
  { key: 'extras', label: 'Extras' },
  { key: 'other', label: 'Other' },
] as const;

type EarningsKey = (typeof EARNINGS_FIELDS)[number]['key'];
type EarningsDraft = Record<EarningsKey, string>;

function draftFromOffer(offer: AnalyzedOffer): EarningsDraft {
  const s = (v: number | null | undefined) => (v != null ? String(v) : '');
  return {
    actual_pay: s(toNum(offer.actual_pay)),
    reimbursements: s(toNum(offer.reimbursements)),
    extras: s(toNum(offer.extras)),
    other: s(toNum(offer.other)),
  };
}

interface OfferRowProps {
  offer: AnalyzedOffer;
  onOutcomeSaved: () => void;
}

function OfferRow({ offer, onOutcomeSaved }: OfferRowProps) {
  const { toast } = useToast();
  const [isPosting, setIsPosting] = useState(false);
  const [draft, setDraft] = useState<EarningsDraft>(() => draftFromOffer(offer));

  const driverDecision = offer.driver_decision ?? null;
  // No outcome recorded → placeholder, never a pre-selected answer.
  const selectValue = driverDecision ?? '';
  const showEarnings = driverDecision === 'Accepted' || driverDecision === 'Completed';

  // Re-sync the earnings draft when a refetch brings back the saved outcome.
  useEffect(() => {
    // Keyed to the joined outcome values, not the whole row object identity.
    setDraft(draftFromOffer(offer));
  }, [offer.outcome_id, offer.actual_pay, offer.reimbursements, offer.extras, offer.other]);

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
    // The upsert overwrites every column. Earnings carry over only between the
    // taken states (Accepted ↔ Completed); switching to Rejected/Cancelled
    // clears them — otherwise the realized total stays inflated with dollars
    // from a ride that didn't happen, with no UI path to remove them.
    const keepEarnings = resolved === 'Accepted' || resolved === 'Completed';
    postOutcome(
      {
        driver_decision: resolved,
        actual_pay: keepEarnings ? toNum(offer.actual_pay) : null,
        reimbursements: keepEarnings ? toNum(offer.reimbursements) : null,
        extras: keepEarnings ? toNum(offer.extras) : null,
        other: keepEarnings ? toNum(offer.other) : null,
      },
      'Outcome recorded'
    );
  };

  const draftTotal = EARNINGS_FIELDS.reduce((sum, f) => {
    const n = Number(draft[f.key]);
    return sum + (draft[f.key] !== '' && Number.isFinite(n) ? n : 0);
  }, 0);

  const saveEarnings = () => {
    const numeric = (v: string): number | null => {
      if (v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    postOutcome(
      {
        driver_decision: driverDecision,
        actual_pay: numeric(draft.actual_pay),
        reimbursements: numeric(draft.reimbursements),
        extras: numeric(draft.extras),
        other: numeric(draft.other),
      },
      'Earnings saved'
    );
  };

  const perMile = toNum(offer.per_mile);
  const totalMiles = toNum(offer.total_miles);
  const price = toNum(offer.price);

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

      {showEarnings && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
          <span className="text-xs font-medium text-gray-600">What did it pay?</span>
          <div className="grid grid-cols-2 gap-2">
            {EARNINGS_FIELDS.map((f) => (
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
            <Button type="button" size="sm" onClick={saveEarnings} disabled={isPosting}>
              {isPosting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OffersCard() {
  const { data, isLoading, error, refetch } = useQuery<OffersResponse>({
    queryKey: QUERY_KEYS.OFFER_ANALYZER_OFFERS(OFFERS_LIMIT),
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
    refetchOnWindowFocus: false,
  });

  // Live refresh when the Shortcut sends a new offer through the analyzer.
  useEffect(() => {
    const unsubscribe = subscribeOfferAnalyzed(() => {
      refetch();
    });
    return unsubscribe;
  }, [refetch]);

  const offers = data?.offers ?? [];
  const stats = data?.stats;

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
      value: `$${(stats?.realized_total ?? offers.reduce((s, o) => s + (toNum(o.total_earned) ?? 0), 0)).toFixed(2)}`,
      caption: 'Your call',
      captionClass: 'text-emerald-600',
    },
  ];

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

            {offers.length === 0 ? (
              <p className="text-sm text-gray-400 italic">
                No offers yet — run the Shortcut on your next ping and it will show up here.
              </p>
            ) : (
              <div className="space-y-3">
                {offers.map((offer) => (
                  <OfferRow key={offer.id} offer={offer} onOutcomeSaved={() => refetch()} />
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
