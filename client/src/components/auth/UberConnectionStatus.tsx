import React from 'react';
import { CheckCircle2, XCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface UberConnectionStatusProps {
  status: 'connected' | 'disconnected' | 'error' | 'loading';
  lastSync?: string;
}

export const UberConnectionStatus: React.FC<UberConnectionStatusProps> = ({ status, lastSync }) => {
  if (status === 'loading') {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          <span>Checking Uber connection...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium">Uber Integration Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          {status === 'connected' && (
            <>
              <CheckCircle2 className="w-6 h-6 text-green-500" />
              <div>
                <p className="font-medium">Connected</p>
                {lastSync && <p className="text-sm text-gray-500">Last synced: {lastSync}</p>}
              </div>
            </>
          )}
          
          {status === 'disconnected' && (
            <>
              <XCircle className="w-6 h-6 text-gray-400" />
              <p className="text-gray-500">Not connected</p>
            </>
          )}

          {status === 'error' && (
            <>
              <AlertCircle className="w-6 h-6 text-red-500" />
              <p className="text-red-500">Connection Error. Please reconnect.</p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
