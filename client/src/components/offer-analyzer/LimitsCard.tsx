// client/src/components/offer-analyzer/LimitsCard.tsx
// 2026-07-03 (todo #10): Pickup limits, total-time limit with its "unless"
// pay-rate conjunction, and acceptance-rate protection (design §3 global.*).
// Each rule is null when its enable-switch is off (inert = null).

import { useWatch, type UseFormReturn } from 'react-hook-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { SliderRow, SwitchRow } from './controls';
import type { OfferRulesetConfig } from '@/lib/offer-ruleset-schema';
import { ENABLE_SEEDS } from '@/lib/offer-ruleset-schema';
import { Timer } from 'lucide-react';

interface Props {
  form: UseFormReturn<OfferRulesetConfig>;
}

export default function LimitsCard({ form }: Props) {
  const pickupLimits = useWatch({ control: form.control, name: 'global.pickup_limits' });
  const timeLimit = useWatch({ control: form.control, name: 'global.time_limit' });
  const arp = useWatch({ control: form.control, name: 'global.acceptance_rate_protection' });

  return (
    <Card className="bg-white border-gray-200 shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Timer className="h-5 w-5 text-amber-500" />
          Limits
        </CardTitle>
        <CardDescription>Caps on pickup distance and total trip time</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pickup limits */}
        <SwitchRow
          label="Pickup limits"
          checked={pickupLimits != null}
          onCheckedChange={(on) =>
            form.setValue('global.pickup_limits', on ? { ...ENABLE_SEEDS.pickup_limits } : null, {
              shouldDirty: true,
            })
          }
          help="Reject offers with a long deadhead to reach the rider."
        />
        {pickupLimits && (
          <div className="space-y-4 rounded-lg border border-gray-200 p-3">
            {/* Members are nullish in the schema — fall back to the seed values for display */}
            <SliderRow
              label="Max pickup miles"
              value={pickupLimits.max_miles ?? ENABLE_SEEDS.pickup_limits.max_miles}
              min={1}
              max={15}
              step={1}
              format={(v) => `${v} mi`}
              onChange={(v) =>
                form.setValue('global.pickup_limits', { ...pickupLimits, max_miles: v }, { shouldDirty: true })
              }
            />
            <SliderRow
              label="Max pickup minutes"
              value={pickupLimits.max_minutes ?? ENABLE_SEEDS.pickup_limits.max_minutes}
              min={1}
              max={30}
              step={1}
              format={(v) => `${v} min`}
              onChange={(v) =>
                form.setValue('global.pickup_limits', { ...pickupLimits, max_minutes: v }, { shouldDirty: true })
              }
            />
          </div>
        )}

        <Separator className="bg-gray-200" />

        {/* Total-time limit + unless-conjunction */}
        <SwitchRow
          label="Total time limit"
          checked={timeLimit != null}
          onCheckedChange={(on) =>
            form.setValue(
              'global.time_limit',
              on ? { max_total_minutes: 20, unless: { ...ENABLE_SEEDS.time_limit.unless } } : null,
              { shouldDirty: true }
            )
          }
          help="Reject long trips unless they pay well enough."
        />
        {timeLimit && (
          <div className="space-y-4 rounded-lg border border-gray-200 p-3">
            <SliderRow
              label="Max total minutes"
              value={timeLimit.max_total_minutes}
              min={5}
              max={60}
              step={1}
              format={(v) => `${v} min`}
              onChange={(v) =>
                form.setValue('global.time_limit', { ...timeLimit, max_total_minutes: v }, { shouldDirty: true })
              }
            />
            <p className="text-xs text-gray-500">
              …unless the offer pays at least BOTH rates below:
            </p>
            {/* unless is nullable in the schema — display seeds, write the full pair */}
            <SliderRow
              label="Unless $/mi ≥"
              value={timeLimit.unless?.min_per_mile ?? ENABLE_SEEDS.time_limit.unless.min_per_mile}
              min={0.5}
              max={4.0}
              step={0.05}
              format={(v) => `$${v.toFixed(2)}/mi`}
              onChange={(v) =>
                form.setValue(
                  'global.time_limit',
                  {
                    ...timeLimit,
                    unless: {
                      min_per_mile: v,
                      min_per_minute:
                        timeLimit.unless?.min_per_minute ?? ENABLE_SEEDS.time_limit.unless.min_per_minute,
                    },
                  },
                  { shouldDirty: true }
                )
              }
            />
            <SliderRow
              label="Unless $/min ≥"
              value={timeLimit.unless?.min_per_minute ?? ENABLE_SEEDS.time_limit.unless.min_per_minute}
              min={0.1}
              max={2.0}
              step={0.05}
              format={(v) => `$${v.toFixed(2)}/min`}
              onChange={(v) =>
                form.setValue(
                  'global.time_limit',
                  {
                    ...timeLimit,
                    unless: {
                      min_per_mile:
                        timeLimit.unless?.min_per_mile ?? ENABLE_SEEDS.time_limit.unless.min_per_mile,
                      min_per_minute: v,
                    },
                  },
                  { shouldDirty: true }
                )
              }
            />
          </div>
        )}

        <Separator className="bg-gray-200" />

        {/* Acceptance-rate protection */}
        <SwitchRow
          label="Acceptance rate protection"
          checked={arp != null}
          onCheckedChange={(on) =>
            form.setValue(
              'global.acceptance_rate_protection',
              on ? { ...ENABLE_SEEDS.acceptance_rate_protection } : null,
              { shouldDirty: true }
            )
          }
          help="A fallback ACCEPT to protect your acceptance rate on decent offers."
        />
        {arp && (
          <div className="space-y-4 rounded-lg border border-gray-200 p-3">
            <SliderRow
              label="Min $ per total mile"
              value={arp.min_per_total_mile}
              min={0.5}
              max={3.0}
              step={0.05}
              format={(v) => `$${v.toFixed(2)}/mi`}
              onChange={(v) =>
                form.setValue(
                  'global.acceptance_rate_protection',
                  { min_per_total_mile: v },
                  { shouldDirty: true }
                )
              }
              help="ACCEPT (FALLBACK) when total pay ≥ this per total mile and no other rule fired."
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
