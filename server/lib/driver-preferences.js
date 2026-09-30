// Existing driver_profiles columns are the canonical preference store.
// Null means not supplied; zero is an explicit goal or pickup-distance limit.
const economicFields = [
  ['fuelEconomyMpg', 'fuel_economy_mpg', 1, 2147483647, 0],
  ['earningsGoalDaily', 'earnings_goal_daily', 0, 99999999.99, 2],
  ['shiftHoursTarget', 'shift_hours_target', 0, 24, 1],
  ['maxDeadheadMi', 'max_deadhead_mi', 0, 500, 0],
];

// Admission pins Analyzer rules to detect settings changes. MAIN model prompts
// receive driver preferences/vehicle only while Analyzer integration is on hold.
export function mainDriverContext(configuration) {
  return { profile: configuration?.profile ?? null, vehicle: configuration?.vehicle ?? null };
}

export function economicPreferencesForApi(profile) {
  return Object.fromEntries(economicFields.map(([field, column]) => [
    field, profile[column] == null ? null : Number(profile[column]),
  ]));
}

/** Validate before any profile write; JSON strings/booleans are not numbers. */
export function parseEconomicPreferenceUpdates(updates) {
  const values = {};
  for (const [field, column, min, max, decimals] of economicFields) {
    if (!Object.hasOwn(updates, field)) continue;
    const value = updates[field];
    if (value === null) { values[column] = null; continue; }
    const scale = 10 ** decimals;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max
        || Math.abs(value * scale - Math.round(value * scale)) > 1e-6) {
      return { ok: false, field, message: `${field} must be null or a number from ${min} to ${max} with at most ${decimals} decimal places.` };
    }
    values[column] = value;
  }
  return { ok: true, values };
}

/** Preserve each explicit yes/no and unknown instead of emitting only true flags. */
export function formatDriverServicePreferences(profile) {
  return [
    ['pref_pet_friendly', 'pet-friendly rides'], ['pref_teen', 'unaccompanied teen rides'],
    ['pref_assist', 'assistance rides'], ['pref_shared', 'shared rides'],
  ].map(([key, label]) => `${label}: ${profile[key] === true ? 'willing' : profile[key] === false ? 'avoid' : 'not specified'}`).join('; ');
}

export function formatDriverEconomics(profile) {
  const p = economicPreferencesForApi(profile);
  return [
    p.fuelEconomyMpg == null ? 'Fuel economy: not specified' : `Fuel economy: ${p.fuelEconomyMpg} mpg`,
    p.earningsGoalDaily == null ? 'Daily earnings goal: not specified' : `Daily earnings goal: ${p.earningsGoalDaily} (driver account currency)`,
    p.shiftHoursTarget == null ? 'Target shift: not specified' : `Target shift: ${p.shiftHoursTarget} hours`,
    p.maxDeadheadMi == null ? 'Maximum empty pickup distance: not specified' : `Maximum empty pickup distance: ${p.maxDeadheadMi} miles`,
  ].join('; ');
}
