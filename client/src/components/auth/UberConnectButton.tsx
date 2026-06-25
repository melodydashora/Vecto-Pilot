import React from 'react';
import { Button } from '@/components/ui/button';
import { Car } from 'lucide-react';

// 2026-05-23: Path B (server-side OAuth). Click delegates to the server
// initiate endpoint at GET /api/auth/uber, which generates the CSRF state,
// stores it in oauth_states, and 302's to Uber's authorize URL with the
// server-controlled redirect_uri. Replaces the prior client-computed URL
// from uberAuth.ts (now deleted) which bypassed server state management.
export const UberConnectButton: React.FC = () => {
  const handleConnect = () => {
    window.location.href = '/api/auth/uber';
  };

  return (
    <Button 
      onClick={handleConnect}
      className="w-full bg-black text-white hover:bg-gray-800 flex items-center gap-2"
    >
      <Car className="w-5 h-5" />
      Connect Uber Account
    </Button>
  );
};
