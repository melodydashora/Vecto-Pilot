import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './auth-context';
import { useRunSetup } from './run-setup-context';
import { API_ROUTES } from '@/constants/apiRoutes';
import { normalizeCoordinates, validateGpsFix } from '@shared/coordinates.js';
import { handleRequestAuthFailure } from '@/lib/session-auth';

interface LocationContextType {
  currentCoords: { latitude: number; longitude: number } | null;
  currentLocationString: string;
  city: string | null;
  state: string | null;
  timeZone: string | null;
  isUpdating: boolean;
  lastUpdated: string | null;
  refreshGPS: () => Promise<string | null>;
  overrideCoords: { latitude: number; longitude: number; city?: string } | null;
  weather: { temp: number; conditions: string; description?: string } | null;
  airQuality: { aqi: number; category: string } | null;
  isLocationResolved: boolean;
  isLoading: boolean;
  setOverrideCoords: (coords: { latitude: number; longitude: number; city?: string } | null) => void;
  lastSnapshotId: string | null;
  runId: string | null;
  locationRequested?: boolean;
  contextReady?: boolean;
  collectionId?: string | null;
  locationError?: { code: string; message: string } | null;
}
export const LocationContext = createContext<LocationContextType | null>(null);
export function useLocation() {
  const context = useContext(LocationContext);
  if (!context) throw new Error('useLocation must be used within LocationProvider');
  return context;
}
type Fix = { lat: number; lng: number; accuracy: number; timestamp: number };
function freshPosition(signal: AbortSignal): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('This browser does not support precise location.')); return; }
    let settled = false;
    const finish = (error?: Error, fix?: Fix) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve(fix!);
    };
    const aborted = () => finish(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Precise location timed out. Retry when safely parked.')), 17000);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    navigator.geolocation.getCurrentPosition(position => {
      const fix = validateGpsFix({ latitude: position.coords.latitude, longitude: position.coords.longitude,
        accuracy: position.coords.accuracy, timestamp: position.timestamp });
      if (fix.ok === false) { finish(new Error(fix.error)); return; }
      finish(undefined, { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, timestamp: position.timestamp });
    }, error => finish(new Error(error.code === 1 ? 'Location permission was denied. Enable precise location, then continue again.'
      : error.code === 3 ? 'Precise location timed out. Retry when safely parked.' : 'A fresh precise location is unavailable. Retry when safely parked.')),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}
const emptyLocation = {
  currentCoords: null, currentLocationString: 'Getting location…', city: null, state: null, timeZone: null,
  isUpdating: false, lastUpdated: null, overrideCoords: null, weather: null, airQuality: null,
  isLocationResolved: false, isLoading: false, lastSnapshotId: null, locationError: null,
};
type LocationData = Omit<LocationContextType, 'refreshGPS' | 'setOverrideCoords' | 'runId'>;

// Restore the server-owned context for a live session. Only first-session GPS
// and an explicit header refresh collect new context; focus/navigation never do.
export function LocationProvider({ children }: { children: React.ReactNode }) {
  const { user, token, isAuthenticated, sessionId } = useAuth();
  const setup = useRunSetup();
  const scope = useMemo(() => token && user?.userId && isAuthenticated
    ? { token, ownerId: user.userId, sessionId: sessionId ?? null } : null,
    [token, user?.userId, isAuthenticated, sessionId]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const setupRef = useRef(setup);
  setupRef.current = setup;
  const collection = useRef<AbortController | null>(null);
  const initialized = useRef<typeof scope>(null);
  const restoredContext = useRef<{ scope: typeof scope; fingerprint: string } | null>(null);
  const deniedPermission = useRef<typeof scope>(null);
  const [saved, setSaved] = useState<{ scope: typeof scope; data: LocationData }>({ scope: null, data: emptyLocation });
  const [requestedScope, setRequestedScope] = useState<typeof scope>(null);
  const [ready, setReady] = useState<{ scope: typeof scope; value: boolean }>({ scope: null, value: false });
  const [capture, setCapture] = useState<{ scope: typeof scope; id: string | null }>({ scope: null, id: null });
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const captureRef = useRef(capture);
  captureRef.current = capture;
  const data = saved.scope === scope ? saved.data : emptyLocation;

  const confirmedLocation = useCallback((resolved: any, readOnly = false): LocationData => {
    if (!scope || resolved.user_id !== scope.ownerId ||
        (scope.sessionId && resolved.sessionId !== scope.sessionId)) {
      throw new Error('Saved location did not confirm this session.');
    }
    const coords = normalizeCoordinates(resolved.lat, resolved.lng);
    const observedAt = typeof resolved.gps_timestamp === 'number' && resolved.gps_timestamp > 0
      ? new Date(resolved.gps_timestamp) : null;
    if (!coords || !resolved.snapshot_id || !resolved.city ||
        (!readOnly && !resolved.timeZone) || (!readOnly && (resolved.status !== 'ok' || resolved.ready !== true || !observedAt || !Number.isFinite(observedAt.getTime()) || !resolved.formattedAddress ||
        !Number.isFinite(resolved.weather?.tempF) || typeof resolved.weather?.conditions !== 'string' ||
        !Number.isFinite(resolved.air?.aqi) || typeof resolved.air?.category !== 'string'))) {
      throw new Error('Saved location, weather or air quality is incomplete.');
    }
    let timeZone: string | null = typeof resolved.timeZone === 'string' && resolved.timeZone ? resolved.timeZone : null;
    if (timeZone) {
      try { new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date()); }
      catch { timeZone = null; }
    }
    if (!readOnly && !timeZone) throw new Error('Your saved location has no verified timezone.');
    return { ...emptyLocation, currentCoords: { latitude: coords.lat, longitude: coords.lng },
      currentLocationString: resolved.formattedAddress || [resolved.city, resolved.state].filter(Boolean).join(', '), city: resolved.city, state: resolved.state,
      timeZone, lastUpdated: observedAt && Number.isFinite(observedAt.getTime()) ? observedAt.toISOString() : null, lastSnapshotId: resolved.snapshot_id,
      isLocationResolved: true, weather: Number.isFinite(resolved.weather?.tempF) && typeof resolved.weather?.conditions === 'string'
        ? { temp: resolved.weather.tempF, conditions: resolved.weather.conditions } : null,
      airQuality: Number.isFinite(resolved.air?.aqi) && typeof resolved.air?.category === 'string'
        ? { aqi: resolved.air.aqi, category: resolved.air.category } : null };
  }, [scope]);

  const prepareBriefing = useCallback(async (snapshotId: string, controller: AbortController) => {
    if (!scope) return false;
    const response = await fetch(API_ROUTES.LOCATION.NEWS_BRIEFING, {
      method: 'POST', headers: { Authorization: 'Bearer ' + scope.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshotId }), signal: controller.signal,
    });
    if (scopeRef.current !== scope || collection.current !== controller || controller.signal.aborted) return false;
    if (handleRequestAuthFailure(response.status, scope.token)) throw new Error('Your session ended. Sign in again to continue.');
    const result = await response.json();
    if (!response.ok || result.success !== true || result.complete !== true) {
      throw new Error(result.message || 'Briefing could not finish. Refresh when you are ready to try again.');
    }
    return true;
  }, [scope]);

  const refreshGPS = useCallback(async (): Promise<string | null> => {
    if (!scope || scopeRef.current !== scope) return null;
    collection.current?.abort();
    const controller = new AbortController();
    collection.current = controller;
    const captureId = crypto.randomUUID();
    const current = () => scopeRef.current === scope && collection.current === controller && !controller.signal.aborted;
    setRequestedScope(scope);
    const activeCapture = { scope, id: captureId };
    captureRef.current = activeCapture;
    setCapture(activeCapture);
    setReady({ scope, value: false });
    // Keep previously resolved context on screen during the explicit refresh.
    setSaved(previous => ({ scope, data: { ...(previous.scope === scope ? previous.data : emptyLocation),
      isUpdating: true, isLoading: true, locationError: null } }));
    try {
      const fix = await freshPosition(controller.signal);
      if (!current()) return null;
      const response = await fetch(API_ROUTES.LOCATION.SNAPSHOT, {
        method: 'POST', headers: { Authorization: 'Bearer ' + scope.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ captureId, lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy,
          gps_timestamp: fix.timestamp, permission: 'granted' }), signal: controller.signal,
      });
      if (!current()) return null;
      if (handleRequestAuthFailure(response.status, scope.token)) return null;
      const resolved = await response.json();
      if (!current()) return null;
      if (!response.ok || resolved.snapshot_id !== captureId) throw new Error(resolved.message || 'Your fresh location could not be saved.');
      const confirmed = confirmedLocation(resolved);
      setSaved({ scope, data: { ...confirmed, isUpdating: true } });
      window.dispatchEvent(new CustomEvent('vecto-snapshot-saved', { detail: { snapshotId: captureId, reason: 'context' } }));
      await prepareBriefing(captureId, controller);
      if (!current()) return null;
      // Confirm the same source in the canonical session before a header action
      // can admit Strategy. Failed readback leaves generation held.
      const canonical = await setupRef.current.reload();
      if (!current()) return null;
      if (!canonical || canonical.sessionId !== (scope.sessionId ?? resolved.sessionId) ||
          !canonical.currentSnapshot?.ready || !canonical.currentSnapshot.briefingReady ||
          canonical.currentSnapshot.user_id !== scope.ownerId || canonical.currentSnapshot.sessionId !== canonical.sessionId ||
          (canonical.currentSnapshot.snapshot_id !== captureId && canonical.currentSnapshot.sourceSnapshotId !== captureId)) {
        throw new Error('Refreshed context could not be confirmed. Review it before starting Strategy.');
      }
      setReady({ scope, value: true });
      setSaved({ scope, data: confirmed });
      return captureId;
    } catch (error) {
      if (!current()) return null;
      const message = error instanceof Error ? error.message : 'Fresh location is unavailable.';
      setSaved(previous => ({ scope, data: { ...(previous.scope === scope ? previous.data : emptyLocation),
        isUpdating: false, isLoading: false, locationError: { code: 'context_preparation_failed', message } } }));
      return null;
    } finally { if (collection.current === controller) collection.current = null; }
  }, [scope, confirmedLocation, prepareBriefing]);

  useEffect(() => {
    if (!scope || setup.loading || !setup.setup || (collection.current && !collection.current.signal.aborted)) return;
    const firstContext = initialized.current !== scope;
    const fingerprint = JSON.stringify([setup.setup.currentSnapshot ?? null, setup.setup.currentContextPending === true]);
    if (!firstContext && restoredContext.current?.scope === scope && restoredContext.current.fingerprint === fingerprint) return;
    initialized.current = scope;
    restoredContext.current = { scope, fingerprint };
    const snapshot = setup.setup.currentSnapshot;
    if (!snapshot) {
      setReady({ scope, value: false });
      if (setup.setup.currentContextPending) {
        setRequestedScope(scope);
        setSaved({ scope, data: { ...emptyLocation, currentLocationString: 'Previous refresh unfinished',
          locationError: { code: 'context_preparation_unfinished', message: 'Your previous refresh did not finish. Use Refresh when you’re ready to try again.' } } });
      } else if (firstContext) void refreshGPS();
      else {
        setSaved(previous => ({ scope, data: { ...(previous.scope === scope ? previous.data : emptyLocation),
          locationError: { code: 'context_incomplete', message: 'Saved context is unavailable. Use Refresh when you’re ready.' } } }));
      }
      return;
    }
    // Reconcile changed canonical context with read-only data. Unchanged focus
    // reads preserve local holds; interrupted preparation stays a manual retry.
    try {
      const confirmed = confirmedLocation(snapshot, true);
      setSaved({ scope, data: confirmed });
      setRequestedScope(scope);
      const permissionDenied = deniedPermission.current === scope;
      setReady({ scope, value: !permissionDenied && !!confirmed.timeZone && !setup.setup.currentContextPending && snapshot.ready === true && snapshot.briefingReady === true });
      if (permissionDenied || !confirmed.timeZone || setup.setup.currentContextPending || !snapshot.ready || !snapshot.briefingReady) setSaved({ scope, data: { ...confirmed,
        locationError: permissionDenied
          ? { code: 'location_permission_denied', message: 'Location permission was denied. Enable location, then use Refresh when ready.' }
          : !confirmed.timeZone
          ? { code: 'context_incomplete', message: 'Saved location has no verified timezone. Use Refresh when you’re ready.' }
          : setup.setup.currentContextPending
          ? { code: 'context_preparation_unfinished', message: 'Your previous refresh did not finish. Use Refresh when you’re ready to try again.' }
          : !snapshot.ready
          ? { code: 'context_incomplete', message: 'Saved context is incomplete. Use Refresh when you’re ready.' }
          : { code: 'briefing_incomplete', message: 'Briefing is unfinished. Use Refresh to try again when ready.' } } });
    } catch (error) {
      setRequestedScope(scope);
      setSaved({ scope, data: { ...emptyLocation, locationError: { code: 'saved_context_incomplete',
        message: error instanceof Error ? error.message : 'Saved context could not be restored.' } } });
    }
  }, [scope, setup.loading, setup.setup, refreshGPS, confirmedLocation, data.isUpdating]);

  useEffect(() => {
    if (!scope) return;
    let active = true;
    let permission: PermissionStatus | null = null;
    const holdContext = (code: string, message: string) => {
      if (!active || scopeRef.current !== scope) return;
      collection.current?.abort();
      collection.current = null;
      setReady({ scope, value: false });
      setSaved(previous => ({ scope, data: { ...(previous.scope === scope ? previous.data : emptyLocation),
        isUpdating: false, isLoading: false, locationError: { code, message } } }));
    };
    const revoked = () => {
      if (permission?.state === 'denied') {
        deniedPermission.current = scope;
        holdContext('location_permission_denied', 'Location permission was denied. Enable location, then use Refresh when ready.');
      } else if (deniedPermission.current === scope) deniedPermission.current = null;
    };
    const ownershipError = (event: Event) => {
      const failedId = (event as CustomEvent).detail?.snapshotId;
      const known = savedRef.current.scope === scope ? savedRef.current.data.lastSnapshotId : null;
      const pending = captureRef.current.scope === scope ? captureRef.current.id : null;
      const collecting = collection.current && !collection.current.signal.aborted;
      const currentId = collecting ? pending : known;
      if (failedId && failedId !== currentId) return;
      holdContext('snapshot_ownership_error', 'Saved context could not be verified for this session. Use Refresh when ready.');
    };
    const briefingFailed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail || detail.ownerId !== scope.ownerId || detail.sessionId !== scope.sessionId) return;
      const known = savedRef.current.scope === scope ? savedRef.current.data.lastSnapshotId : null;
      const pending = captureRef.current.scope === scope ? captureRef.current.id : null;
      const currentId = collection.current && !collection.current.signal.aborted ? pending : known;
      if (!detail.snapshotId || detail.snapshotId !== currentId) return;
      holdContext('briefing_failed', typeof detail.message === 'string' && detail.message.trim()
        ? detail.message : 'Briefing could not be completed. Please come back later.');
    };
    window.addEventListener('snapshot-ownership-error', ownershipError);
    window.addEventListener('vecto-briefing-failed', briefingFailed);
    if (navigator.permissions?.query) {
      void navigator.permissions.query({ name: 'geolocation' }).then(status => {
        if (!active || scopeRef.current !== scope) return;
        permission = status;
        permission.addEventListener('change', revoked);
        revoked();
      }).catch(() => { /* The GPS request remains authoritative where Permissions is unsupported. */ });
    }
    return () => {
      active = false;
      permission?.removeEventListener('change', revoked);
      window.removeEventListener('snapshot-ownership-error', ownershipError);
      window.removeEventListener('vecto-briefing-failed', briefingFailed);
    };
  }, [scope]);

  useEffect(() => () => { collection.current?.abort(); }, [scope]);
  const setOverrideCoords = useCallback(() => {
    // Current GPS cannot be replaced with an unverified city or home address.
    setupRef.current.reviewSetup();
  }, []);
  const value = useMemo(() => ({ ...data, refreshGPS, setOverrideCoords, runId: setup.run?.runId ?? null,
    locationRequested: !!scope && requestedScope === scope, contextReady: ready.scope === scope && ready.value,
    collectionId: capture.scope === scope ? capture.id : null }),
    [data, refreshGPS, setOverrideCoords, setup.run?.runId, scope, requestedScope, ready, capture]);
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}
