/** Preserve edits while adopting confirmed values for fields the driver left alone. */
export function mergeSettingsDraft<T extends object>(baseline: T, draft: T, incoming: T): T {
  const merged = { ...incoming };
  for (const key of Object.keys(draft) as (keyof T)[]) {
    if (!sameSettingsValue(draft[key], baseline[key])) merged[key] = draft[key];
  }
  return merged;
}

export function sameSettingsValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type SettingsSection = 'profile' | 'location' | 'vehicle' | 'services' | 'connections';
export type ServiceSection = 'ridehail' | 'premium' | 'private';

export function settingsSectionForField(field: string): SettingsSection {
  if (['address1', 'address2', 'city', 'stateTerritory', 'zipCode', 'country', 'market'].includes(field)) return 'location';
  if (field.startsWith('vehicle') || field === 'seatbelts' || field.startsWith('attr')) return 'vehicle';
  if (field === 'ridesharePlatforms' || field.startsWith('elig') || field.startsWith('pref')) return 'services';
  return 'profile';
}

/** Display metadata only: these IDs are the existing persisted platform values. */
export const SETTINGS_PLATFORMS = [
  { id: 'uber', label: 'Uber', section: 'ridehail' },
  { id: 'lyft', label: 'Lyft', section: 'ridehail' },
  { id: 'ridehail', label: 'Other ridehail', section: 'ridehail' },
  { id: 'private', label: 'Private / chauffeur', section: 'private' },
] as const;
