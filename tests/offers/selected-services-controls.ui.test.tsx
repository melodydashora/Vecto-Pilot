import { jest } from '@jest/globals';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import RateTargetsCard from '../../client/src/components/offer-analyzer/RateTargetsCard';
import { DEFAULT_OFFER_RULESET_CONFIG, type OfferRulesetConfig } from '../../client/src/lib/offer-ruleset-schema';

// Keep the form and real rule-card conditions; replace only visual primitives.
jest.mock('@/components/offer-analyzer/controls', () => ({
  SliderRow: ({ label, value, onChange }: any) => <label>{label}<input type="range" value={value}
    onChange={event => onChange(Number(event.target.value))} /></label>,
  SwitchRow: ({ label, checked, onCheckedChange }: any) => <label>{label}<input type="checkbox" checked={checked}
    onChange={event => onCheckedChange(event.target.checked)} /></label>,
}));

let formState: UseFormReturn<OfferRulesetConfig>;
function Harness({ selectedServices, config = DEFAULT_OFFER_RULESET_CONFIG }: { selectedServices: string[] | null; config?: OfferRulesetConfig }) {
  const form = useForm<OfferRulesetConfig>({ defaultValues: JSON.parse(JSON.stringify(config)) });
  formState = form;
  return <RateTargetsCard form={form} selectedServices={selectedServices} />;
}

afterEach(cleanup);

test('an economy-only saved selection does not expose premium, Comfort or XL controls', () => {
  render(<Harness selectedServices={['economy']} />);
  expect(screen.queryByText('Premium rides')).toBeNull();
  expect(screen.queryByText('Separate Comfort rules')).toBeNull();
  expect(screen.queryByText('Separate XL rules')).toBeNull();
  expect(screen.getAllByRole('slider')).toHaveLength(2);
});

test('delivery-only saved selection exposes no ride rate controls', () => {
  render(<Harness selectedServices={['delivery']} />);
  expect(screen.queryAllByRole('slider')).toHaveLength(0);
});

test('deselecting and reselecting a service preserves both saved limits and a newer unsaved slider edit', () => {
  const config = JSON.parse(JSON.stringify(DEFAULT_OFFER_RULESET_CONFIG));
  config.tiers.comfort = { floor_per_mile: 1.75, floor_per_minute: null, max_total_miles: 18,
    accept_ladder: [{ min_per_mile: 1.75, max_total_min: 27 }] };
  const view = render(<Harness selectedServices={['economy', 'comfort']} config={config} />);
  const comfort = screen.getByText('Comfort').parentElement!;
  fireEvent.change(within(comfort).getByRole('slider', { name: 'Floor $/mi' }), { target: { value: '1.85' } });
  expect(formState.getValues('tiers.comfort.floor_per_mile')).toBe(1.85);
  view.rerender(<Harness selectedServices={['economy']} config={config} />);
  expect(screen.queryByText('Comfort')).toBeNull();
  expect(formState.getValues('tiers.comfort')).toMatchObject({ floor_per_mile: 1.85, max_total_miles: 18,
    accept_ladder: [{ min_per_mile: 1.85, max_total_min: 27 }] });
  view.rerender(<Harness selectedServices={['comfort']} config={config} />);
  expect(screen.queryByText('Economy')).toBeNull();
  expect(within(screen.getByText('Comfort').parentElement!).getByRole('slider', { name: 'Floor $/mi' })).toHaveProperty('value', '1.85');
  expect(formState.getValues('tiers.standard')).toEqual(config.tiers.standard);
  expect(formState.getValues('tiers.premium')).toEqual(config.tiers.premium);
});

test('selected Black service exposes its actual saved XL economic group while unrelated groups stay hidden', () => {
  const config = JSON.parse(JSON.stringify(DEFAULT_OFFER_RULESET_CONFIG));
  config.tiers.xl = { floor_per_mile: 3.25, floor_per_minute: null, max_total_miles: null,
    accept_ladder: [{ min_per_mile: 3.25, max_total_min: 35 }] };
  render(<Harness selectedServices={['luxury_suv']} config={config} />);
  const group = screen.getByText('Luxury SUV').parentElement!;
  expect(within(group).getByRole('slider', { name: 'Floor $/mi' })).toHaveProperty('value', '3.25');
  expect(screen.getAllByRole('slider')).toHaveLength(2);
  expect(screen.queryByText('Premium rides')).toBeNull();
  expect(formState.getValues('tiers.premium')).toEqual(config.tiers.premium);
});

test('legacy null selection keeps its existing rule controls without enabling optional tiers', () => {
  render(<Harness selectedServices={null} />);
  expect(screen.getByText('Standard rides')).toBeTruthy();
  expect(screen.getByText('Premium rides')).toBeTruthy();
  expect(formState.getValues('tiers.comfort')).toBeNull();
  expect(formState.getValues('tiers.xl')).toBeNull();
});
