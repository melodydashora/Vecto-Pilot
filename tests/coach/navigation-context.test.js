import { test, expect } from '@jest/globals';
import { googleDirectionsUrl, navigationLinkKind } from '../../shared/navigation-links.js';
import { formatCoachSourceContext } from '../../server/lib/ai/coach-source-context.js';

function records(context) {
  const prompt = formatCoachSourceContext({ timezone: 'America/Chicago' }, null, context);
  return JSON.parse(prompt.slice(prompt.indexOf('\n{') + 1, prompt.lastIndexOf('\n=== END SAVED SOURCE RECORDS ===')));
}
test('saved coordinates and place ID create driving directions with no invented origin', () => {
  const url = new URL(googleDirectionsUrl({ lat: 0, lng: -96.8, name: 'Fixture venue', placeId: 'saved&id' }));
  expect(url.pathname).toBe('/maps/dir/');
  expect(Object.fromEntries(url.searchParams)).toEqual({ api: '1', destination: '0,-96.8',
    destination_place_id: 'saved&id', travelmode: 'driving', dir_action: 'navigate' });
  expect(navigationLinkKind(url.href)).toBe('directions');
});
test('known address is encoded and a saved place ID can disambiguate a known name', () => {
  const address = '12 Main & First St, Fixture City';
  expect(new URL(googleDirectionsUrl({ address })).searchParams.get('destination')).toBe(address);
  expect(new URL(googleDirectionsUrl({ placeId: 'saved', name: 'Fixture venue' })).searchParams.get('destination_place_id')).toBe('saved');
});
test.each([{}, { name: 'A common chain' }, { placeId: 'saved' }, { lat: 91, lng: 5 },
  { lat: 0, lng: NaN }, { lat: '32', lng: '-96' }, { address: 'https://venue.example' },
  { address: 'Unknown' }])('missing or invalid destination does not create directions: %j', value => {
  expect(googleDirectionsUrl(value)).toBeNull();
});
test('saved Smart Blocks supply directions without changing raw context or inventing an address', () => {
  const context = { smartBlocks: [{ name: 'Fixture venue', placeId: 'p', coordinates: { lat: 32, lng: -96 } },
    { name: 'Unknown venue', coordinates: { lat: null, lng: null } }],
    venueData: { venues: [{ place_id: 'p', formatted_address: '12 Main St, Fixture City' },
      { place_id: 'unrelated', formatted_address: 'Do not use' }] }, strategy: { retained: true } };
  const original = JSON.stringify(context);
  const result = records(context);
  expect(JSON.stringify(context)).toBe(original);
  expect(result.strategy).toEqual(context.strategy);
  expect(result.navigation_context.source_state).toBe('derived_from_saved_destinations');
  expect(result.navigation_context.items[0]).toMatchObject({ name: 'Fixture venue', place_id: 'p', address: '12 Main St, Fixture City' });
  const directions = new URL(result.navigation_context.items[0].directions_url);
  expect(directions.searchParams.get('destination')).toBe('32,-96');
  expect(directions.searchParams.get('destination_place_id')).toBe('p');
  expect(result.navigation_context.items[1]).toEqual({ name: 'Unknown venue', place_id: null, address: null, directions_url: null });
});
test('catalog address joins only one exact saved place identity, never a similar name', () => {
  const result = records({ smartBlocks: [{ name: 'Same name' }],
    venueData: { venues: [{ venue_name: 'Same name', place_id: 'other', address: 'Unrelated address' }] } });
  expect(result.navigation_context.items[0]).toMatchObject({ address: null, directions_url: null });
});
