/**
 * Vehicle Tiers Configuration
 *
 * PURPOSE: Provides vehicle tier options for user settings/profile
 * INTENDED USE: Settings gear in GlobalHeader.tsx when sign-up/sign-in is implemented
 *
 * TODO: Connect to user profile settings modal
 * - Allow drivers to select their vehicle tier
 * - Affects strategy recommendations (e.g., airport vs bar runs)
 * - Store selection in users table
 */

export const VEHICLE_TIERS = [
  'Standard Rideshare',
  'Comfort / Spacious Vehicle',
  'Large / Group Rides',
  'Premium / Luxury / Commercial',
  'Delivery Services',
];

// Map old vehicle types to new tiers for compatibility
export const mapVehicleTypeToTier = (oldType: string): string => {
  switch (oldType.toLowerCase()) {
    case 'uberx':
    case 'standard':
      return 'Standard Rideshare';
    case 'comfort':
    case 'uberxl':
      return 'Comfort / Spacious Vehicle';
    case 'large':
    case 'suv':
      return 'Large / Group Rides';
    case 'premium':
    case 'black':
    case 'lux':
      return 'Premium / Luxury / Commercial';
    case 'delivery':
    case 'eats':
      return 'Delivery Services';
    default:
      return 'Standard Rideshare';
  }
};
