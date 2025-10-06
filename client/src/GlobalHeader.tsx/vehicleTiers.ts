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