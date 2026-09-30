import { economicPreferencesForApi } from './driver-preferences.js';

// Explicit public projection: never serialize a driver_profiles row wholesale.
export function driverProfileResponse(profile, vehicle, sessionId = null) {
  const fields = {
    id: 'id', userId: 'user_id', firstName: 'first_name', lastName: 'last_name',
    email: 'email', phone: 'phone', address1: 'address_1', address2: 'address_2',
    city: 'city', stateTerritory: 'state_territory', zipCode: 'zip_code', country: 'country',
    market: 'market', homeLat: 'home_lat', homeLng: 'home_lng', homeTimezone: 'home_timezone',
    homeFormattedAddress: 'home_formatted_address', createdAt: 'created_at',
  };
  const flags = {
    eligXl: 'elig_xl', eligXxl: 'elig_xxl', eligComfort: 'elig_comfort',
    eligLuxurySedan: 'elig_luxury_sedan', eligLuxurySuv: 'elig_luxury_suv',
    attrElectric: 'attr_electric', attrGreen: 'attr_green', attrWav: 'attr_wav',
    attrSki: 'attr_ski', attrCarSeat: 'attr_car_seat', prefPetFriendly: 'pref_pet_friendly',
    prefTeen: 'pref_teen', prefAssist: 'pref_assist', prefShared: 'pref_shared',
    marketingOptIn: 'marketing_opt_in', termsAccepted: 'terms_accepted',
    tierBlack: 'uber_black', tierXl: 'uber_xxl', tierComfort: 'uber_comfort',
    tierStandard: 'uber_x', tierShare: 'uber_x_share', uberBlack: 'uber_black',
    uberXxl: 'uber_xxl', uberComfort: 'uber_comfort', uberX: 'uber_x', uberXShare: 'uber_x_share',
    emailVerified: 'email_verified', phoneVerified: 'phone_verified', profileComplete: 'profile_complete',
  };
  return {
    user: { userId: profile.user_id, email: profile.email },
    sessionId,
    settingsRevision: profile.settings_revision,
    profile: {
      ...Object.fromEntries(Object.entries(fields).map(([key, column]) => [key, profile[column]])),
      ...Object.fromEntries(Object.entries(flags).map(([key, column]) => [key, profile[column] ?? false])),
      nickname: profile.driver_nickname || profile.first_name,
      eligEconomy: profile.elig_economy ?? true,
      ridesharePlatforms: profile.rideshare_platforms || [],
      settingsRevision: profile.settings_revision,
      selectedServices: profile.selected_services,
      ...economicPreferencesForApi(profile),
    },
    vehicle: vehicle ? {
      id: vehicle.id, driverProfileId: vehicle.driver_profile_id,
      year: vehicle.year, make: vehicle.make, model: vehicle.model,
      seatbelts: vehicle.seatbelts, isPrimary: vehicle.is_primary,
    } : null,
  };
}
