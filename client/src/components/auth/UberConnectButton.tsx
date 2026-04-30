import React from 'react';
import { Button } from '@/components/ui/button';
import { getUberAuthUrl } from '@/services/uber/uberAuth';
import { Car } from 'lucide-react';

export const UberConnectButton: React.FC = () => {
  const handleConnect = () => {
    window.location.href = getUberAuthUrl();
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
