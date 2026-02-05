import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { UberConnectButton } from '@/components/auth/UberConnectButton';
import { UberConnectionStatus } from '@/components/auth/UberConnectionStatus';
import { useQuery } from '@tanstack/react-query';

// Mock function until we have the backend endpoint
const fetchUberStatus = async () => {
  // In a real implementation, this would call /api/auth/uber/status
  // For now, we simulate a disconnected state
  return { 
    status: 'disconnected' as const,
    lastSync: undefined
  };
};

export const UberSettingsSection: React.FC = () => {
  const { data, isLoading } = useQuery({
    queryKey: ['uberStatus'],
    queryFn: fetchUberStatus
  });

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Uber Integration</CardTitle>
        <CardDescription>
          Connect your Uber Driver account to unlock personalized earning strategies and trip analytics.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <UberConnectionStatus 
          status={isLoading ? 'loading' : (data?.status || 'disconnected')} 
          lastSync={data?.lastSync}
        />
        
        {(!data || data.status === 'disconnected' || data.status === 'error') && (
          <div className="max-w-sm">
            <UberConnectButton />
            <p className="text-xs text-gray-500 mt-2">
              By connecting, you grant Vecto Pilot access to your trip history and earnings data.
              We use this strictly to optimize your driving strategy.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
