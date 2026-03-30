// client/src/types/auth.ts
// Type definitions for authentication system

export interface User {
  userId: string;
  email: string;
}

export interface DriverProfile {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  nickname?: string; // Custom greeting name (defaults to firstName if not set)
  email: string;
  phone: string;
  address1: string;
  address2?: string;
  city: string;
  stateTerritory: string;
  zipCode?: string;
  country: string;
  market: string;
  ridesharePlatforms: string[];

  // Home location (from registration geocoding)
  homeLat?: number;
  homeLng?: number;
  homeTimezone?: string;
  homeFormattedAddress?: string;

  // ═══════════════════════════════════════════════════════════════════════════
  // DRIVER ELIGIBILITY - Platform-agnostic taxonomy
  // ═══════════════════════════════════════════════════════════════════════════

  // Vehicle Class (base tier - what kind of vehicle do you drive?)
  eligEconomy: boolean;      // Standard 4-seat sedan (UberX, Lyft Standard)
  eligXl: boolean;           // 6+ seat SUV/minivan (UberXL, Lyft XL)
  eligXxl: boolean;          // 6+ seat + extra cargo (Suburban, Expedition MAX)
  eligComfort: boolean;      // Newer vehicle, extra legroom (Uber Comfort)
  eligLuxurySedan: boolean;  // Premium sedan, black on black (Uber Black)
  eligLuxurySuv: boolean;    // Premium SUV, 6+ seats (Uber Black SUV)

  // Vehicle Attributes (hardware features of your vehicle)
  attrElectric: boolean;     // Fully electric vehicle (EV)
  attrGreen: boolean;        // Hybrid or low-emission vehicle
  attrWav: boolean;          // Wheelchair accessible (ramp/lift)
  attrSki: boolean;          // Ski rack / winter ready
  attrCarSeat: boolean;      // Child safety seat available

  // Service Preferences (rides you're willing to take - unchecked = avoid)
  prefPetFriendly: boolean;  // Accept passengers with pets
  prefTeen: boolean;         // Unaccompanied minors (13-17)
  prefAssist: boolean;       // Door-to-door assistance for seniors
  prefShared: boolean;       // Carpool/shared rides

  // Legacy fields (backward compatibility)
  tierBlack?: boolean;
  tierXl?: boolean;
  tierComfort?: boolean;
  tierStandard?: boolean;
  tierShare?: boolean;
  uberBlack?: boolean;
  uberXxl?: boolean;
  uberComfort?: boolean;
  uberX?: boolean;
  uberXShare?: boolean;

  marketingOptIn: boolean;
  termsAccepted: boolean;
  termsAcceptedAt?: string;
  termsVersion?: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  profileComplete: boolean;
}

export interface DriverVehicle {
  id: string;
  driverProfileId: string;
  year: number;
  make: string;
  model: string;
  seatbelts: number;
  isPrimary: boolean;
}

export interface AuthState {
  user: User | null;
  profile: DriverProfile | null;
  vehicle: DriverVehicle | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  // Step 1: Account
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;

  // Step 2: Address
  address1: string;
  address2?: string;
  city: string;
  stateTerritory: string;
  zipCode?: string;
  market: string;

  // Step 3: Vehicle
  vehicleYear: number;
  vehicleMake: string;
  vehicleModel: string;
  seatbelts: number;

  // Step 4: Services & Terms
  ridesharePlatforms: string[];

  // Vehicle Class (base tier)
  eligEconomy?: boolean;      // Standard 4-seat sedan
  eligXl?: boolean;           // 6+ seat SUV/minivan
  eligXxl?: boolean;          // 6+ seat + extra cargo
  eligComfort?: boolean;      // Newer vehicle, extra legroom
  eligLuxurySedan?: boolean;  // Premium sedan
  eligLuxurySuv?: boolean;    // Premium SUV

  // Vehicle Attributes (hardware features)
  attrElectric?: boolean;     // Fully electric vehicle (EV)
  attrGreen?: boolean;        // Hybrid or low-emission
  attrWav?: boolean;          // Wheelchair accessible
  attrSki?: boolean;          // Ski rack / winter ready
  attrCarSeat?: boolean;      // Child safety seat

  // Service Preferences (unchecked = avoid these rides)
  prefPetFriendly?: boolean;  // Accept passengers with pets
  prefTeen?: boolean;         // Unaccompanied minors (13-17)
  prefAssist?: boolean;       // Door-to-door assistance for seniors
  prefShared?: boolean;       // Carpool/shared rides

  marketingOptIn: boolean;
  termsAccepted: boolean;
}

export interface ForgotPasswordData {
  email: string;
  method: 'email' | 'sms';
}

export interface ResetPasswordData {
  token?: string;
  code?: string;
  email?: string;
  newPassword: string;
  confirmPassword: string;
}

export interface MarketOption {
  value: string;
  label: string;
}

export interface VehicleMake {
  id: number;
  name: string;
  isCommon: boolean;
}

export interface VehicleModel {
  id: number;
  name: string;
}

export interface AuthApiResponse {
  token?: string;
  user?: User;
  profile?: DriverProfile;
  vehicle?: DriverVehicle;
  error?: string;
  message?: string;
}
