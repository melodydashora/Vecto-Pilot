// client/src/components/offer-analyzer/controls.tsx
// 2026-07-03 (todo #10): Shared row controls for the Offer Analyzer rules editor.
// Mobile-first (used in a car): full-width sliders with big readouts, switch rows
// with generous touch targets. Kept presentational — all state lives in the form.

import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

/** Round slider float steps (0.05 etc.) to clean 2-decimal money values. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  help?: string;
}

export function SliderRow({ label, value, min, max, step, format, onChange, help }: SliderRowProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <span className="text-base font-semibold text-gray-900 tabular-nums">{format(value)}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(round2(v[0]))}
      />
      {help && <p className="text-xs text-gray-500">{help}</p>}
    </div>
  );
}

interface SwitchRowProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  help?: string;
}

export function SwitchRow({ label, checked, onCheckedChange, help }: SwitchRowProps) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <div className="space-y-0.5">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {help && <p className="text-xs text-gray-500">{help}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} className="shrink-0 mt-0.5" />
    </div>
  );
}
