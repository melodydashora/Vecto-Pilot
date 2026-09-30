import { STORAGE_KEYS } from '@/constants/storageKeys';

// Only a rejection of the credential still stored for this request can end
// the current session. Connection failures and earlier accounts do not.
export function handleRequestAuthFailure(status: number, capturedToken: string): boolean {
  if (status !== 401 || !capturedToken || localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) !== capturedToken) return false;
  window.dispatchEvent(new CustomEvent('vecto-auth-error', {
    detail: { status: 401, token: capturedToken, error: 'unauthorized' },
  }));
  return true;
}
