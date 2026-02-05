// server/lib/external/uber-client.js
// Uber Driver API Client Wrapper
// Handles rate limiting, authorization headers, and error parsing

import fetch from 'node-fetch';

const BASE_URL = 'https://api.uber.com/v1';

class UberClient {
  /**
   * @param {string} accessToken - The user's OAuth access token
   * @param {object} options - Optional configurations (e.g., mock mode)
   */
  constructor(accessToken, options = {}) {
    this.accessToken = accessToken;
    this.isMock = options.mock || false;
  }

  /**
   * Generic fetch wrapper with error handling
   * @param {string} endpoint - API Endpoint (e.g., '/partners/me')
   * @param {object} options - Fetch options
   */
  async _request(endpoint, options = {}) {
    if (this.isMock) {
      return this._mockResponse(endpoint);
    }

    const url = `${BASE_URL}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      'Accept-Language': 'en_US',
      ...options.headers
    };

    try {
      const response = await fetch(url, { ...options, headers });
      
      // Handle Rate Limiting
      if (response.status === 429) {
        throw new Error('Uber API Rate Limit Exceeded');
      }

      if (response.status === 401) {
        throw new Error('Unauthorized: Invalid or expired access token');
      }

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Uber API Error (${response.status}): ${errorBody}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`[UberClient] Request failed: ${endpoint}`, error.message);
      throw error;
    }
  }

  /**
   * Get Driver Profile
   * Scope: partner.accounts
   */
  async getProfile() {
    return this._request('/partners/me');
  }

  /**
   * Get Trip History
   * Scope: partner.trips
   * @param {object} params - { limit, offset, from_time, to_time }
   */
  async getTrips(params = {}) {
    // 2026-02-03: Note that Uber Partners API limit is 50
    const query = new URLSearchParams(params).toString();
    return this._request(`/partners/trips?${query}`);
  }

  /**
   * Get Payments/Earnings
   * Scope: partner.payments
   * @param {object} params - { limit, offset, from_time, to_time }
   */
  async getPayments(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this._request(`/partners/payments?${query}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Mock Data (For Development/Sandbox)
  // ═══════════════════════════════════════════════════════════════════════════
  _mockResponse(endpoint) {
    console.log(`[UberClient] Returning MOCK data for ${endpoint}`);
    
    if (endpoint.includes('/partners/me')) {
      return {
        driver_id: 'mock_driver_123',
        first_name: 'Alex',
        last_name: 'Driver',
        email: 'alex@example.com',
        phone_number: '+15550001234',
        picture: 'https://avatar.iran.liara.run/public/33', // Placeholder avatar
        rating: 4.95,
        activation_status: 'active',
        partner_type: 'driver'
      };
    }

    if (endpoint.includes('/partners/trips')) {
      return {
        count: 2,
        limit: 50,
        offset: 0,
        trips: [
          {
            trip_id: 'trip_abc_123',
            status: 'completed',
            distance: 5.2,
            duration: 1200, // seconds
            fare: 15.50,
            currency_code: 'USD',
            pickup: { timestamp: Date.now() / 1000 - 3600 },
            dropoff: { timestamp: Date.now() / 1000 - 2400 },
          },
          {
            trip_id: 'trip_xyz_789',
            status: 'completed',
            distance: 3.1,
            duration: 800,
            fare: 9.75,
            currency_code: 'USD',
            pickup: { timestamp: Date.now() / 1000 - 7200 },
            dropoff: { timestamp: Date.now() / 1000 - 6400 },
          }
        ]
      };
    }

    if (endpoint.includes('/partners/payments')) {
      return {
        count: 1,
        limit: 50,
        payments: [
          {
            payment_id: 'pay_123',
            category: 'fare',
            event_time: Date.now() / 1000,
            trip_id: 'trip_abc_123',
            amount: 15.50,
            currency_code: 'USD'
          }
        ]
      };
    }

    return {};
  }
}

export default UberClient;
