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
// standard/premium remain in stored config; selected services control visibility.
// comfort/xl are optional split-outs (null = inert), independent of selection.
// 2026-10-17 (Melody): ride-type sliders are BOUNDED by the gates — Max trip minutes by
// the total time limit, Max miles by the max pickup miles. A saved value already outside
// the bound is shown with a warning and left alone (never silently rewritten); the engine
// lets the time-limit pay exception waive the ride-type minute cap (rules-engine.js).

import { useWatch, type UseFormReturn } from 'react-hook-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { SliderRow, SwitchRow } from './controls';
import type { OfferRulesetConfig, TierConfig } from '@/lib/offer-ruleset-schema';
import { ENABLE_SEEDS, tierMaxTripMinutes, withDerivedLadder } from '@/lib/offer-ruleset-schema';
import { selectedServiceRateGroups } from '@shared/driver-services.js';
import { DollarSign } from 'lucide-react';

interface Props {
  form: UseFormReturn<OfferRulesetConfig>;
  selectedServices?: readonly string[] | null;
}

/** Gate values that bound the ride-type sliders (null = that gate is off). */
export interface TierBounds {
  maxTripMinutes: number | null;   // global.time_limit.max_total_minutes
  minTotalMiles: number | null;    // global.pickup_limits.max_miles
}

interface TierEditorProps {
  title: string;
  tier: TierConfig;
  bounds: TierBounds;
  onChange: (tier: TierConfig) => void;
}

const MINUTES_RANGE = { min: 5, max: 60 } as const;
const MILES_RANGE = { min: 2, max: 40 } as const;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** One-line human preview of the tier's single accept rule. */
function describeTier(tier: TierConfig, maxMin: number): string {
  const parts = [`≥ $${tier.floor_per_mile.toFixed(2)}/mi`];
  if (tier.floor_per_minute != null) parts.push(`≥ $${tier.floor_per_minute.toFixed(2)}/min`);
  parts.push(`≤ ${maxMin} min`);
  if (tier.max_total_miles != null) parts.push(`≤ ${tier.max_total_miles} mi`);
  return `Accept when ${parts.join(' · ')} — otherwise reject.`;
}

function TierEditor({ title, tier, bounds, onChange }: TierEditorProps) {
  const maxMin = tierMaxTripMinutes(tier);
  // The slider primitive needs max > min; a bound at or past the range's edge keeps one step of room.
  const minutesCap = bounds.maxTripMinutes != null ? clamp(bounds.maxTripMinutes, MINUTES_RANGE.min + 1, MINUTES_RANGE.max) : MINUTES_RANGE.max;
  const milesFloor = bounds.minTotalMiles != null ? clamp(bounds.minTotalMiles, MILES_RANGE.min, MILES_RANGE.max - 1) : MILES_RANGE.min;
  const milesBoundBeyondRange = bounds.minTotalMiles != null && bounds.minTotalMiles > MILES_RANGE.max;
  // A legacy multi-rung ladder shows its first band here; the bound warning is for the
  // derived single rung the sliders write (moving the slider collapses a legacy ladder).
  const derived = tier.accept_ladder.length === 1;
  const minutesOutOfBounds = bounds.maxTripMinutes != null && maxMin > bounds.maxTripMinutes;
  const milesOutOfBounds = bounds.minTotalMiles != null && tier.max_total_miles != null && tier.max_total_miles < bounds.minTotalMiles;
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
        min={MINUTES_RANGE.min}
        max={minutesCap}
        step={1}
        format={(v) => `${Math.round(v)} min`}
        onChange={(v) => set({}, v)}
        help={bounds.maxTripMinutes != null
          ? `Pickup + ride. Capped by your ${bounds.maxTripMinutes}-min total time limit.`
          : 'Pickup + ride. Longer offers are rejected even at a good rate.'}
      />
      {minutesOutOfBounds && derived && (
        <p className="text-xs text-amber-700" role="note">
          Saved {maxMin} min is above your {bounds.maxTripMinutes}-min total time limit. It stays until you move this
          slider; the limit decides first, so only the pay exception can accept past {bounds.maxTripMinutes} min.
        </p>
      )}
      {minutesOutOfBounds && !derived && (
        <p className="text-xs text-gray-500" role="note">
          This ride type still uses its older multi-step rule (first step {maxMin} min); your {bounds.maxTripMinutes}-min
          total time limit decides first. Moving this slider replaces it with one rule inside the limit.
        </p>
      )}

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
          min={milesFloor}
          max={MILES_RANGE.max}
          step={1}
          format={(v) => `${Math.round(v)} mi`}
          onChange={(v) => set({ max_total_miles: Math.round(v) })}
          help={bounds.minTotalMiles != null ? `At least your ${bounds.minTotalMiles}-mi max pickup, so a pickup at the cap still leaves room for the trip.` : undefined}
        />
      )}
      {milesOutOfBounds && !milesBoundBeyondRange && (
        <p className="text-xs text-amber-700" role="note">
          Saved {tier.max_total_miles} mi is below your {bounds.minTotalMiles}-mi max pickup. It stays until you move this
          slider; a pickup at your cap would leave no room for the trip.
        </p>
      )}
      {milesBoundBeyondRange && tier.max_total_miles != null && (
        <p className="text-xs text-amber-700" role="note">
          Your {bounds.minTotalMiles}-mi max pickup is above this slider&apos;s {MILES_RANGE.max}-mi range, so no Max miles
          value here can fit a pickup at that cap. Lower the max pickup under Gates → Limits, or turn this cap off.
        </p>
      )}

      <p className="text-xs text-gray-500">{describeTier(tier, maxMin)}</p>
    </div>
  );
}

export default function RateTargetsCard({ form, selectedServices = null }: Props) {
  const tiers = useWatch({ control: form.control, name: 'tiers' });
  const tierProducts = useWatch({ control: form.control, name: 'tier_products' });
  const notices = useWatch({ control: form.control, name: 'global.notices' });
  const pickupLimits = useWatch({ control: form.control, name: 'global.pickup_limits' });
  const timeLimit = useWatch({ control: form.control, name: 'global.time_limit' });
  const bounds: TierBounds = {
    maxTripMinutes: timeLimit?.max_total_minutes ?? null,
    minTotalMiles: pickupLimits?.max_miles ?? null,
  };
  const routing = { tiers, tier_products: tierProducts };
  const groups = selectedServiceRateGroups(selectedServices, routing);
  const splitGroups = (['comfort', 'xl'] as const).map(tier => ({ tier,
    group: selectedServiceRateGroups(selectedServices, { ...routing, tiers: { ...tiers, [tier]: {} } })
      .find(group => group.tier === tier),
  })).filter(({ group }) => group != null);

  if (!groups.length) return null;

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
        <CardDescription>Rate controls for your saved service selection. Services sharing a saved rate group use the same limits.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SwitchRow
          label="Show $/hr in results"
          checked={notices?.hourly_rate ?? false}
          onCheckedChange={setHourly}
          help="Pay ÷ total minutes, computed from the offer and added to the notification and the spoken line. Information only — it never changes the decision."
        />

        {groups.map(group => {
          const tier = tiers[group.tier];
          return tier ? <div key={group.tier} className="space-y-4" data-rate-tier={group.tier}>
            <Separator className="bg-gray-200" />
            <TierEditor title={group.label} tier={tier} bounds={bounds}
              onChange={value => form.setValue(`tiers.${group.tier}`, value, { shouldDirty: true })} />
          </div> : null;
        })}
        {splitGroups.map(({ tier, group }) => <div key={tier} className="space-y-4">
          <Separator className="bg-gray-200" />
          <SwitchRow label={`Separate ${selectedServices === null ? tier === 'comfort' ? 'Comfort' : 'XL' : group!.label} rules`}
            checked={tiers[tier] != null}
            onCheckedChange={on => form.setValue(`tiers.${tier}`, on ? { ...ENABLE_SEEDS[`${tier}_tier`] } : null, { shouldDirty: true })}
            help="Off — these services use their existing shared rate group. Changing your service selection preserves every saved rate group." />
        </div>)}
      </CardContent>
    </Card>
  );
}
