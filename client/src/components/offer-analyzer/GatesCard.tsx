// client/src/components/offer-analyzer/GatesCard.tsx
// 2026-07-03 (todo #10): Hard gates — rider rating floor, Verified requirement,
// Share auto-reject, multiple-stops / round-trip auto-reject (design §3 global +
// share). The stops/round-trip pair writes global.auto_reject, or null when both
// are off (inert = null).

import { useWatch, type UseFormReturn } from 'react-hook-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { SliderRow, SwitchRow } from './controls';
import type { OfferRulesetConfig } from '@/lib/offer-ruleset-schema';
import { ShieldCheck } from 'lucide-react';

interface Props {
  form: UseFormReturn<OfferRulesetConfig>;
}

export default function GatesCard({ form }: Props) {
  const ratingFloor = useWatch({ control: form.control, name: 'global.rating_floor' });
  const requireVerified = useWatch({ control: form.control, name: 'global.require_verified' });
  const shareAutoReject = useWatch({ control: form.control, name: 'share.auto_reject' });
  const autoReject = useWatch({ control: form.control, name: 'global.auto_reject' });

  const setAutoReject = (patch: Partial<{ multiple_stops: boolean; round_trip: boolean }>) => {
    const next = {
      multiple_stops: autoReject?.multiple_stops ?? false,
      round_trip: autoReject?.round_trip ?? false,
      ...patch,
    };
    // Both off → null (inert), so defaults render nothing in the vision prompt.
    form.setValue('global.auto_reject', !next.multiple_stops && !next.round_trip ? null : next, {
      shouldDirty: true,
    });
  };

  return (
    <Card className="bg-white border-gray-200 shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldCheck className="h-5 w-5 text-blue-500" />
          Gates
        </CardTitle>
        <CardDescription>Hard pass/fail checks applied before rates</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SliderRow
          label="Rider rating floor"
          value={ratingFloor}
          min={4.5}
          max={5.0}
          step={0.01}
          format={(v) => v.toFixed(2)}
          onChange={(v) => form.setValue('global.rating_floor', v, { shouldDirty: true })}
          help="Reject when a rider rating is visible and below this."
        />

        <Separator className="bg-gray-200" />

        <SwitchRow
          label="Require Verified rider"
          checked={requireVerified}
          onCheckedChange={(on) => form.setValue('global.require_verified', on, { shouldDirty: true })}
          help="Reject offers missing the Verified badge."
        />

        <SwitchRow
          label="Auto-reject Share / Pool"
          checked={shareAutoReject}
          onCheckedChange={(on) => form.setValue('share.auto_reject', on, { shouldDirty: true })}
          help="Shared-ride products are rejected without rate checks."
        />

        <SwitchRow
          label="Auto-reject multiple stops"
          checked={autoReject?.multiple_stops ?? false}
          onCheckedChange={(on) => setAutoReject({ multiple_stops: on })}
          help="Reject offers showing more than one stop."
        />

        <SwitchRow
          label="Auto-reject round trips"
          checked={autoReject?.round_trip ?? false}
          onCheckedChange={(on) => setAutoReject({ round_trip: on })}
          help="Reject offers that return to the pickup point."
        />
      </CardContent>
    </Card>
  );
}
