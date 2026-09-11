import { mergeSettingsDraft, settingsSectionForField, SETTINGS_PLATFORMS } from '../../client/src/lib/settings-draft';

test('background values update untouched fields while retaining false flags and unknown selections', () => {
  const baseline = { nickname: 'Saved', eligEconomy: true, platforms: ['private', 'legacy-service'], comfort: null };
  const draft = { ...baseline, nickname: 'Typing', eligEconomy: false };
  const incoming = { ...baseline, nickname: 'Remote', platforms: ['private', 'legacy-service', 'ridehail'] };
  expect(mergeSettingsDraft(baseline, draft, incoming)).toEqual({ ...incoming, nickname: 'Typing', eligEconomy: false });
});

test('a save uses the submitted baseline so an in-flight revert is still an edit', () => {
  const submitted = { nickname: 'Submitted', phone: '5555555555' };
  const current = { nickname: 'Original', phone: '5555555555' };
  expect(mergeSettingsDraft(submitted, current, { nickname: 'Submitted', phone: '+15555555555' }))
    .toEqual({ nickname: 'Original', phone: '+15555555555' });
});

test('the presentation catalog adds no platform IDs and validation maps to existing sections', () => {
  expect(SETTINGS_PLATFORMS.map(option => option.id)).toEqual(['uber', 'lyft', 'ridehail', 'private']);
  expect(settingsSectionForField('address1')).toBe('location');
  expect(settingsSectionForField('attrElectric')).toBe('vehicle');
  expect(settingsSectionForField('eligLuxurySedan')).toBe('services');
  expect(settingsSectionForField('phone')).toBe('profile');
});
