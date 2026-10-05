import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';

export default function LoginRecovery() {
  const { pendingLoginCount, loginRecoveryBusy, loginRecoveryError, loginCancellationPending,
    recoverLogin, cancelPendingLogin } = useAuth();
  return <div className="min-h-dvh flex items-center justify-center bg-gray-50 p-4">
    <Card className="w-full max-w-md bg-white border-gray-200 shadow-lg">
      <CardHeader>
        <CardTitle className="text-gray-900">{loginCancellationPending ? 'Finish cancelling sign-in' : 'Check your sign-in'}</CardTitle>
        <CardDescription className="text-gray-600">{loginCancellationPending
          ? 'Confirm cancellation before starting another sign-in.'
          : 'Recover your existing sign-in before starting another session.'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {pendingLoginCount > 1 && <p className="text-sm text-gray-600">{pendingLoginCount} sign-in attempts need checking. Each will be handled separately.</p>}
        {loginRecoveryError && <p role="alert" className="text-sm text-red-700">{loginRecoveryError}</p>}
        {loginRecoveryBusy && <p role="status" className="text-sm text-gray-600">Checking your sign-in…</p>}
        <Button type="button" className="w-full" disabled={loginRecoveryBusy} onClick={() => { void recoverLogin(); }}>
          {loginRecoveryBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {loginRecoveryBusy ? 'Checking…' : 'Try again'}
        </Button>
        {!loginCancellationPending && <Button type="button" variant="outline" className="w-full" onClick={() => { void cancelPendingLogin(); }}>Cancel sign-in</Button>}
      </CardContent>
    </Card>
  </div>;
}
