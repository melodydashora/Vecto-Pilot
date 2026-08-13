// client/src/components/offer-analyzer/RateTargetsCard.tsx
// 2026-07-03 (todo #10): Per-tier rate floors + accept ladders (design §3 tiers).
// standard/premium always exist; comfort/xl are optional split-outs — the enable
// switch writes the tier object, off writes null (inert). Ladder rows are ordered,
// first-match-wins. Arrays are edited as controlled values inside the form state
// (no useFieldArray precedent in this repo; nullable tier paths make it awkward).

import { useWatch, type UseFormReturn } from 'react-hook-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { SliderRow, SwitchRow } from './controls';
import type { LadderRung, OfferRulesetConfig, TierConfig } from '@/lib/offer-ruleset-schema';
import { ENABLE_SEEDS } from '@/lib/offer-ruleset-schema';
import { DollarSign, Plus, Trash2 } from 'lucide-react';

interface Props {
  form: UseFormReturn<OfferRulesetConfig>;
}

/** Human summary of a rung, honoring the legacy exclusive bounds (> / <). */
function describeRung(rung: LadderRung): string {
  const parts = [`≥ $${rung.min_per_mile.toFixed(2)}/mi`];
  if (rung.min_per_minute != null) parts.push(`and ≥ $${rung.min_per_minute.toFixed(2)}/min`);
  const time: string[] = [];
  if (rung.min_total_min != null) time.push(`≥ ${rung.min_total_min}`);
  else if (rung.min_total_min_excl != null) time.push(`> ${rung.min_total_min_excl}`);
  if (rung.max_total_min != null) time.push(`≤ ${rung.max_total_min}`);
  else if (rung.max_total_min_excl != null) time.push(`< ${rung.max_total_min_excl}`);
  parts.push(time.length ? `for trips ${time.join(' and ')} min total` : 'for any trip length');
  return parts.join(' ');
}

interface NumberFieldProps {
  label: string;
  value: number | null;
  step?: string;
  onChange: (v: number | null) => void;
}

function NumberField({ label, value, step = '0.05', onChange }: NumberFieldProps) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-gray-500">{label}</label>
      <Input
        type="number"
        inputMode="decimal"
        step={step}
        value={value ?? ''}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange(null);
            return;
          }
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="bg-white border-gray-300 text-gray-900"
      />
    </div>
  );
}

interface TierEditorProps {
  title: string;
  tier: TierConfig;
  onChange: (tier: TierConfig) => void;
}

function TierEditor({ title, tier, onChange }: TierEditorProps) {
  const updateRung = (i: number, patch: Partial<LadderRung>) => {
    onChange({
      ...tier,
      accept_ladder: tier.accept_ladder.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    });
  };

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
        onChange={(v) => onChange({ ...tier, floor_per_mile: v })}
        help="Anything under this per-mile rate is rejected outright."
      />

      <SwitchRow
        label="Per-minute floor"
        checked={tier.floor_per_minute != null}
        onCheckedChange={(on) => onChange({ ...tier, floor_per_minute: on ? 0.5 : null })}
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
          onChange={(v) => onChange({ ...tier, floor_per_minute: v })}
        />
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Accept ladder</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange({
                ...tier,
                accept_ladder: [...tier.accept_ladder, { min_per_mile: tier.floor_per_mile }],
              })
            }
          >
            <Plus className="mr-1 h-4 w-4" />
            Add rung
          </Button>
        </div>
        <p className="text-xs text-gray-500">
          Checked top to bottom — the first rung that matches ACCEPTs the offer.
        </p>

        {tier.accept_ladder.length === 0 && (
          <p className="text-xs text-gray-400 italic">No rungs yet — only the floor applies.</p>
        )}

        {tier.accept_ladder.map((rung, i) => (
          <div key={i} className="rounded-lg border border-gray-200 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase">Rung {i + 1}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-gray-400 hover:text-red-600"
                aria-label={`Remove rung ${i + 1}`}
                onClick={() =>
                  onChange({ ...tier, accept_ladder: tier.accept_ladder.filter((_, idx) => idx !== i) })
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Min $/mi"
                value={rung.min_per_mile}
                onChange={(v) => updateRung(i, { min_per_mile: v ?? 0 })}
              />
              <NumberField
                label="Min $/min (optional)"
                value={rung.min_per_minute ?? null}
                onChange={(v) => updateRung(i, { min_per_minute: v })}
              />
              {/* Editing a bound writes the inclusive key and clears the legacy
                  exclusive variant; untouched rungs round-trip unchanged.
                  Minutes are integers server-side — round on input. */}
              <NumberField
                label="Min total minutes"
                step="1"
                value={rung.min_total_min ?? rung.min_total_min_excl ?? null}
                onChange={(v) =>
                  updateRung(i, { min_total_min: v == null ? null : Math.round(v), min_total_min_excl: null })
                }
              />
              <NumberField
                label="Max total minutes"
                step="1"
                value={rung.max_total_min ?? rung.max_total_min_excl ?? null}
                onChange={(v) =>
                  updateRung(i, { max_total_min: v == null ? null : Math.round(v), max_total_min_excl: null })
                }
              />
            </div>
            <p className="text-xs text-gray-500">{describeRung(rung)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RateTargetsCard({ form }: Props) {
  const tiers = useWatch({ control: form.control, name: 'tiers' });

  return (
    <Card className="bg-white border-gray-200 shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <DollarSign className="h-5 w-5 text-green-500" />
          Rate Targets
        </CardTitle>
        <CardDescription>Per-mile floors and accept ladders for each ride tier</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
            form.setValue('tiers.comfort', on ? { ...ENABLE_SEEDS.comfort_tier, accept_ladder: [] } : null, {
              shouldDirty: true,
            })
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
            form.setValue('tiers.xl', on ? { ...ENABLE_SEEDS.xl_tier, accept_ladder: [] } : null, {
              shouldDirty: true,
            })
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
