// client/src/components/offer-analyzer/RateTargetsCard.tsx
// 2026-07-03 (todo #10): per-tier rate targets.
// 2026-08-17 (Melody, D4 — "I'd really just like the sliders… preset sliders so end
// users don't type in bad data"): the accept-ladder rung editor is gone. Each tier is
// FOUR sliders — floor $/mi, optional $/min floor, max trip minutes, optional max total
// miles — and the engine's ladder is DERIVED as one rung { min_per_mile: floor,
// max_total_min } (offer-ruleset-schema.ts withDerivedLadder). A saved legacy
// multi-rung ladder round-trips untouched until the tier is edited, then collapses.
// The "$/hr" switch is telemetry only (global.notices.hourly_rate): the server computes
// pay ÷ minutes × 60 and shows/speaks it — never a decider (2026-08-11/14 doctrine).
// standard/premium always exist; comfort/xl are optional split-outs (null = inert).

import { useWatch, type UseFormReturn } from 'react-hook-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { SliderRow, SwitchRow } from './controls';
import type { OfferRulesetConfig, TierConfig } from '@/lib/offer-ruleset-schema';
import { ENABLE_SEEDS, tierMaxTripMinutes, withDerivedLadder } from '@/lib/offer-ruleset-schema';
import { DollarSign } from 'lucide-react';

interface Props {
  form: UseFormReturn<OfferRulesetConfig>;
}

interface TierEditorProps {
  title: string;
  tier: TierConfig;
  onChange: (tier: TierConfig) => void;
}

/** One-line human preview of the tier's single accept rule. */
function describeTier(tier: TierConfig, maxMin: number): string {
  const parts = [`≥ $${tier.floor_per_mile.toFixed(2)}/mi`];
  if (tier.floor_per_minute != null) parts.push(`≥ $${tier.floor_per_minute.toFixed(2)}/min`);
  parts.push(`≤ ${maxMin} min`);
  if (tier.max_total_miles != null) parts.push(`≤ ${tier.max_total_miles} mi`);
  return `Accept when ${parts.join(' · ')} — otherwise reject.`;
}

function TierEditor({ title, tier, onChange }: TierEditorProps) {
  const maxMin = tierMaxTripMinutes(tier);
  // Every slider change re-derives the single rung so the engine and the sliders
  // can never disagree (the ladder is not editable anywhere anymore).
  const set = (patch: Partial<TierConfig>, nextMaxMin: number = maxMin) =>
    onChange(withDerivedLadder({ ...tier, ...patch }, nextMaxMin));

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>

      <SliderRow
        label="Floor $/mi"
        value={tier.floor_per_mile}
        min={0.5}
        max={4.0}
        step={0.05}
        format={(v) => `$${v.toFixed(2)}/mi`}
        onChange={(v) => set({ floor_per_mile: v })}
        help="Anything under this per-mile rate is rejected outright."
      />

      <SwitchRow
        label="Per-minute floor"
        checked={tier.floor_per_minute != null}
        onCheckedChange={(on) => set({ floor_per_minute: on ? 0.5 : null })}
        help="Also reject offers below a $/min rate."
      />
      {tier.floor_per_minute != null && (
        <SliderRow
          label="Floor $/min"
          value={tier.floor_per_minute}
          min={0.1}
          max={2.0}
          step={0.05}
          format={(v) => `$${v.toFixed(2)}/min`}
          onChange={(v) => set({ floor_per_minute: v })}
        />
      )}

      <SliderRow
        label="Max trip minutes"
        value={maxMin}
        min={5}
        max={60}
        step={1}
        format={(v) => `${Math.round(v)} min`}
        onChange={(v) => set({}, v)}
        help="Pickup + ride. Longer offers are rejected even at a good rate."
      />

      <SwitchRow
        label="Max total miles"
        checked={tier.max_total_miles != null}
        onCheckedChange={(on) => set({ max_total_miles: on ? 12 : null })}
        help="Cap the total distance (pickup + ride). Off — no distance cap for this tier."
      />
      {tier.max_total_miles != null && (
        <SliderRow
          label="Max miles"
          value={tier.max_total_miles}
          min={2}
          max={40}
          step={1}
          format={(v) => `${Math.round(v)} mi`}
          onChange={(v) => set({ max_total_miles: Math.round(v) })}
        />
      )}

      <p className="text-xs text-gray-500">{describeTier(tier, maxMin)}</p>
    </div>
  );
}

export default function RateTargetsCard({ form }: Props) {
  const tiers = useWatch({ control: form.control, name: 'tiers' });
  const notices = useWatch({ control: form.control, name: 'global.notices' });

  const setHourly = (on: boolean) => {
    const next = {
      verified_rider: notices?.verified_rider ?? false,
      on_the_way_filter: notices?.on_the_way_filter ?? false,
      deadhead_reduction: notices?.deadhead_reduction ?? false,
      hourly_rate: on,
    };
    const allOff = !next.verified_rider && !next.on_the_way_filter && !next.deadhead_reduction && !next.hourly_rate;
    form.setValue('global.notices', allOff ? null : next, { shouldDirty: true });
  };

  return (
    <Card className="bg-white border-gray-200 shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <DollarSign className="h-5 w-5 text-green-500" />
          Rate Targets
        </CardTitle>
        <CardDescription>Sliders only — one accept rule per ride tier</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SwitchRow
          label="Show $/hr in results"
          checked={notices?.hourly_rate ?? false}
          onCheckedChange={setHourly}
          help="Pay ÷ total minutes, computed from the offer and added to the notification and the spoken line. Information only — it never changes the decision."
        />

        <Separator className="bg-gray-200" />

        <TierEditor
          title="Standard (UberX, Lyft)"
          tier={tiers.standard}
          onChange={(t) => form.setValue('tiers.standard', t, { shouldDirty: true })}
        />

        <Separator className="bg-gray-200" />

        <TierEditor
          title="Premium (Black, Lux)"
          tier={tiers.premium}
          onChange={(t) => form.setValue('tiers.premium', t, { shouldDirty: true })}
        />

        <Separator className="bg-gray-200" />

        <SwitchRow
          label="Separate Comfort rules"
          checked={tiers.comfort != null}
          onCheckedChange={(on) =>
            form.setValue('tiers.comfort', on ? { ...ENABLE_SEEDS.comfort_tier } : null, { shouldDirty: true })
          }
          help="Off — Comfort offers follow your existing tier rules."
        />
        {tiers.comfort && (
          <TierEditor
            title="Comfort"
            tier={tiers.comfort}
            onChange={(t) => form.setValue('tiers.comfort', t, { shouldDirty: true })}
          />
        )}

        <Separator className="bg-gray-200" />

        <SwitchRow
          label="Separate XL rules"
          checked={tiers.xl != null}
          onCheckedChange={(on) =>
            form.setValue('tiers.xl', on ? { ...ENABLE_SEEDS.xl_tier } : null, { shouldDirty: true })
          }
          help="Off — XL offers follow your existing tier rules."
        />
        {tiers.xl && (
          <TierEditor
            title="XL (UberXL, Lyft XL)"
            tier={tiers.xl}
            onChange={(t) => form.setValue('tiers.xl', t, { shouldDirty: true })}
          />
        )}
      </CardContent>
    </Card>
  );
}
