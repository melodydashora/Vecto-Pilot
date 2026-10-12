import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { API_ROUTES } from '@/constants/apiRoutes';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { normalizeCoordinates } from '@shared/coordinates.js';
import { freshPosition, withSnapshotDeadline } from '@/lib/location/fresh-position';
import { handleRequestAuthFailure } from '@/lib/session-auth';

export interface CoachSnapshot {
  snapshot_id: string;
  user_id: string;
  sessionId: string;
  context_kind: 'coach';
  city: string;
  state: string;
  timeZone: string;
  gps_timestamp: number;
  lat: number;
  lng: number;
  accuracy: number;
  created_at: string;
}
type Scope = { token: string; ownerId: string; sessionId: string } | null;
type State = { scope: Scope; snapshot: CoachSnapshot | null; loading: boolean; refreshing: boolean; error: string | null };
const empty: State = { scope: null, snapshot: null, loading: false, refreshing: false, error: null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const permissionMessage = 'Location permission was denied. Enable precise location, then refresh Coach context.';

function confirmedSnapshot(value: any, scope: NonNullable<Scope>, captureId?: string): CoachSnapshot {
  if (!value || value.ok !== true || value.context_kind !== 'coach' ||
      value.user_id !== scope.ownerId || value.sessionId !== scope.sessionId ||
      !text(value.snapshot_id) || !uuid.test(value.snapshot_id) || (captureId && value.snapshot_id !== captureId)) {
    throw new Error('Coach location did not confirm this session.');
  }
  if (value.status !== 'ok' || value.ready !== true ||
      typeof value.lat !== 'number' || typeof value.lng !== 'number' || !normalizeCoordinates(value.lat, value.lng) ||
      !text(value.city) || !text(value.formattedAddress) || !text(value.timeZone) ||
      !Number.isFinite(value.gps_timestamp) || value.gps_timestamp <= 0 ||
      !Number.isFinite(new Date(value.gps_timestamp).getTime()) ||
      !Number.isFinite(value.accuracy) || value.accuracy <= 0 ||
      !text(value.created_at) || !Number.isFinite(Date.parse(value.created_at)) ||
      !Number.isFinite(value.weather?.tempF) || !text(value.weather?.conditions) ||
      !Number.isFinite(value.air?.aqi) || !text(value.air?.category)) {
    throw new Error('Saved Coach location, weather or air quality is incomplete.');
  }
  try { new Intl.DateTimeFormat('en-US', { timeZone: value.timeZone }).format(); }
  catch { throw new Error('Saved Coach location has no verified timezone.'); }
  return value;
}

// Coach observations have their own server rows. This hook never publishes MAIN
// location events, prepares Briefing, reloads setup or changes the chat identity.
export function useCoachSnapshot() {
  const { user, token, sessionId, isAuthenticated } = useAuth();
  const scope = useMemo<Scope>(() => token && user?.userId && sessionId && isAuthenticated
    ? { token, ownerId: user.userId, sessionId } : null, [token, user?.userId, sessionId, isAuthenticated]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const operation = useRef<AbortController | null>(null);
  const captureOperation = useRef<AbortController | null>(null);
  const captureFlight = useRef<{ scope: Scope; controller: AbortController; promise: Promise<string | null> } | null>(null);
  const deniedPermission = useRef<Scope>(null);
  const lastObservation = useRef<{ scope: Scope; snapshot: CoachSnapshot | null } | null>(null);
  const [state, setState] = useState<State>(empty);
  const current = state.scope === scope ? state : empty;

  const owns = useCallback((controller: AbortController) => scope !== null && scopeRef.current === scope &&
    operation.current === controller && !controller.signal.aborted &&
    localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) === scope.token, [scope]);

  const read = useCallback(async (controller: AbortController, capture?: { captureId: string; lat: number; lng: number; accuracy: number; gps_timestamp: number; permission: 'granted' }) => {
    if (!scope) return null;
    return withSnapshotDeadline(controller.signal, async signal => {
      const response = await fetch(API_ROUTES.COACH.SNAPSHOT, {
        method: capture ? 'POST' : 'GET', cache: 'no-store', signal,
        headers: { Authorization: `Bearer ${scope.token}`, ...(capture && { 'Content-Type': 'application/json' }) },
        ...(capture && { body: JSON.stringify(capture) }),
      });
      if (!owns(controller) || signal.aborted) return null;
      if (handleRequestAuthFailure(response.status, scope.token)) throw new Error('Your session ended. Sign in again to refresh Coach context.');
      const receipt = await response.json();
      if (!owns(controller) || signal.aborted) return null;
      if (!response.ok) throw new Error(typeof receipt?.message === 'string' ? receipt.message : 'Coach context could not be refreshed. Please try again.');
      if (!capture && receipt?.ok === true && receipt.snapshot === null) return null;
      return confirmedSnapshot(receipt, scope, capture?.captureId);
    });
  }, [scope, owns]);

  const refresh = useCallback((): Promise<string | null> => {
    if (!scope || scopeRef.current !== scope || localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) !== scope.token) return Promise.resolve(null);
    const pending = captureFlight.current;
    if (pending?.scope === scope && !pending.controller.signal.aborted) return pending.promise;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    captureOperation.current = controller;
    setState(previous => ({ ...(previous.scope === scope ? previous : empty), scope, loading: false, refreshing: true, error: null }));
    const promise = Promise.resolve().then(async () => {
      try {
        if (!owns(controller)) return null;
        if (deniedPermission.current === scope) throw new Error(permissionMessage);
        const fix = await freshPosition(controller.signal);
        if (!owns(controller)) return null;
        const snapshot = await read(controller, { captureId: crypto.randomUUID(), lat: fix.lat, lng: fix.lng,
          accuracy: fix.accuracy, gps_timestamp: fix.timestamp, permission: 'granted' });
        if (!owns(controller) || !snapshot) return null;
        const previous = lastObservation.current?.scope === scope ? lastObservation.current.snapshot : null;
        const adopted = previous && previous.gps_timestamp > snapshot.gps_timestamp ? previous : snapshot;
        lastObservation.current = { scope, snapshot: adopted };
        setState({ ...empty, scope, snapshot: adopted });
        return adopted.snapshot_id;
      } catch (error) {
        if (owns(controller)) setState(previous => ({ ...(previous.scope === scope ? previous : empty), scope,
          loading: false, refreshing: false, error: error instanceof Error ? error.message : 'Coach context could not be refreshed.' }));
        return null;
      } finally {
        if (operation.current === controller) operation.current = null;
        if (captureOperation.current === controller) captureOperation.current = null;
        if (captureFlight.current?.controller === controller) captureFlight.current = null;
      }
    });
    captureFlight.current = { scope, controller, promise };
    return promise;
  }, [scope, owns, read]);

  // Activation restores historical context, then refreshes once. Concurrent
  // explicit/model requests join that capture; foreground never requests GPS.
  useEffect(() => {
    if (!scope) return;
    const controller = new AbortController();
    operation.current = controller;
    lastObservation.current = { scope, snapshot: null };
    setState({ ...empty, scope, loading: true });
    void read(controller).then(snapshot => {
      if (owns(controller)) {
        lastObservation.current = { scope, snapshot };
        setState({ ...empty, scope, snapshot, error: deniedPermission.current === scope ? permissionMessage : null });
      }
    }).catch(error => {
      if (owns(controller)) setState({ ...empty, scope, error: error instanceof Error ? error.message : 'Saved Coach context could not be read.' });
    }).finally(() => {
      if (owns(controller)) { operation.current = null; void refresh(); }
      else if (operation.current === controller) operation.current = null;
    });
    return () => {
      operation.current?.abort(); operation.current = null; captureOperation.current = null; captureFlight.current = null;
    };
  }, [scope, read, owns, refresh]);

  useEffect(() => {
    if (!scope || !navigator.permissions?.query) return;
    let active = true;
    let permission: PermissionStatus | null = null;
    const changed = () => {
      if (!active || scopeRef.current !== scope) return;
      if (permission?.state === 'denied') {
        deniedPermission.current = scope;
        captureOperation.current?.abort();
        if (operation.current === captureOperation.current) operation.current = null;
        captureOperation.current = null;
        captureFlight.current = null;
        setState(previous => ({ ...(previous.scope === scope ? previous : empty), scope, refreshing: false, error: permissionMessage }));
      } else if (deniedPermission.current === scope) deniedPermission.current = null;
    };
    void navigator.permissions.query({ name: 'geolocation' }).then(value => {
      if (!active || scopeRef.current !== scope) return;
      permission = value;
      permission.addEventListener('change', changed);
      changed();
    }).catch(() => { /* GPS remains authoritative in browsers without Permissions support. */ });
    return () => { active = false; permission?.removeEventListener('change', changed); };
  }, [scope]);

  return { snapshot: current.snapshot, loading: current.loading, refreshing: current.refreshing,
    error: current.error, canRefresh: !!scope, refresh };
}
