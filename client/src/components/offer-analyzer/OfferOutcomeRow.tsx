// September 10, 2026: explicit outcome drafts and confirmed, compact saved rows.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { API_ROUTES } from '@/constants/apiRoutes';
import { useAuth } from '@/contexts/auth-context';
import { useLocation } from '@/contexts/location-context-clean';
import { getLocalIso } from '@/lib/daypart';
import { driverTimeZone } from '@/lib/offer-local-date';
import { Loader2 } from 'lucide-react';

export type DriverDecision = 'Accepted' | 'Rejected' | 'Cancelled' | 'Completed' | 'Other';
export interface AnalyzedOffer {
  id: string;
  decision: string;
  decision_reasoning?: string | null;
  price?: number | null;
  per_mile?: number | null;
  total_miles?: number | null;
  total_minutes?: number | null;
  product_type?: string | null;
  created_at?: string | null;
  offer_kind?: 'ride' | 'delivery' | null;
  tip_included?: boolean | null;
  reason_kind?: string | null;
  shortcut_system?: string | null;
  outcome_id?: string | null;
  outcome_revision?: number | null;
  outcome_updated_at?: string | null;
  removed_at?: string | null;
  removal_revision?: number | null;
  driver_decision?: DriverDecision | null;
  driver_reasoning?: string | null;
  actual_pay?: number | null;
  reimbursements?: number | null;
  extras?: number | null;
  other?: number | null;
  total_earned?: number | null;
}

const DECISIONS: DriverDecision[] = ['Accepted', 'Rejected', 'Cancelled', 'Completed', 'Other'];
const EARNINGS_FIELDS = [
  { key: 'actual_pay', label: 'Actual pay' },
  { key: 'reimbursements', label: 'Reimbursements' },
  { key: 'extras', label: 'Extras' },
  { key: 'other', label: 'Other earnings' },
] as const;
type EarningsKey = typeof EARNINGS_FIELDS[number]['key'];
export type OfferOutcomeDraft = Record<EarningsKey, string> & { decision: DriverDecision | ''; reasoning: string };
type Draft = OfferOutcomeDraft;
const taken = (decision: string | null | undefined) => decision === 'Accepted' || decision === 'Completed';
export function offerNumber(value: unknown): number | null {
  if (value == null || value === '' || (typeof value !== 'number' && typeof value !== 'string')) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function draftFrom(offer: AnalyzedOffer): Draft {
  const text = (value: unknown) => offerNumber(value) == null ? '' : String(offerNumber(value));
  const price = offer.reason_kind !== 'implausible_parse' ? offerNumber(offer.price) : null;
  return {
    decision: offer.driver_decision ?? '', reasoning: offer.driver_reasoning ?? '',
    actual_pay: text(offer.actual_pay ?? (!offer.outcome_id && price != null && price >= 0 && price <= 10000 ? price : null)),
    reimbursements: text(offer.reimbursements), extras: text(offer.extras), other: text(offer.other),
  };
}
function revision(offer: AnalyzedOffer) { return offer.outcome_revision ?? null; }
function reported(offer: AnalyzedOffer) { return EARNINGS_FIELDS.some(field => offerNumber(offer[field.key]) != null); }
function decisionLabel(decision: string) { return decision === 'Other' ? 'Other / error' : decision; }

/** A successful HTTP status is insufficient: only this complete saved row can collapse the editor. */
function canonicalOutcome(value: unknown, offerId: string): Partial<AnalyzedOffer> {
  const row = value as Record<string, unknown> | null;
  if (!row || row.offer_intelligence_id !== offerId || typeof row.id !== 'string'
    || !DECISIONS.includes(row.driver_decision as DriverDecision)
    || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1
    || (row.driver_reasoning !== null && typeof row.driver_reasoning !== 'string')) {
    throw new Error('The server did not confirm the saved outcome. Your entries are still here; retry to check the saved version.');
  }
  for (const field of [...EARNINGS_FIELDS.map(item => item.key), 'total_earned']) {
    if (!Object.prototype.hasOwnProperty.call(row, field) || (row[field] !== null && offerNumber(row[field]) == null)) {
      throw new Error('The server did not confirm all saved amounts. Your entries are still here.');
    }
  }
  return {
    outcome_id: row.id, outcome_revision: Number(row.revision), driver_decision: row.driver_decision as DriverDecision,
    driver_reasoning: row.driver_reasoning as string | null, actual_pay: offerNumber(row.actual_pay),
    reimbursements: offerNumber(row.reimbursements), extras: offerNumber(row.extras),
    other: offerNumber(row.other), total_earned: offerNumber(row.total_earned),
  };
}

export default function OfferOutcomeRow({ offer, onOutcomeSaved, onDraftChange, onRemove, onRestore, isRemoved = !!offer.removed_at, initialDraft }: {
  offer: AnalyzedOffer;
  onOutcomeSaved: () => void;
  onDraftChange?: (offer: AnalyzedOffer, dirty: boolean, draft?: OfferOutcomeDraft) => void;
  onRemove?: () => Promise<void>;
  onRestore?: () => Promise<void>;
  isRemoved?: boolean;
  initialDraft?: OfferOutcomeDraft;
}) {
  const { token, isAuthenticated } = useAuth();
  const { timeZone } = useLocation();
  const localZone = driverTimeZone(timeZone);
  const [saved, setSaved] = useState(offer);
  const [editing, setEditing] = useState(() => !!initialDraft || !offer.driver_decision);
  const [draft, setDraft] = useState(() => initialDraft ?? draftFrom(offer));
  const [expectedRevision, setExpectedRevision] = useState(revision(offer));
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<AnalyzedOffer | null>(null);
  const [dirty, setDirty] = useState(!!initialDraft);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [removalPending, setRemovalPending] = useState(false);
  const [removalError, setRemovalError] = useState('');
  const latestSaved = useRef(offer);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const acceptCanonical = useCallback((candidate: AnalyzedOffer) => {
    // GETs, successful POSTs and conflict responses can arrive in any order.
    // Keep this ref current synchronously, including between React renders.
    if ((revision(candidate) ?? 0) >= (revision(latestSaved.current) ?? 0)) {
      latestSaved.current = candidate;
      setSaved(candidate);
    }
    return latestSaved.current;
  }, []);

  useEffect(() => {
    if (acceptCanonical(offer) !== offer) return;
    if (!editing) { setDraft(draftFrom(offer)); setExpectedRevision(revision(offer)); }
    setConflict(current => current ? offer : null);
    // Open drafts retain their original revision; the server detects intervening edits.
  }, [offer, acceptCanonical]);

  const beginEdit = () => {
    setDraft(draftFrom(latestSaved.current)); setExpectedRevision(revision(latestSaved.current));
    setConflict(null); setError(''); setEditing(true);
  };
  const markDirty = (nextDraft: Draft) => { setDirty(true); onDraftChange?.(offer, true, nextDraft); };
  const clearDirty = () => { setDirty(false); onDraftChange?.(offer, false); };
  const choose = (value: string) => {
    if (value === 'followed' && offer.reason_kind === 'implausible_parse') return;
    const resolved = value === 'followed'
      ? offer.decision === 'ACCEPT' ? 'Accepted' : offer.decision === 'REJECT' ? 'Rejected' : ''
      : value;
    if (!DECISIONS.includes(resolved as DriverDecision)) return;
    const nextDraft = { ...draft, decision: resolved as DriverDecision };
    markDirty(nextDraft);
    setDraft(nextDraft);
    setError('');
  };
  const save = async () => {
    if (isPosting || request.current || !draft.decision) return;
    setError('');
    if (!token || !isAuthenticated) {
      setError('Sign in again before saving. Your entries are still here.'); return;
    }
    const body: Record<string, unknown> = {
      expected_revision: expectedRevision, driver_decision: draft.decision,
      driver_reasoning: draft.reasoning.trim() || null,
    };
    if (taken(draft.decision)) {
      for (const field of EARNINGS_FIELDS) {
        const value = draft[field.key].trim();
        const number = value === '' ? null : Number(value);
        if (number !== null && (!Number.isFinite(number) || number < 0 || number > 10000)) {
          setError(`${field.label} must be between 0 and 10000, or blank if unknown.`); return;
        }
        body[field.key] = number;
      }
    }
    const controller = new AbortController(); request.current = controller; setIsPosting(true);
    try {
      const response = await fetch(API_ROUTES.OFFER_ANALYZER.OFFER_OUTCOME(offer.id), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        signal: controller.signal, body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (controller.signal.aborted) return;
      if (response.status === 409) {
        const current = acceptCanonical({ ...latestSaved.current, ...canonicalOutcome(payload.current, offer.id) });
        setConflict(current);
        throw new Error('This outcome changed elsewhere. Your draft is preserved. Load the saved version to review it before making another change.');
      }
      if (!response.ok) throw new Error(payload.error === 'outcome_version_required'
        ? 'This form is out of date. Keep a copy of your unsaved entries, then refresh the Offer Analyzer before saving.'
        : response.status === 401 ? 'Sign in again before saving. Your entries are still here.' : `Could not save this outcome (${response.status}). Your entries are still here.`);
      if (payload.success !== true) throw new Error('The server did not confirm the save. Your entries are still here.');
      const confirmed = { ...latestSaved.current, ...canonicalOutcome(payload.outcome, offer.id) };
      if (controller.signal.aborted) return;
      const current = acceptCanonical(confirmed);
      if (current !== confirmed) {
        setConflict(current);
        setError('Your save completed, but a newer saved version is already available. Your draft is preserved. Load the saved version to review it before making another change.');
        onOutcomeSaved();
        return;
      }
      setDraft(draftFrom(confirmed)); setExpectedRevision(revision(confirmed));
      setEditing(false); setConflict(null); clearDirty(); onOutcomeSaved();
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not save. Your entries are still here.');
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setIsPosting(false);
    }
  };
  const price = offerNumber(offer.price), perMile = offerNumber(offer.per_mile);
  const miles = offerNumber(offer.total_miles), minutes = offerNumber(offer.total_minutes);
  const parseError = offer.reason_kind === 'implausible_parse';
  const delivery = offer.offer_kind === 'delivery' || /^Delivery\b/.test(offer.product_type ?? '');
  const perHour = price != null && minutes != null && minutes > 0 ? Math.round(price / minutes * 60) : null;
  const draftTotal = EARNINGS_FIELDS.reduce((sum, field) => sum + (offerNumber(draft[field.key]) ?? 0), 0);
  const inputPrefix = `offer-${offer.id}`;
  const createdAt = offer.created_at ? new Date(offer.created_at) : null;
  const localCreatedAt = createdAt && Number.isFinite(createdAt.getTime())
    ? getLocalIso(createdAt, localZone.timeZone).replace('T', ' ') : null;
  const removeOrRestore = async () => {
    const action = isRemoved ? onRestore : onRemove;
    if (!action || removalPending) return;
    setRemovalPending(true);
    setRemovalError('');
    try {
      await action();
      setConfirmRemoval(false);
    } catch (failure) {
      setRemovalError(failure instanceof Error ? failure.message : 'Could not update this offer. It is still available.');
    } finally {
      setRemovalPending(false);
    }
  };
  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={parseError ? 'bg-amber-100 text-amber-900 border-transparent' : offer.decision === 'ACCEPT' ? 'bg-green-100 text-green-800 border-transparent' : offer.decision === 'REJECT' ? 'bg-red-100 text-red-800 border-transparent' : 'bg-gray-100 text-gray-600 border-transparent'}>
            {parseError ? 'PARSE ERROR — decide manually' : offer.decision}
          </Badge>
          {delivery && <Badge className="bg-violet-100 text-violet-800 border-transparent">{/^Delivery Exclusive/.test(offer.product_type ?? '') ? 'Delivery · Exclusive' : 'Delivery'}</Badge>}
          {delivery && offer.tip_included && <span className="text-[10px] uppercase tracking-wide text-violet-700">tip incl.</span>}
          {isRemoved && <Badge variant="outline" className="border-amber-400 text-amber-800">Removed from totals</Badge>}
        </div>
          {localCreatedAt && <time className="text-xs text-gray-500 break-words" dateTime={offer.created_at ?? undefined}>{localCreatedAt} ({localZone.timeZone}{localZone.source === 'GPS' ? '' : ', device timezone'})</time>}
      </div>
      <div className="flex items-baseline gap-2 flex-wrap text-sm text-gray-800">
        {perMile != null && <span className={`font-semibold tabular-nums ${parseError ? 'line-through text-amber-800' : ''}`}>${perMile.toFixed(2)}/mi</span>}
        {miles != null && <span className="text-gray-500 tabular-nums">{miles.toFixed(1)} mi{delivery ? ' total' : ''}</span>}
        {price != null && <span className="text-gray-500 tabular-nums">Offered ${price.toFixed(2)}</span>}
        {delivery && perHour != null && !parseError && <span className="text-gray-500 tabular-nums">${perHour}/hr offered</span>}
        {!delivery && offer.product_type && <span className="text-xs text-gray-400">{offer.product_type}</span>}
        {offer.shortcut_system && <span className="ml-auto text-[10px] font-mono text-gray-400" title="Automation client that sent this offer">{offer.shortcut_system}</span>}
      </div>
      {(isRemoved ? onRestore : onRemove) && (
        <div className="space-y-2">
          {removalError && <p role="alert" className="text-sm text-red-700">{removalError}</p>}
          {confirmRemoval ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2">
              <p className="text-sm text-amber-950">Remove this offer from review totals and charts? Its capture and outcome are preserved, and you can restore it later.</p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" disabled={removalPending} onClick={() => setConfirmRemoval(false)}>Keep offer</Button>
                <Button type="button" size="sm" variant="destructive" disabled={removalPending} onClick={() => void removeOrRestore()}>
                  {removalPending ? 'Removing…' : 'Confirm remove offer'}
                </Button>
              </div>
            </div>
          ) : isRemoved ? (
            <Button type="button" size="sm" variant="outline" disabled={removalPending} onClick={() => void removeOrRestore()}>
              {removalPending ? 'Restoring…' : 'Restore offer'}
            </Button>
          ) : (
            <Button type="button" size="sm" variant="ghost" className="text-gray-600" disabled={removalPending} onClick={() => setConfirmRemoval(true)}>
              Remove offer
            </Button>
          )}
        </div>
      )}
      {!editing && saved.driver_decision ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-gray-700" role="status">Saved: <strong>{decisionLabel(saved.driver_decision)}</strong>{taken(saved.driver_decision) && (reported(saved) ? ` · $${(offerNumber(saved.total_earned) ?? 0).toFixed(2)} reported earnings` : ' · earnings not recorded')}</p>
            <Button type="button" size="sm" variant="outline" onClick={beginEdit}>Edit</Button>
          </div>
          {saved.driver_reasoning && <p className="text-xs text-gray-500 whitespace-pre-wrap break-words">{saved.driver_reasoning}</p>}
        </div>
      ) : (
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}>
          {offer.decision_reasoning && <p className="text-xs text-gray-500">{offer.decision_reasoning}</p>}
          <div className="space-y-1">
            <label htmlFor={`${inputPrefix}-decision`} className="text-xs font-medium text-gray-600">What did you do?</label>
            <Select value={draft.decision} onValueChange={choose} disabled={isPosting}>
              <SelectTrigger id={`${inputPrefix}-decision`} className="bg-white border-gray-300 text-gray-800"><SelectValue placeholder="Choose an outcome" /></SelectTrigger>
              <SelectContent>
                {!parseError && (offer.decision === 'ACCEPT' || offer.decision === 'REJECT') && <SelectItem value="followed">Followed the call</SelectItem>}
                {DECISIONS.map(decision => <SelectItem key={decision} value={decision}>{decisionLabel(decision)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {taken(draft.decision) && <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
            <p className="text-xs font-medium text-gray-600">What did it pay?</p>
            <p className="text-xs text-gray-500">The offered amount is a starting value. Confirm or correct what you received before saving; leave unknown amounts blank.</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {EARNINGS_FIELDS.map(field => <div key={field.key} className="space-y-1">
                <label htmlFor={`${inputPrefix}-${field.key}`} className="text-xs text-gray-500">{field.label}</label>
                <Input id={`${inputPrefix}-${field.key}`} type="number" inputMode="decimal" step="0.01" min="0" max="10000" placeholder="Unknown" value={draft[field.key]} disabled={isPosting} onChange={event => {
                  const nextDraft = { ...draft, [field.key]: event.target.value };
                  markDirty(nextDraft); setDraft(nextDraft);
                }} className="bg-white border-gray-300 text-gray-900" />
              </div>)}
            </div>
            <p className="text-sm text-gray-600">Entered total: <span className="font-semibold text-gray-900 tabular-nums">${draftTotal.toFixed(2)}</span></p>
          </div>}
          {draft.decision && <div className="space-y-1">
            <label htmlFor={`${inputPrefix}-reason`} className="text-xs text-gray-500">{draft.decision === 'Other' ? 'What happened? (optional)' : 'Note (optional)'}</label>
            <textarea id={`${inputPrefix}-reason`} maxLength={2000} rows={2} value={draft.reasoning} disabled={isPosting} onChange={event => {
              const nextDraft = { ...draft, reasoning: event.target.value };
              markDirty(nextDraft); setDraft(nextDraft);
            }} className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900" />
            {draft.decision === 'Other' && <p className="text-xs text-gray-500">Use for an unreadable offer, an app error, or another outcome. It stays separate from accepted and rejected.</p>}
          </div>}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {conflict && <Button type="button" variant="outline" size="sm" onClick={() => { setDraft(draftFrom(latestSaved.current)); setExpectedRevision(revision(latestSaved.current)); setConflict(null); setError(''); }}>Load saved version</Button>}
          <div className="flex justify-end gap-2">
            {(saved.driver_decision || dirty) && <Button type="button" variant="ghost" size="sm" disabled={isPosting} onClick={() => {
              setDraft(draftFrom(latestSaved.current)); setExpectedRevision(revision(latestSaved.current));
              setEditing(!latestSaved.current.driver_decision); setError(''); setConflict(null); clearDirty();
            }}>Cancel</Button>}
            <Button type="submit" size="sm" disabled={isPosting || !draft.decision || !!conflict}>{isPosting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save outcome</Button>
          </div>
        </form>
      )}
    </div>
  );
}
