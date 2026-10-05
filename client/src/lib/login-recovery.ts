import { STORAGE_KEYS } from '@/constants/storageKeys';

export interface LoginAttempt {
  id: string;
  proof: string;
  method: 'password' | 'google';
  intent: 'recover' | 'cancel';
  createdAt: number;
  oauthState?: string;
}

const key = (id: string) => `${STORAGE_KEYS.LOGIN_RECOVERY_PREFIX}${id}`;
const cancelKey = (id: string) => `${STORAGE_KEYS.LOGIN_CANCEL_PREFIX}${id}`;
const randomHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)),
  value => value.toString(16).padStart(2, '0')).join('');

export function readLoginAttempt(id: string): LoginAttempt | null {
  // Cancellation is a separate durable record: a concurrently completing login
  // may retire its recovery record, but must never erase cancellation intent.
  const saved = localStorage.getItem(cancelKey(id)) ?? localStorage.getItem(key(id));
  if (saved === null) return null;
  const value = JSON.parse(saved) as LoginAttempt;
  if (value.id !== id || !/^[a-f0-9]{32}$/.test(value.id) || !/^[a-f0-9]{64}$/.test(value.proof) ||
      !['password', 'google'].includes(value.method) || !['recover', 'cancel'].includes(value.intent) ||
      !Number.isFinite(value.createdAt) || (value.oauthState !== undefined && typeof value.oauthState !== 'string')) {
    throw new Error('Saved sign-in recovery is unavailable. Check browser storage before trying again.');
  }
  return value;
}

export function listLoginAttempts(): LoginAttempt[] {
  const ids = new Set<string>();
  for (let index = 0; index < localStorage.length; index += 1) {
    const name = localStorage.key(index);
    if (name?.startsWith(STORAGE_KEYS.LOGIN_RECOVERY_PREFIX)) ids.add(name.slice(STORAGE_KEYS.LOGIN_RECOVERY_PREFIX.length));
    if (name?.startsWith(STORAGE_KEYS.LOGIN_CANCEL_PREFIX)) ids.add(name.slice(STORAGE_KEYS.LOGIN_CANCEL_PREFIX.length));
  }
  const records = Array.from(ids, readLoginAttempt).filter((attempt): attempt is LoginAttempt => attempt !== null);
  return records.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function save(attempt: LoginAttempt) {
  const encoded = JSON.stringify(attempt);
  const storageKey = attempt.intent === 'cancel' ? cancelKey(attempt.id) : key(attempt.id);
  localStorage.setItem(storageKey, encoded);
  if (localStorage.getItem(storageKey) !== encoded) throw new Error('Could not save sign-in recovery.');
}

export function createLoginAttempt(method: LoginAttempt['method'], oauthState?: string): LoginAttempt {
  // Separate durable keys preserve both proofs if different tabs start together.
  const attempt: LoginAttempt = { id: randomHex(16), proof: randomHex(32), method,
    intent: 'recover', createdAt: Date.now(), ...(oauthState ? { oauthState } : {}) };
  save(attempt);
  return attempt;
}

export function cancelLoginAttempt(attempt: LoginAttempt): LoginAttempt | null {
  const current = readLoginAttempt(attempt.id);
  if (current && current.proof !== attempt.proof) return null;
  const cancelling = { ...(current ?? attempt), intent: 'cancel' as const };
  save(cancelling);
  return cancelling;
}

export function removeLoginAttempt(attempt: LoginAttempt) {
  const current = readLoginAttempt(attempt.id);
  if (current?.proof !== attempt.proof || current.intent !== attempt.intent) return;
  localStorage.removeItem(key(attempt.id));
  if (attempt.intent === 'cancel') localStorage.removeItem(cancelKey(attempt.id));
}

export function saveLoginSessionOwner(attempt: LoginAttempt, token: string) {
  localStorage.setItem(STORAGE_KEYS.LOGIN_SESSION_OWNER, JSON.stringify({ attemptId: attempt.id, token }));
}

export function isLoginSessionCancelled(token: string): boolean {
  const encoded = localStorage.getItem(STORAGE_KEYS.LOGIN_SESSION_OWNER);
  if (!encoded) return false;
  const owner = JSON.parse(encoded) as { attemptId?: string; token?: string };
  return owner.token === token && typeof owner.attemptId === 'string' && readLoginAttempt(owner.attemptId)?.intent === 'cancel';
}

export function clearLoginSessionOwner(token: string | null) {
  const encoded = localStorage.getItem(STORAGE_KEYS.LOGIN_SESSION_OWNER);
  if (encoded && (JSON.parse(encoded) as { token?: string }).token === token) {
    localStorage.removeItem(STORAGE_KEYS.LOGIN_SESSION_OWNER);
  }
}

export async function postLoginRequest(url: string, body: object): Promise<{ response: Response; data: Record<string, unknown> }> {
  const abort = new AbortController();
  const timeout = window.setTimeout(() => abort.abort(), 30000);
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: abort.signal });
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid sign-in response');
    return { response, data };
  } finally { window.clearTimeout(timeout); }
}
