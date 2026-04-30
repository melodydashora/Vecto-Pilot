// Uber Payments Service
import { uberApi } from './uberApiClient';

interface GetPaymentsParams {
  limit?: number;
  offset?: number;
  from_time?: number;
  to_time?: number;
}

export const getPayments = async (params: GetPaymentsParams = {}) => {
  return uberApi.getPayments(params);
};
