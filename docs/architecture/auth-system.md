# Authentication API

**File:** `server/api/auth/auth.js`

This module handles complete authentication API routes, including user registration, token generation, and Google OAuth integration.

## Endpoints

### `POST /api/auth/register`

Creates a new driver account. This endpoint handles comprehensive data normalization for vehicle details, eligibility tiers, and service preferences, supporting both new and legacy data formats. It supports optional profile fields such as `nickname`. Additionally, it performs address validation and geocoding to ensure accurate location data.

#### Request Configuration & Defaults

The endpoint enforces specific default values if they are not provided in the request body:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `country` | String | `'US'` | Address country code. |
| `seatbelts` | Number | `4` | Vehicle seatbelt count (if not in vehicle object). |
| `ridesharePlatforms` | Array | `['uber']` | List of active platforms. |
| `eligEconomy` | Boolean | `true` | Default base tier eligibility for new users. |
| `marketingOptIn` | Boolean | `false` | Marketing opt-in status. |
| `termsAccepted` | Boolean | `false` | Terms of service acceptance status. |

#### Platform-Agnostic Taxonomy

The endpoint accepts the following boolean flags to define driver eligibility and preferences:

- **Vehicle Class:** `eligEconomy`, `eligXl`, `eligXxl`, `eligComfort`, `eligLuxurySedan`, `eligLuxurySuv`
- **Vehicle Attributes:** `attrElectric`, `attrGreen`, `attrWav`, `attrSki`, `attrCarSeat`
- **Service Preferences:** `prefPetFriendly`, `prefTeen`, `prefAssist`, `prefShared`