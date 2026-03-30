// Uber API Client (Frontend)
// Handles communication with the Vecto Pilot backend proxy for Uber data

import { UberDriverProfile, UberTrip, UberPayment } from '@/types/uber';

class UberApiClient {
  private accessToken: string | null = null;

  setAccessToken(token: string) {
    this.accessToken = token;
  }

  getAccessToken() {
    return this.accessToken;
  }

  private async request<T>(endpoint: string, params: Record<string, any> = {}): Promise<T> {
    const query = new URLSearchParams(params).toString();
    const url = `/api/auth/uber${endpoint}${query ? `?${query}` : ''}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`Uber API Request Failed: ${response.statusText}`);
    }

    return response.json();
  }

  async getProfile(): Promise<UberDriverProfile> {
    return this.request<UberDriverProfile>('/profile');
  }

  async getTrips(params: { limit?: number; offset?: number; from_time?: number; to_time?: number } = {}) {
    return this.request<{ trips: UberTrip[]; count: number }>('/trips', params);
  }

  async getPayments(params: { limit?: number; offset?: number; from_time?: number; to_time?: number } = {}) {
    return this.request<{ payments: UberPayment[]; count: number }>('/payments', params);
  }
}

// Singleton instance
export const uberApi = new UberApiClient();
