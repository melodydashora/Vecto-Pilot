// Uber Profile Service
import { uberApi } from './uberApiClient';
import { UberDriverProfile } from '@/types/uber';

export const getDriverProfile = async (): Promise<UberDriverProfile> => {
  return uberApi.getProfile();
};
