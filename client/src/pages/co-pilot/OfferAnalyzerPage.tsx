// client/src/pages/co-pilot/OfferAnalyzerPage.tsx
// 2026-07-03 (todo #10): Offer Analyzer — Siri Shortcut setup, per-driver offer
// rules editor (v3 ruleset, design §8), and live offer history with outcome capture.
// Form state maps 1:1 to the config JSON: GET /rules → form.reset(config);
// Save = PUT the full config (server bumps version). Explicit sticky Save —
// this app has no autosave. Section components live in components/offer-analyzer/.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/useToast';
import { getAuthHeader } from '@/utils/co-pilot-helpers';
import { API_ROUTES } from '@/constants/apiRoutes';
import {
  DEFAULT_OFFER_RULESET_CONFIG,
  offerRulesetSchema,
  type OfferRulesetConfig,
} from '@/lib/offer-ruleset-schema';
import SetupCard from '@/components/offer-analyzer/SetupCard';
import RateTargetsCard from '@/components/offer-analyzer/RateTargetsCard';
import GatesCard from '@/components/offer-analyzer/GatesCard';
import LimitsCard from '@/components/offer-analyzer/LimitsCard';
import GeographyCard from '@/components/offer-analyzer/GeographyCard';
import VisionRulesCard from '@/components/offer-analyzer/VisionRulesCard';
import OffersCard from '@/components/offer-analyzer/OffersCard';
import { ArrowLeft, Gauge, Loader2, Save } from 'lucide-react';

interface RulesMeta {
  version: number | null; // null = defaults (no saved row yet)
  isDefault: boolean;
}

export default function OfferAnalyzerPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [meta, setMeta] = useState<RulesMeta | null>(null);

  const form = useForm<OfferRulesetConfig>({
    // Cast: same react-hook-form@7.71 / @hookform/resolvers@5.2.2 generic mismatch
    // documented in SettingsPage.tsx.
    resolver: zodResolver(offerRulesetSchema) as unknown as Resolver<OfferRulesetConfig>,
    defaultValues: DEFAULT_OFFER_RULESET_CONFIG,
  });

  // silent = refresh version/config after a save without unmounting the editor.
  const loadRules = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!opts.silent) setLoadState('loading');
      try {
        const res = await fetch(API_ROUTES.OFFER_ANALYZER.RULES, {
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        });
        if (!res.ok) throw new Error(`GET rules failed (${res.status})`);
        const data = await res.json();
        // Fail loud on shape drift: the server contract is a v3-migrated config.
        const parsed = offerRulesetSchema.safeParse(data.config);
        if (!parsed.success) {
          console.error('[OfferAnalyzer] rules config failed v3 validation:', parsed.error);
          throw new Error('Rules payload did not match the expected v3 shape');
        }
        form.reset(parsed.data);
        setMeta({
          version: data.version == null ? null : Number(data.version),
          isDefault: Boolean(data.is_default),
        });
        setLoadState('ready');
      } catch (err) {
        console.error('[OfferAnalyzer] failed to load rules:', err);
        if (opts.silent) return; // save already succeeded; keep the editor up
        setLoadState('error');
      }
    },
    [form]
  );

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const onSubmit = async (config: OfferRulesetConfig) => {
    setIsSaving(true);
    try {
      // Server contract: PUT body is { config } (server/api/offer-analyzer/index.js)
      const res = await fetch(API_ROUTES.OFFER_ANALYZER.RULES, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ config }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Save failed (${res.status})${text ? `: ${text.slice(0, 200)}` : ''}`);
      }
      toast({ title: 'Rules saved', description: 'Your offer rules are now active.' });
      await loadRules({ silent: true }); // pick up the bumped version + canonical config
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save rules',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
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

  return (
    <div className="container max-w-2xl mx-auto px-4 py-6 pb-24 space-y-6">
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
          <p className="text-gray-500 text-sm">Your rules for the 3-second accept/reject call</p>
        </div>
      </div>

      <SetupCard />

      {loadState === 'loading' && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      )}

      {loadState === 'error' && (
        <Alert>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>Could not load your offer rules.</span>
            <Button type="button" variant="outline" size="sm" onClick={() => loadRules()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {loadState === 'ready' && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">Your rules</span>
            {meta?.version != null && <Badge variant="secondary">v{meta.version}</Badge>}
            {meta?.isDefault && <Badge variant="outline">using defaults</Badge>}
          </div>
          {meta?.isDefault && (
            <Alert>
              <AlertDescription>
                You're on default rules — save any change to create your own.
              </AlertDescription>
            </Alert>
          )}

          {/* No <Form> provider needed: every control binds via useWatch + setValue,
              not FormField. Validation still runs through the zodResolver on submit. */}
          <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-6">
            <RateTargetsCard form={form} />
            <GatesCard form={form} />
            <LimitsCard form={form} />
            <GeographyCard form={form} />
            <VisionRulesCard form={form} />

            {/* Explicit save — sticky above the bottom nav (no autosave in this app) */}
            <div className="sticky bottom-20 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent pt-4">
              <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save Rules
                  </>
                )}
              </Button>
            </div>
          </form>
        </>
      )}

      <OffersCard />
    </div>
  );
}
