// 2026-10-17 (Melody, v3.3): the stay-in zone flow in GeographyCard — one Places result
// becomes the zone (seed radius/buffer), the panel tunes it, and the zone and the avoid
// list never hold the same place. Places search is a synthetic fetch; the Radix select
// used by avoid rows is substituted so the real card renders under jsdom.
import { jest } from '@jest/globals';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import GeographyCard from '../../client/src/components/offer-analyzer/GeographyCard';
import { DEFAULT_OFFER_RULESET_CONFIG, type OfferRulesetConfig } from '../../client/src/lib/offer-ruleset-schema';

const toast = jest.fn();
jest.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast }) }));
jest.mock('@/utils/co-pilot-helpers', () => ({ getAuthHeader: () => ({ Authorization: 'Bearer synthetic' }) }));
jest.mock('@/components/offer-analyzer/controls', () => ({
  SliderRow: ({ label, value, onChange }: any) => <label>{label}<input type="range" value={value}
    onChange={event => onChange(Number(event.target.value))} /></label>,
  SwitchRow: ({ label, checked, onCheckedChange }: any) => <label>{label}<input type="checkbox" checked={checked}
    onChange={event => onCheckedChange(event.target.checked)} /></label>,
}));
jest.mock('@/components/ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
}));

const fixtureCity = { place_id: 'fixture-city', label: 'Fixture City', formatted_address: 'Fixture City, ST', lat: 33.1, lng: -96.8, types: ['locality'] };
let formState: UseFormReturn<OfferRulesetConfig>;
function Harness({ config = DEFAULT_OFFER_RULESET_CONFIG }: { config?: OfferRulesetConfig }) {
  const form = useForm<OfferRulesetConfig>({ defaultValues: JSON.parse(JSON.stringify(config)) });
  formState = form;
  return <GeographyCard form={form} />;
}
const search = async (text: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Search a city, road, or landmark' }), { target: { value: text } });
  await screen.findByText('Fixture City, ST');
};

beforeEach(() => {
  toast.mockClear();
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, results: [fixtureCity] }) })) as unknown as typeof fetch;
});
afterEach(cleanup);

test('“Stay in” turns a search result into the zone with the seed radius and buffer, then the panel tunes it', async () => {
  render(<Harness />);
  expect(screen.getByText(/No stay-in zone/)).toBeTruthy();
  await search('Fix');
  fireEvent.click(screen.getByRole('button', { name: 'Stay in Fixture City' }));
  expect(formState.getValues('zone')).toEqual({ place_id: 'fixture-city', label: 'Fixture City', lat: 33.1, lng: -96.8,
    radius_mi: 5, pickup_buffer_mi: 2, max_away_mi: null, enabled: true });
  expect(formState.getValues('avoid')).toEqual([]);
  expect(screen.getByRole('slider', { name: 'Zone radius' })).toHaveProperty('value', '5');
  expect(screen.getByRole('slider', { name: 'Pickup buffer' })).toHaveProperty('value', '2');
  expect(screen.queryByRole('slider', { name: 'Max miles past the edge' })).toBeNull();
  fireEvent.change(screen.getByRole('slider', { name: 'Zone radius' }), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Cap dropoff distance' }));
  expect(formState.getValues('zone')).toMatchObject({ radius_mi: 8, max_away_mi: 20 });
  fireEvent.change(screen.getByRole('slider', { name: 'Max miles past the edge' }), { target: { value: '30' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Enabled' }));
  expect(formState.getValues('zone')).toMatchObject({ max_away_mi: 30, enabled: false });
  // With a zone set, later results offer only “Avoid”.
  await search('Fixt');
  expect(screen.queryByRole('button', { name: 'Stay in Fixture City' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Avoid Fixture City' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Remove zone Fixture City' }));
  expect(formState.getValues('zone')).toBeNull();
});

test('the zone and the avoid list never hold the same place', async () => {
  const config = JSON.parse(JSON.stringify(DEFAULT_OFFER_RULESET_CONFIG));
  config.zone = { place_id: 'fixture-city', label: 'Fixture City', lat: 33.1, lng: -96.8, radius_mi: 5, pickup_buffer_mi: 2, max_away_mi: null, enabled: true };
  const view = render(<Harness config={config} />);
  await search('Fix');
  fireEvent.click(screen.getByRole('button', { name: 'Avoid Fixture City' }));
  expect(formState.getValues('avoid')).toEqual([]);
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'That is your stay-in zone' })));
  view.unmount();

  const avoiding = JSON.parse(JSON.stringify(DEFAULT_OFFER_RULESET_CONFIG));
  avoiding.avoid = [{ place_id: 'fixture-city', label: 'Fixture City', lat: 33.1, lng: -96.8, mode: 'destination_in', radius_mi: 6, enabled: true }];
  render(<Harness config={avoiding} />);
  await search('Fix');
  fireEvent.click(screen.getByRole('button', { name: 'Stay in Fixture City' }));
  expect(formState.getValues('zone')).toBeNull();
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'That place is on your avoid list' }));
});

test('a saved zone renders its values without touching the avoid rules', () => {
  const config = JSON.parse(JSON.stringify(DEFAULT_OFFER_RULESET_CONFIG));
  config.zone = { place_id: 'fixture-city', label: 'Fixture City', lat: 33.1, lng: -96.8, radius_mi: 7, pickup_buffer_mi: 1.5, max_away_mi: 25, enabled: true };
  config.avoid = [{ place_id: 'fixture-other', label: 'Fixture Other', lat: 33.2, lng: -96.9, mode: 'north_of', enabled: true }];
  render(<Harness config={config} />);
  expect(screen.getByRole('slider', { name: 'Zone radius' })).toHaveProperty('value', '7');
  expect(screen.getByRole('slider', { name: 'Pickup buffer' })).toHaveProperty('value', '1.5');
  expect(screen.getByRole('slider', { name: 'Max miles past the edge' })).toHaveProperty('value', '25');
  expect(screen.getByText('Fixture Other')).toBeTruthy();
  expect(formState.getValues('avoid')).toEqual(config.avoid);
});
