// client/src/pages/co-pilot/OfferAnalyzerPage.tsx
// 2026-07-03 (todo #10): Offer Analyzer — Siri Shortcut setup, per-driver offer
// rules editor (v3 ruleset, design §8), and live offer history with outcome capture.
// Form state maps 1:1 to the config JSON: GET /rules → form.reset(config);
// Save = PUT the full config (server bumps version). Explicit sticky Save —
// this app has no autosave. Section components live in components/offer-analyzer/.
// 2026-08-17 (race review finding #4): the PUT carries expected_version (the version
// this page loaded); the server answers 409 if another tab/device saved first, and
// on success returns the canonical config + new version — no second GET, so a slider
// moved during the round-trip is kept (reset with keepValues) instead of clobbered.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useRunSetup } from '@/contexts/run-setup-context';
import { DRIVER_SERVICES, normalizeSelectedServices } from '@shared/driver-services.js';
import { useNavigate } from 'react-router-dom';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/useToast';
import { API_ROUTES } from '@/constants/apiRoutes';
import { useLocation } from '@/contexts/location-context-clean';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { todayForDriver } from '@/lib/offer-local-date';
import {
  DEFAULT_OFFER_RULESET_CONFIG,
  offerRulesetSchema,
  type OfferRulesetConfig,
} from '@/lib/offer-ruleset-schema';
import SetupCard from '@/components/offer-analyzer/SetupCard';
import RateTargetsCard from '@/components/offer-analyzer/RateTargetsCard';
import DeliveryCard from '@/components/offer-analyzer/DeliveryCard';
import GatesCard from '@/components/offer-analyzer/GatesCard';
import LimitsCard from '@/components/offer-analyzer/LimitsCard';
import GeographyCard from '@/components/offer-analyzer/GeographyCard';
import VisionRulesCard from '@/components/offer-analyzer/VisionRulesCard';
import OffersCard from '@/components/offer-analyzer/OffersCard';
import OffersDecisionChart from '@/components/offer-analyzer/OffersDecisionChart';
import { ArrowLeft, Gauge, Loader2, Save } from 'lucide-react';

interface RulesMeta {
  version: number | null; // null = defaults (no saved row yet)
  isDefault: boolean;
  fromProfile?: boolean;
}

export default function OfferAnalyzerPage() {
  const { user, token } = useAuth();
  return user && token ? <OfferAnalyzerEditor key={`${user.userId}:${token}`} token={token} /> : null;
}

function OfferAnalyzerEditor({ token }: { token: string }) {
  const runSetup = useRunSetup();
  const serviceSelection = useMemo(() => {
    if (!runSetup.setup?.profile) return { loaded: false, services: null, error: null };
    try { return { loaded: true, services: normalizeSelectedServices(runSetup.setup.profile.selectedServices), error: null }; }
    catch (error) { return { loaded: true, services: null, error: error instanceof Error ? error.message : 'Saved services could not be confirmed.' }; }
  }, [runSetup.setup]);
  const hasRideServices = serviceSelection.services === null || serviceSelection.services.some(service => service !== 'delivery');
  const hasDelivery = serviceSelection.services === null || serviceSelection.services.includes('delivery');
  const active = useRef(true);
  const savingRef = useRef(false);
  const loadRevision = useRef(0);
  const baseline = useRef<OfferRulesetConfig | null>(null);
  const restoredDraft = useRef(runSetup.getEditorDraft<{ values: OfferRulesetConfig; version: number | null; conflict: boolean }>('offerAnalyzer'));
  const draftVersion = useRef<number | null>(null);
  const conflictRef = useRef(false);
  const lastDraftReset = useRef(runSetup.draftResetVersion);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { timeZone } = useLocation();
  const [isSaving, setIsSaving] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [meta, setMeta] = useState<RulesMeta | null>(null);
  const [activeTab, setActiveTab] = useState('gates');
  const [chartRefreshToken, setChartRefreshToken] = useState(0);
  // SSE reconnects deliver a state handshake. Keep this callback stable so
  // refreshing counts does not reconnect the offer stream and repeat that loop.
  const refreshChart = useCallback(() => setChartRefreshToken(value => value + 1), []);
  const [selectedDate, setSelectedDate] = useState(() => todayForDriver(timeZone));
  const [dateWasChosen, setDateWasChosen] = useState(false);
  const [rulesConflict, setRulesConflict] = useState(false);

  useEffect(() => {
    if (!dateWasChosen) setSelectedDate(todayForDriver(timeZone));
  }, [timeZone, dateWasChosen]);
  useEffect(() => {
    if (dateWasChosen) return;
    const interval = window.setInterval(() => setSelectedDate(todayForDriver(timeZone)), 60_000);
    const refresh = () => setSelectedDate(todayForDriver(timeZone));
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refresh); };
  }, [dateWasChosen, timeZone]);

  const form = useForm<OfferRulesetConfig>({
    // Cast: same react-hook-form@7.71 / @hookform/resolvers@5.2.2 generic mismatch
    // documented in SettingsPage.tsx.
    resolver: zodResolver(offerRulesetSchema) as unknown as Resolver<OfferRulesetConfig>,
    defaultValues: DEFAULT_OFFER_RULESET_CONFIG,
  });

  useEffect(() => {
    const rememberDraft = () => {
      if (!baseline.current) return;
      const values = form.getValues();
      runSetup.setEditorDraft('offerAnalyzer', JSON.stringify(values) === JSON.stringify(baseline.current) ? null
        : { values, version: draftVersion.current, conflict: conflictRef.current });
    };
    const subscription = form.watch(rememberDraft);
    return () => subscription.unsubscribe();
  }, [form, runSetup.setEditorDraft]);

  useEffect(() => {
    if (lastDraftReset.current === runSetup.draftResetVersion) return;
    lastDraftReset.current = runSetup.draftResetVersion;
    restoredDraft.current = null;
    conflictRef.current = false;
    if (runSetup.setup?.rules) {
      baseline.current = runSetup.setup.rules;
      draftVersion.current = runSetup.setup.rulesVersion;
      setMeta({ version: runSetup.setup.rulesVersion, isDefault: runSetup.setup.rulesVersion == null });
    }
    if (baseline.current) form.reset(baseline.current);
    setRulesConflict(false);
  }, [form, runSetup.draftResetVersion]);

  // silent = refresh version/config after a save without unmounting the editor.
  const loadRules = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      const request = ++loadRevision.current;
      if (!opts.silent) setLoadState('loading');
      try {
        const res = await fetch(API_ROUTES.OFFER_ANALYZER.RULES, {
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`GET rules failed (${res.status})`);
        const data = await res.json();
        if (!active.current || request !== loadRevision.current) return;
        // Fail loud on shape drift: the server contract is a v3-migrated config.
        const parsed = offerRulesetSchema.safeParse(data.config);
        if (!parsed.success) {
          console.error('[OfferAnalyzer] rules config failed v3 validation:', parsed.error);
          throw new Error('Rules payload did not match the expected v3 shape');
        }
        baseline.current = parsed.data;
        draftVersion.current = data.version == null ? null : Number(data.version);
        conflictRef.current = !!restoredDraft.current && (restoredDraft.current.conflict || restoredDraft.current.version !== draftVersion.current);
        form.reset(restoredDraft.current?.values ?? parsed.data);
        restoredDraft.current = null;
        setRulesConflict(conflictRef.current);
        setMeta({
          version: data.version == null ? null : Number(data.version),
          isDefault: Boolean(data.is_default),
          fromProfile: data.source === 'profile',
        });
        setLoadState('ready');
      } catch (err) {
        if (!active.current || request !== loadRevision.current) return;
        console.error('[OfferAnalyzer] failed to load rules:', err);
        if (opts.silent) return; // save already succeeded; keep the editor up
        setLoadState('error');
      }
    },
    [form, token]
  );

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const onSubmit = async (config: OfferRulesetConfig) => {
    if (savingRef.current || !active.current) return;
    if (rulesConflict) {
      toast({ title: 'Rules changed elsewhere', description: 'Your draft is still here. Load the latest rules before saving again.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    savingRef.current = true;
    const releaseSave = runSetup.beginSave();
    try {
      // Server contract: PUT body is { config, expected_version } (server/api/offer-analyzer/index.js).
      // expected_version = what this page loaded (null = defaults, no saved row yet).
      const res = await fetch(API_ROUTES.OFFER_ANALYZER.RULES, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ config, expected_version: meta?.version ?? null }),
      });
      if (!active.current) return;
      if (res.status === 409) {
        // Preserve local edits. An explicit reload is required before further saves so
        // a stale whole-ruleset payload never overwrites the other device's changes.
        await res.json().catch(() => null);
        conflictRef.current = true;
        runSetup.setEditorDraft('offerAnalyzer', { values: form.getValues(), version: draftVersion.current, conflict: true });
        setRulesConflict(true);
        toast({
          title: 'Rules changed elsewhere',
          description: 'Your draft was not saved and remains here. Review or copy your edits, then explicitly load the latest rules before saving.',
          variant: 'destructive',
        });
        return;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Save failed (${res.status})${text ? `: ${text.slice(0, 200)}` : ''}`);
      }
      const saved = await res.json();
      if (!active.current) return;
      const canonical = offerRulesetSchema.safeParse(saved.config);
      if (canonical.success && Number.isInteger(saved.version) && saved.version > 0) {
        // Edits made while the save was in flight survive: keepValues keeps the inputs
        // and makes the stored config the new defaultValues baseline (RHF 7.71 _reset:
        // isDirty reads false until the next change; Save is not gated on dirty state).
        const editedDuringSave = JSON.stringify(form.getValues()) !== JSON.stringify(config);
        baseline.current = canonical.data;
        draftVersion.current = saved.version;
        form.reset(canonical.data, editedDuringSave ? { keepValues: true } : undefined);
        runSetup.setEditorDraft('offerAnalyzer', JSON.stringify(form.getValues()) === JSON.stringify(canonical.data) ? null
          : { values: form.getValues(), version: saved.version, conflict: false });
        setMeta({ version: saved.version == null ? null : Number(saved.version), isDefault: false });
        toast({
          title: 'Rules saved',
          description: editedDuringSave
            ? 'Your offer rules are now active. You changed something while saving — Save again to store it.'
            : 'Your offer rules are now active.',
        });
        // Keep the editor mounted beneath the common saved-setup review popup.
        await runSetup.finishSave();
      } else {
        throw new Error('Saved rules could not be confirmed. Your draft is preserved and Strategy remains held.');
      }
    } catch (err) {
      if (!active.current) return;
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save rules',
        variant: 'destructive',
      });
    } finally {
      releaseSave();
      savingRef.current = false;
      if (active.current) setIsSaving(false);
    }
  };

  const onInvalid = () => {
    console.warn('[OfferAnalyzer] validation errors:', form.formState.errors);
    toast({
      title: 'Check your rules',
      description: 'Some rule values are invalid — nothing was saved.',
      variant: 'destructive',
    });
  };

  const rulesTab = ['gates', 'rates', 'rules'].includes(activeTab);
  return (
    <div className="container max-w-2xl mx-auto px-3 py-4 pb-24 space-y-4 sm:px-4 sm:py-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="shrink-0">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Gauge className="h-6 w-6 text-blue-500" />
            Offer Analyzer
          </h1>
          <p className="text-gray-500 text-sm">Your rules for the spoken accept/reject call</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList aria-label="Offer Analyzer sections" className="grid h-auto w-full grid-cols-5 gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1">
          <TabsTrigger value="gates" className="min-w-0 whitespace-normal px-1 py-2 text-center text-xs leading-tight sm:px-1.5 sm:text-sm">Gates</TabsTrigger>
          <TabsTrigger value="rates" className="min-w-0 whitespace-normal px-1 py-2 text-center text-xs leading-tight sm:px-1.5 sm:text-sm">Rates</TabsTrigger>
          <TabsTrigger value="rules" className="min-w-0 whitespace-normal px-1 py-2 text-center text-xs leading-tight sm:px-1.5 sm:text-sm">Rules &amp; Setup</TabsTrigger>
          <TabsTrigger value="daily" className="min-w-0 whitespace-normal px-1 py-2 text-center text-xs leading-tight sm:px-1.5 sm:text-sm">Daily Offers</TabsTrigger>
          <TabsTrigger value="charts" className="min-w-0 whitespace-normal px-1 py-2 text-center text-xs leading-tight sm:px-1.5 sm:text-sm">Charts</TabsTrigger>
        </TabsList>

        {loadState === 'loading' && (
          <div className="flex items-center justify-center py-12" role="status" aria-label="Loading offer rules">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        )}
        {loadState === 'error' && (
          <Alert>
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>Could not load your offer rules.</span>
              <Button type="button" variant="outline" size="sm" onClick={() => loadRules()}>Retry</Button>
            </AlertDescription>
          </Alert>
        )}

        {loadState === 'ready' && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Your rules</span>
              {meta?.isDefault && <Badge variant="outline">{meta.fromProfile ? 'from your profile' : 'using defaults'}</Badge>}
            </div>
            <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700">
              {!serviceSelection.loaded ? <p role="status">Confirming your saved services…</p>
                : serviceSelection.error ? <p role="alert">{serviceSelection.error}</p>
                : serviceSelection.services === null ? <p>You haven’t chosen services yet. Your existing offer limits still apply. Choose services in Preferences to show fewer controls.</p>
                : <p>Offer controls for: {DRIVER_SERVICES.filter(service => serviceSelection.services!.includes(service.id)).map(service => service.label).join(', ') || 'no services selected'}.</p>}
              <Button type="button" variant="outline" size="sm" onClick={() => { runSetup.editSetup(); navigate('/co-pilot/settings'); }}>Choose services in Preferences</Button>
            </div>
            <form
              onSubmit={form.handleSubmit(onSubmit, onInvalid)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault(); }}
              className="space-y-4"
            >
              {rulesConflict && <Alert role="alert" className="border-amber-400">
                <AlertDescription className="space-y-2">
                  <p>Rules changed on another device. Your draft is still in these tabs, but Save is paused to prevent overwriting newer settings. Review or copy it first.</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => void loadRules({ silent: true })}>Discard this draft and load saved rules</Button>
                </AlertDescription>
              </Alert>}
              <TabsContent value="gates" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                {serviceSelection.loaded && !serviceSelection.error && hasRideServices && <GatesCard form={form} />}
                {serviceSelection.loaded && !serviceSelection.error && !hasRideServices && <p className="text-sm text-gray-600">Ride gates are hidden because no ride services are selected. Saved ride rules are preserved.</p>}
              </TabsContent>
              <TabsContent value="rates" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                {serviceSelection.loaded && !serviceSelection.error && <RateTargetsCard form={form} selectedServices={serviceSelection.services} />}
                {serviceSelection.loaded && !serviceSelection.error && hasDelivery && <DeliveryCard form={form} />}
              </TabsContent>
              <TabsContent value="rules" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                <SetupCard />
                {meta?.isDefault && (
                  <Alert><AlertDescription>{meta.fromProfile
                    ? 'Available shared-ride and pickup preferences from your profile initialize these rules. Save your analyzer rules here to keep a separate set of offer limits; later profile edits will not overwrite them.'
                    : 'You are using initial rules. Review and save your own limits before relying on an offer decision.'}</AlertDescription></Alert>
                )}
                {serviceSelection.loaded && !serviceSelection.error && hasRideServices && <LimitsCard form={form} />}
                {serviceSelection.loaded && !serviceSelection.error && hasRideServices && <GeographyCard form={form} />}
                {serviceSelection.loaded && !serviceSelection.error && hasRideServices && <VisionRulesCard form={form} />}
              </TabsContent>
              <div className={`sticky bottom-20 z-20 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent pt-4 ${rulesTab ? '' : 'hidden'}`}>
                <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 shadow-md" disabled={isSaving || rulesConflict}>
                  {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : <><Save className="mr-2 h-4 w-4" />Save and review</>}
                </Button>
              </div>
            </form>
          </>
        )}
        <TabsContent value="daily" forceMount className="mt-0 data-[state=inactive]:hidden">
          <OffersCard selectedDate={selectedDate} onSelectedDateChange={(date) => {
            setDateWasChosen(true);
            setSelectedDate(date);
          }} onDataChanged={refreshChart} />
        </TabsContent>
        <TabsContent value="charts" forceMount className="mt-0 data-[state=inactive]:hidden">
          <OffersDecisionChart
            refreshToken={String(chartRefreshToken)}
            selectedDate={selectedDate}
            onSelectedDateChange={(date) => {
              setDateWasChosen(true);
              setSelectedDate(date);
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
