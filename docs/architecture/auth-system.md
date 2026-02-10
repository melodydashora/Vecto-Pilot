# Uber OAuth API

This module handles the OAuth 2.0 authentication flow for the Uber Driver integration. It manages the lifecycle of connecting a user's Uber account, including the initial redirect, callback handling, token storage, and disconnection.

**File:** `server/api/auth/uber.js`

## Database Schema
The integration interacts with the following database tables:
- `oauth_states`: Stores temporary CSRF state tokens during the auth flow.
- `uber_connections`: Stores encrypted access/refresh tokens and connection status.

## Endpoints

### Initiate OAuth Flow
**Route:** `GET /api/auth/uber`

Initiates the Uber OAuth flow by redirecting the user to Uber's authorization page.

- **Authentication:** Required
- **Flow:**
    1.  Checks if the user is authenticated.
    2.  Generates a secure random `state` string.
    3.  Stores the state in `oauth_states` with a 10-minute expiration.
    4.  Redirects the response to the Uber Authorization URL with the generated state.

### OAuth Callback
**Route:** `GET /api/auth/uber/callback`

Handles the redirect from Uber after the user has authorized (or denied) the application.

- **Query Parameters:**
    - `code`: The authorization code provided by Uber (if successful).
    - `state`: The CSRF state token returned by Uber.
    - `error`: Error code (e.g., `access_denied`) if the flow failed.
    - `error_description`: Description of the error.
- **Flow:**
    1.  Checks for OAuth errors in query parameters.
    2.  Validates the `state` against the `oauth_states` table (must exist, match provider 'uber', and not be expired).
    3.  Exchanges the `code` for access and refresh tokens via `exchangeCodeForTokens`.
    4.  Encrypts the tokens.
    5.  Upserts the connection record in `uber_connections` with `is_active: true`.
    6.  Redirects the user to the frontend success page (`/auth/signup?uber_connected=true`) or error page (`/auth/signup?error=...`).

### Disconnect Integration
**Route:** `POST /api/auth/uber/disconnect`

Disconnects the Uber integration for the authenticated user.

- **Authentication:** Required
- **Flow:**
    1.  Retrieves the active Uber connection for the user from `uber_connections`.
    2.  Attempts to revoke the access token via the Uber API (best effort).
    3.  Updates the database record to set `is_active` to `false`.