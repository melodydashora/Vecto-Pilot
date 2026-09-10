// client/src/components/offer-analyzer/DeliveryCard.tsx
// 2026-08-26 (v3.2; Melody 2026-08-24: delivery is its own lane, vision by default).
// Delivery cards carry one "N min (X mi) total" line and no rating/Verified/pickup split,
// so the ride sliders never see them. Three knobs + an enable switch, same PUT /rules
// optimistic-concurrency flow as every other card. $/hr IS a decider here (unlike rides,
// where hourly is telemetry only): price ÷ total minutes × 60 against the hourly floor.
// Off → the analyzer answers "No data. Delivery offers are off in your rules."

import { useWatch, type UseFormReturn } from 'react-hook-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SliderRow, SwitchRow } from './controls';
import type { OfferRulesetConfig, DeliveryConfig } from '@/lib/offer-ruleset-schema';
import { ENABLE_SEEDS } from '@/lib/offer-ruleset-schema';
import { Package } from 'lucide-react';

interface Props {
  form: UseFormReturn<OfferRulesetConfig>;
}

function describeDelivery(d: DeliveryConfig): string {
  if (!d.enabled) return 'Delivery offers are answered "No data — delivery is off in your rules."';
  const parts: string[] = [];
  if (d.min_per_mile != null) parts.push(`≥ $${d.min_per_mile.toFixed(2)}/mi`);
  if (d.min_per_hour != null) parts.push(`≥ $${Math.round(d.min_per_hour)}/hr`);
  if (d.max_total_miles != null) parts.push(`≤ ${Math.round(d.max_total_miles)} mi total`);
  return parts.length
    ? `Accept a delivery when ${parts.join(' · ')} — otherwise reject.`
    : 'No floors set — every readable delivery is accepted.';
}

export default function DeliveryCard({ form }: Props) {
  const delivery = useWatch({ control: form.control, name: 'delivery' });
  const set = (patch: Partial<DeliveryConfig>) =>
    form.setValue('delivery', { ...delivery, ...patch }, { shouldDirty: true });

  return (
    <Card className="bg-white border-gray-200 shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Package className="h-5 w-5 text-violet-500" />
          Delivery
        </CardTitle>
        <CardDescription>Food and package offers — judged on the card&apos;s one total line</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SwitchRow
          label="Analyze delivery offers"
          checked={delivery.enabled}
          onCheckedChange={(on) => set({ enabled: on })}
          help="Off — a delivery card gets “No data” instead of a verdict."
        />

        {delivery.enabled && (
          <div className="space-y-4 rounded-lg border border-gray-200 p-3">
            {/* A null floor is a real state (the server skips that gate) — show it as OFF
                rather than rendering a seed value the engine is not applying. */}
            <SwitchRow
              label="Per-mile floor"
              checked={delivery.min_per_mile != null}
              onCheckedChange={(on) => set({ min_per_mile: on ? ENABLE_SEEDS.delivery.min_per_mile : null })}
              help="Off — deliveries are judged on the hourly (and the distance cap) only."
            />
            {delivery.min_per_mile != null && (
              <SliderRow
                label="Floor $/mi"
                value={delivery.min_per_mile}
                min={0.5}
                max={5.0}
                step={0.05}
                format={(v) => `$${v.toFixed(2)}/mi`}
                onChange={(v) => set({ min_per_mile: v })}
                help="Pay ÷ total miles (store leg + drop leg)."
              />
            )}
            <SwitchRow
              label="Hourly floor"
              checked={delivery.min_per_hour != null}
              onCheckedChange={(on) => set({ min_per_hour: on ? ENABLE_SEEDS.delivery.min_per_hour : null })}
              help="Off — no hourly gate. With it on, a delivery whose minutes cannot be read is answered “No data”, never guessed."
            />
            {delivery.min_per_hour != null && (
              <SliderRow
                label="Floor $/hr"
                value={delivery.min_per_hour}
                min={10}
                max={60}
                step={1}
                format={(v) => `$${Math.round(v)}/hr`}
                onChange={(v) => set({ min_per_hour: Math.round(v) })}
                help="Pay ÷ total minutes × 60. Deliveries are decided on the hourly too — an expected tip is counted in the pay."
              />
            )}
            <SwitchRow
              label="Max total miles"
              checked={delivery.max_total_miles != null}
              onCheckedChange={(on) => set({ max_total_miles: on ? ENABLE_SEEDS.delivery.max_total_miles : null })}
              help="Cap the total distance. Off — no distance cap for deliveries."
            />
            {delivery.max_total_miles != null && (
              <SliderRow
                label="Max miles"
                value={delivery.max_total_miles}
                min={2}
                max={40}
                step={1}
                format={(v) => `${Math.round(v)} mi`}
                onChange={(v) => set({ max_total_miles: Math.round(v) })}
              />
            )}
          </div>
        )}

        <p className="text-xs text-gray-500">{describeDelivery(delivery)}</p>
      </CardContent>
    </Card>
  );
}
