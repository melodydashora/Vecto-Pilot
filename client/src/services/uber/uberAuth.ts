// Uber OAuth Service
// Handles the authorization flow with Uber's API

export const UBER_CONFIG = {
  clientId: import.meta.env.VITE_UBER_CLIENT_ID || 'Bdpb2tLU6Povh38h9n3MegyyidEtbKuh',
  redirectUri: import.meta.env.VITE_UBER_REDIRECT_URI || `${window.location.origin}/auth/uber/callback`,
  authUrl: 'https://login.uber.com/oauth/v2/authorize',
  tokenUrl: 'https://login.uber.com/oauth/v2/token',
  scopes: [
    'partner.accounts',
    'partner.payments',
    'partner.trips'
  ]
};

/**
 * Generates the Uber OAuth authorization URL
 */
export const getUberAuthUrl = (): string => {
  const params = new URLSearchParams({
    client_id: UBER_CONFIG.clientId,
    response_type: 'code',
    redirect_uri: UBER_CONFIG.redirectUri,
    scope: UBER_CONFIG.scopes.join(' ')
  });
  
  return `${UBER_CONFIG.authUrl}?${params.toString()}`;
};

/**
 * Exchanges the authorization code for an access token
 * Note: This should ideally be proxied through your backend to keep the Client Secret secure
 */
export const exchangeUberCode = async (code: string) => {
  const response = await fetch('/api/auth/uber/exchange', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code, redirect_uri: UBER_CONFIG.redirectUri }),
  });

  if (!response.ok) {
    throw new Error('Failed to exchange Uber code');
  }

  return response.json();
};
