// client/src/components/offer-analyzer/VisionRulesCard.tsx
// 2026-07-03 (todo #10): Vision-lane rules — judged from the offer screenshot by
// the model, not by arithmetic (design §2 vision-judgment lane). The notices
// trio writes global.notices, or null when all three are off (inert = null).

import { useWatch, type UseFormReturn } from 'react-hook-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { SwitchRow } from './controls';
import type { OfferRulesetConfig } from '@/lib/offer-ruleset-schema';
import { Eye } from 'lucide-react';

interface Props {
  form: UseFormReturn<OfferRulesetConfig>;
}

type NoticeKey = 'verified_rider' | 'on_the_way_filter' | 'deadhead_reduction';

const NOTICE_ROWS: Array<{ key: NoticeKey; label: string; help: string }> = [
  {
    key: 'verified_rider',
    label: 'Mention Verified rider',
    help: 'Call out when the rider has the Verified badge.',
  },
  {
    key: 'on_the_way_filter',
    label: 'Mention "On the way"',
    help: 'Call out when the offer is tagged "On the way".',
  },
  {
    key: 'deadhead_reduction',
    label: 'Mention deadhead reduction',
    help: 'Call out the "…" marker that signals a shorter return deadhead.',
  },
];

export default function VisionRulesCard({ form }: Props) {
  const safetyRoadTypes = useWatch({ control: form.control, name: 'global.safety_road_types' });
  const commercialStaging = useWatch({ control: form.control, name: 'global.commercial_staging' });
  const notices = useWatch({ control: form.control, name: 'global.notices' });

  const setNotice = (key: NoticeKey, on: boolean) => {
    const next = {
      verified_rider: notices?.verified_rider ?? false,
      on_the_way_filter: notices?.on_the_way_filter ?? false,
      deadhead_reduction: notices?.deadhead_reduction ?? false,
      hourly_rate: notices?.hourly_rate ?? false, // owned by RateTargetsCard — preserved here
      [key]: on,
    };
    // All off → null (inert), so defaults render nothing in the vision prompt.
    const allOff = !next.verified_rider && !next.on_the_way_filter && !next.deadhead_reduction && !next.hourly_rate;
    form.setValue('global.notices', allOff ? null : next, { shouldDirty: true });
  };

  return (
    <Card className="bg-white border-gray-200 shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Eye className="h-5 w-5 text-purple-500" />
          Vision Rules
        </CardTitle>
        <CardDescription>Judged from the offer screenshot map, not the numbers</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SwitchRow
          label="Road-type safety"
          checked={safetyRoadTypes}
          onCheckedChange={(on) => form.setValue('global.safety_road_types', on, { shouldDirty: true })}
          help="Reject rides needing dirt/gravel/unpaved/ranch roads or unsafe access — judged from the map."
        />

        <SwitchRow
          label="Commercial staging"
          checked={commercialStaging}
          onCheckedChange={(on) => form.setValue('global.commercial_staging', on, { shouldDirty: true })}
          help="Don't penalize short trips near commercial hubs (airports, stadiums, malls)."
        />

        <Separator className="bg-gray-200" />

        <div className="space-y-1">
          <span className="text-sm font-medium text-gray-700">Notices</span>
          <p className="text-xs text-gray-500">Mentioned in the spoken response when present — never change the decision.</p>
        </div>

        {NOTICE_ROWS.map((row) => (
          <SwitchRow
            key={row.key}
            label={row.label}
            checked={notices?.[row.key] ?? false}
            onCheckedChange={(on) => setNotice(row.key, on)}
            help={row.help}
          />
        ))}
      </CardContent>
    </Card>
  );
}
