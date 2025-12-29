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
  uberBlack: boolean;
  uberXxl: boolean;
  uberComfort: boolean;
  uberX: boolean;
  uberXShare: boolean;
  marketingOptIn: boolean;
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
  uberBlack?: boolean;
  uberXxl?: boolean;
  uberComfort?: boolean;
  uberX?: boolean;
  uberXShare?: boolean;
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
