// 2026-10-17 (Melody): ride-type sliders are bounded by the gates — Max trip minutes by
// the total time limit, Max miles by the max pickup miles. A saved value outside the bound
// is shown with a note and never rewritten. The slider primitive is substituted with a
// range input that exposes min/max so the bound itself is observable.
import { jest } from '@jest/globals';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import RateTargetsCard from '../../client/src/components/offer-analyzer/RateTargetsCard';
import { DEFAULT_OFFER_RULESET_CONFIG, type OfferRulesetConfig } from '../../client/src/lib/offer-ruleset-schema';

jest.mock('@/components/offer-analyzer/controls', () => ({
  SliderRow: ({ label, value, min, max, onChange, help }: any) => <div><label>{label}<input type="range" min={min} max={max} value={value}
    onChange={event => onChange(Number(event.target.value))} /></label>{help ? <p>{help}</p> : null}</div>,
  SwitchRow: ({ label, checked, onCheckedChange }: any) => <label>{label}<input type="checkbox" checked={checked}
    onChange={event => onCheckedChange(event.target.checked)} /></label>,
}));

let formState: UseFormReturn<OfferRulesetConfig>;
function Harness({ config }: { config: OfferRulesetConfig }) {
  const form = useForm<OfferRulesetConfig>({ defaultValues: JSON.parse(JSON.stringify(config)) });
  formState = form;
  return <RateTargetsCard form={form} selectedServices={['economy']} />;
}
const derivedStandard = (maxTripMinutes: number, maxTotalMiles: number | null = null) => {
  const config = JSON.parse(JSON.stringify(DEFAULT_OFFER_RULESET_CONFIG)) as OfferRulesetConfig;
  config.tiers.standard = { floor_per_mile: 1.1, floor_per_minute: null, max_total_miles: maxTotalMiles,
    accept_ladder: [{ min_per_mile: 1.1, max_total_min: maxTripMinutes }] };
  return config;
};

afterEach(cleanup);

test('without limits the ride-type sliders keep their full ranges and show no note', () => {
  render(<Harness config={derivedStandard(25, 12)} />);
  expect(screen.getByRole('slider', { name: 'Max trip minutes' })).toHaveProperty('max', '60');
  expect(screen.getByRole('slider', { name: 'Max miles' })).toHaveProperty('min', '2');
  expect(screen.queryByRole('note')).toBeNull();
});

test('the total time limit caps Max trip minutes; a saved value above it is flagged, not rewritten', () => {
  const config = derivedStandard(40);
  config.global.time_limit = { max_total_minutes: 30, unless: { min_per_mile: 2, min_per_minute: 1 } };
  render(<Harness config={config} />);
  // jsdom clamps a range input's DOM value to [min, max] exactly as the pinned thumb does;
  // the saved form value is what must survive untouched.
  expect(screen.getByRole('slider', { name: 'Max trip minutes' })).toHaveProperty('max', '30');
  expect(screen.getByText(/Capped by your 30-min total time limit/)).toBeTruthy();
  expect(screen.getByRole('note').textContent).toMatch(/Saved 40 min is above your 30-min total time limit/);
  expect(formState.getValues('tiers.standard.accept_ladder')).toEqual([{ min_per_mile: 1.1, max_total_min: 40 }]);
});

test('the max pickup miles floor Max miles; a saved value below it is flagged, not rewritten', () => {
  const config = derivedStandard(20, 3);
  config.global.pickup_limits = { max_miles: 5, max_minutes: 10 };
  render(<Harness config={config} />);
  expect(screen.getByRole('slider', { name: 'Max miles' })).toHaveProperty('min', '5');
  expect(screen.getByRole('note').textContent).toMatch(/Saved 3 mi is below your 5-mi max pickup/);
  expect(formState.getValues('tiers.standard.max_total_miles')).toBe(3);
});

test('a legacy multi-step ladder above the limit gets the explanatory note rather than the warning', () => {
  const config = JSON.parse(JSON.stringify(DEFAULT_OFFER_RULESET_CONFIG)) as OfferRulesetConfig;   // default standard ladder: first step 20 min
  config.global.time_limit = { max_total_minutes: 15, unless: { min_per_mile: 2, min_per_minute: 1 } };
  render(<Harness config={config} />);
  expect(screen.getByRole('slider', { name: 'Max trip minutes' })).toHaveProperty('max', '15');
  expect(screen.getByRole('note').textContent).toMatch(/older multi-step rule \(first step 20 min\)/);
  expect(formState.getValues('tiers.standard.accept_ladder')).toHaveLength(5);
});

test('a bound at or past the slider range keeps one step of room and sends the driver to Limits when nothing can fit', () => {
  const tight = derivedStandard(20, 12);
  tight.global.time_limit = { max_total_minutes: 5, unless: { min_per_mile: 2, min_per_minute: 1 } };
  tight.global.pickup_limits = { max_miles: 50, max_minutes: 10 };
  render(<Harness config={tight} />);
  expect(screen.getByRole('slider', { name: 'Max trip minutes' })).toHaveProperty('max', '6');
  const miles = screen.getByRole('slider', { name: 'Max miles' });
  expect(miles).toHaveProperty('min', '39');
  expect(miles).toHaveProperty('max', '40');
  const notes = screen.getAllByRole('note').map(node => node.textContent);
  expect(notes.some(text => /above this slider's 40-mi range/.test(text ?? ''))).toBe(true);
  expect(formState.getValues('tiers.standard.max_total_miles')).toBe(12);
});
