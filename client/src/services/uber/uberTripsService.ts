// Uber Trips Service
import { uberApi } from './uberApiClient';

interface GetTripsParams {
  limit?: number;
  offset?: number;
  from_time?: number;
  to_time?: number;
}

export const getTrips = async (params: GetTripsParams = {}) => {
  return uberApi.getTrips(params);
};
