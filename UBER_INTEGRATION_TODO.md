# Uber Driver API Integration TODO

## Overview
Integrate Uber Driver API to allow drivers to connect their accounts and access historical trip data, earnings, and profile information to power optimization features.

## API Endpoints Required
- `GET /partners/me` - Driver profile (partner.accounts scope)
- `GET /partners/payments` - Earnings data (partner.payments scope)  
- `GET /partners/trips` - Trip history (partner.trips scope)

---

## Phase 1: OAuth & Authentication

### 1.1 Create OAuth Service
- [ ] Create `src/services/uber/uberAuth.ts`
  - Implement OAuth 2.0 authorization URL generator
  - Handle callback with authorization code
  - Exchange code for access token
  - Implement token refresh logic
  - Store tokens securely (encrypted in database)

### 1.2 Add OAuth Environment Variables
- [ ] Add to `.env`:
```
  UBER_CLIENT_ID=Bdpb2tLU6Povh38h9n3MegyyidEtbKuh
  UBER_CLIENT_SECRET=<your_secret>
  UBER_REDIRECT_URI=https://vectopilot.com/auth/uber/callback
```

### 1.3 Create Auth UI Components
- [ ] Create `src/components/auth/UberConnectButton.tsx`
- [ ] Create `src/components/auth/UberConnectionStatus.tsx`
- [ ] Add to existing auth flow in `src/components/auth/`

---

## Phase 2: API Service Layer

### 2.1 Create Uber API Client
- [ ] Create `src/services/uber/uberApiClient.ts`
  - Base API client with auth headers
  - Rate limiting handling
  - Error handling & retry logic

### 2.2 Create Endpoint Services
- [ ] Create `src/services/uber/uberProfileService.ts`
  - `getDriverProfile()` - GET /partners/me

- [ ] Create `src/services/uber/uberPaymentsService.ts`
  - `getPayments(fromTime, toTime, limit, offset)` - GET /partners/payments
  - Handle 10-day query limit pagination

- [ ] Create `src/services/uber/uberTripsService.ts`
  - `getTrips(fromTime, toTime, limit, offset)` - GET /partners/trips
  - Paginate through all historical data

---

## Phase 3: Data Models & Types

### 3.1 Create TypeScript Types
- [ ] Create `src/types/uber.ts`:
```typescript
  interface UberDriverProfile {
    driver_id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone_number: string;
    picture: string;
    rating: number;
    activation_status: string;
    partner_type: string;
  }

  interface UberPayment {
    payment_id: string;
    category: string;
    event_time: number;
    trip_id: string;
    amount: number;
    currency_code: string;
    breakdown: {
      other: number;
      toll: number;
      service_fee: number;
    };
  }

  interface UberTrip {
    trip_id: string;
    fare: number;
    distance: number;
    duration: number;
    status: string;
    start_city: {
      latitude: number;
      longitude: number;
      display_name: string;
    };
    dropoff: { timestamp: number };
    pickup: { timestamp: number };
    vehicle_id: string;
    status_changes: Array<{
      status: string;
      timestamp: number;
    }>;
  }
```

---

## Phase 4: Database Schema

### 4.1 Create Database Tables
- [ ] Add to database schema:
```sql
  -- Uber connection tokens
  CREATE TABLE uber_connections (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    uber_driver_id VARCHAR,
    access_token TEXT ENCRYPTED,
    refresh_token TEXT ENCRYPTED,
    token_expires_at TIMESTAMP,
    scopes TEXT[],
    connected_at TIMESTAMP,
    last_sync_at TIMESTAMP
  );

  -- Cached trip data
  CREATE TABLE uber_trips (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    trip_id VARCHAR UNIQUE,
    fare DECIMAL,
    distance DECIMAL,
    duration INTEGER,
    city VARCHAR,
    latitude DECIMAL,
    longitude DECIMAL,
    pickup_time TIMESTAMP,
    dropoff_time TIMESTAMP,
    day_of_week INTEGER,
    hour_of_day INTEGER,
    raw_data JSONB
  );

  -- Cached payment data
  CREATE TABLE uber_payments (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    payment_id VARCHAR UNIQUE,
    trip_id VARCHAR,
    amount DECIMAL,
    category VARCHAR,
    event_time TIMESTAMP,
    raw_data JSONB
  );
```

---

## Phase 5: Data Sync & Processing

### 5.1 Create Sync Service
- [ ] Create `src/services/uber/uberSyncService.ts`
  - Initial full sync on connection
  - Incremental sync for new data
  - Handle large data sets with pagination

### 5.2 Create Analytics Processing
- [ ] Create `src/services/analytics/tripAnalytics.ts`
  - Calculate earnings by day of week
  - Calculate earnings by hour (daypart)
  - Calculate earnings by city/market
  - Identify peak earning periods
  - Calculate hourly rate trends

---

## Phase 6: UI Components

### 6.1 Dashboard Components
- [ ] Create `src/components/intel/UberEarningsChart.tsx`
  - Earnings over time visualization

- [ ] Create `src/components/intel/DaypartHeatmap.tsx`
  - Heatmap of earnings by day/hour

- [ ] Create `src/components/intel/MarketComparison.tsx`
  - Compare earnings across cities

- [ ] Update existing components:
  - `DemandRhythmChart.tsx` - Add real Uber data
  - `StrategyCards.tsx` - Add Uber-based recommendations
  - `MarketBoundaryGrid.tsx` - Show actual market data

### 6.2 Settings & Connection UI
- [ ] Create `src/components/settings/UberSettings.tsx`
  - Connect/disconnect Uber account
  - View connection status
  - Trigger manual data sync
  - View last sync time

---

## Phase 7: API Routes

### 7.1 Create Backend Routes
- [ ] `GET /api/auth/uber` - Initiate OAuth flow
- [ ] `GET /api/auth/uber/callback` - OAuth callback handler
- [ ] `POST /api/auth/uber/disconnect` - Disconnect account
- [ ] `GET /api/uber/profile` - Get driver profile
- [ ] `GET /api/uber/trips` - Get trips (paginated)
- [ ] `GET /api/uber/payments` - Get payments (paginated)
- [ ] `POST /api/uber/sync` - Trigger data sync
- [ ] `GET /api/analytics/earnings` - Get earnings analytics

---

## Phase 8: Testing

### 8.1 Sandbox Testing
- [ ] Test with Uber Sandbox environment
- [ ] Create mock data for development
- [ ] Test OAuth flow end-to-end
- [ ] Test data sync with large datasets

### 8.2 Unit Tests
- [ ] Test API service methods
- [ ] Test analytics calculations
- [ ] Test token refresh logic

---

## Implementation Order

1. **Week 1**: OAuth flow + environment setup
2. **Week 2**: API service layer + types
3. **Week 3**: Database schema + sync service
4. **Week 4**: Analytics processing
5. **Week 5**: UI components
6. **Week 6**: Testing + polish

---

## Notes

- Uber Driver API is LIMITED ACCESS - access request submitted
- App ID: Bdpb2tLU6Povh38h9n3MegyyidEtbKuh
- Payments endpoint limited to 10-day ranges
- Need to paginate for full history
- Store raw API responses for future analysis