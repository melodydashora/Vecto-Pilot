import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './auth-context';
import { API_ROUTES } from '@/constants/apiRoutes';
import type { DriverProfile, DriverVehicle } from '@/types/auth';
import type { OfferRulesetConfig } from '@/lib/offer-ruleset-schema';
import { handleRequestAuthFailure } from '@/lib/session-auth';

export interface MainRun {
  runId: string;
  sessionId: string;
  settingsRevision: number;
  rulesVersion: number;
  rulesHash: string;
  snapshotId: string | null;
  sourceSnapshotId?: string | null;
  status: string;
}
export interface SavedSnapshot {
  snapshot_id: string;
  user_id: string;
  sessionId: string;
  sourceSnapshotId: string;
  status: string;
  ready: boolean;
  briefingReady: boolean;
  briefingFailed?: boolean;
  briefingStatus?: string | null;
  lat: number;
  lng: number;
  city: string;
  state: string | null;
  country: string;
  formattedAddress: string;
  timeZone: string;
  gps_timestamp: number;
  accuracy: number;
  weather: { tempF: number; conditions: string; [key: string]: unknown };
  air: { aqi: number; category: string; [key: string]: unknown };
  created_at: string;
}
export interface SavedSetup {
  sessionId: string;
  settingsRevision: number | null;
  rulesVersion: number | null;
  rulesHash: string | null;
  profile: DriverProfile | null;
  vehicle: DriverVehicle | null;
  rules: OfferRulesetConfig;
  ready: boolean;
  missingFields: string[];
  currentRun: MainRun | null;
  previousRun?: MainRun | null;
  currentSnapshot?: SavedSnapshot | null;
  currentContextPending?: boolean;
}
type SetupEditor = 'preferences' | 'offerAnalyzer';
interface ContinueIntent {
  fingerprint: string;
  body: {
    requestId: string;
    expectedSettingsRevision: number | null;
    expectedRulesVersion: number | null;
    expectedRulesHash: string | null;
    expectedRunId: string | null;
    expectedSnapshotId: string;
  };
}
interface RunSetupValue {
  setup: SavedSetup | null;
  run: MainRun | null;
  view: 'summary' | 'editor' | 'ready' | 'running';
  reviewOpen: boolean;
  canContinue: boolean;
  preferencesConfirmed: boolean;
  saveUnconfirmed: boolean;
  unsavedEditors: SetupEditor[];
  draftResetVersion: number;
  getEditorDraft: <T>(editor: SetupEditor) => T | null;
  setEditorDraft: (editor: SetupEditor, draft: unknown | null) => void;
  loading: boolean;
  starting: boolean;
  saving: boolean;
  error: string | null;
  reload: () => Promise<SavedSetup | null>;
  reviewSetup: (discardUnsavedChanges?: boolean) => void;
  dismissReview: () => void;
  editSetup: () => void;
  beginSave: () => (() => void);
  finishSave: () => Promise<boolean>;
  confirmPreferences: () => boolean;
  continueWithSavedPreferences: (expectedSnapshotId: string) => Promise<boolean>;
}
const RunSetupContext = createContext<RunSetupValue | null>(null);
export function useRunSetup() {
  const value = useContext(RunSetupContext);
  if (!value) throw new Error('useRunSetup must be used within RunSetupProvider');
  return value;
}

// Restore canonical session data without treating hydration or focus as a new
// start. Only an explicit Strategy/header action creates another admission.
export function RunSetupProvider({ children }: { children: React.ReactNode }) {
  const { user, token, isAuthenticated } = useAuth();
  const scope = useMemo(() => user?.userId && token && isAuthenticated
    ? { ownerId: user.userId, token } : null, [user?.userId, token, isAuthenticated]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [state, reactSetState] = useState<{ scope: typeof scope; setup: SavedSetup | null; run: MainRun | null; view: RunSetupValue['view']; reviewOpen: boolean; confirmed: boolean; preferencesConfirmed: boolean; saveUnconfirmed: boolean; loading: boolean; starting: boolean; error: string | null }>({ scope: null, setup: null, run: null, view: 'summary', reviewOpen: false, confirmed: false, preferencesConfirmed: false, saveUnconfirmed: false, loading: false, starting: false, error: null });
  const stateRef = useRef(state);
  stateRef.current = state;
  // Awaited readback is usable by the next explicit action in the same task,
  // before React commits the header's render after that asynchronous operation.
  const setState = useCallback<React.Dispatch<React.SetStateAction<typeof state>>>(update => {
    const next = typeof update === 'function' ? update(stateRef.current) : update;
    stateRef.current = next;
    reactSetState(next);
  }, []);
  const requests = useRef(0);
  const decision = useRef(0);
  const startRef = useRef<{ controller: AbortController } | null>(null);
  const strategyStart = useRef<{ runId: string; snapshotId: string; sourceSnapshotId: string } | null>(null);
  const retry = useRef<ContinueIntent | null>(null);
  const mutations = useRef(new Set<object>());
  const committedSaveAwaitingReadback = useRef(false);
  const hydratedSession = useRef<{ scope: typeof scope; sessionId: string } | null>(null);
  // Drafts survive editor/tab navigation, but never an account or session change.
  const drafts = useRef<{ scope: typeof scope; values: Partial<Record<SetupEditor, unknown>> }>({ scope, values: {} });
  const [unsavedEditors, setUnsavedEditors] = useState<SetupEditor[]>([]);
  const [draftResetVersion, setDraftResetVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const current = state.scope === scope ? state : null;

  const reload = useCallback(async () => {
    if (!scope || scopeRef.current !== scope) return null;
    const request = ++requests.current;
    setState(prev => ({ ...prev, scope, confirmed: false, loading: true, error: null }));
    try {
      const response = await fetch(API_ROUTES.MAIN_RUNS.SETUP, { headers: { Authorization: `Bearer ${scope.token}` }, cache: 'no-store' });
      if (scopeRef.current !== scope || requests.current !== request) return null;
      if (handleRequestAuthFailure(response.status, scope.token)) return null;
      const data = await response.json();
      if (scopeRef.current !== scope || requests.current !== request) return null;
      if (!response.ok) throw new Error(data.message || 'Could not confirm your saved setup.');
      if ((data.profile ? data.profile.userId !== scope.ownerId || !Number.isInteger(data.settingsRevision)
          : data.user?.userId !== scope.ownerId || data.settingsRevision !== null || data.ready !== false) ||
          !data.sessionId || !Array.isArray(data.missingFields)) throw new Error('Saved setup did not confirm this account.');
      if (data.currentSnapshot && (data.currentSnapshot.user_id !== scope.ownerId ||
          data.currentSnapshot.sessionId !== data.sessionId)) throw new Error('Saved location did not confirm this session.');
      const restore = hydratedSession.current?.scope !== scope || hydratedSession.current.sessionId !== data.sessionId;
      const restoredRun = data.currentRun?.sessionId === data.sessionId && data.currentRun?.runId && data.currentRun?.snapshotId
        ? data.currentRun as MainRun : null;
      const restoredConfirmed = !!restoredRun && data.ready && restoredRun.settingsRevision === data.settingsRevision &&
        restoredRun.rulesVersion === data.rulesVersion && restoredRun.rulesHash === data.rulesHash;
      hydratedSession.current = { scope, sessionId: data.sessionId };
      const admitted = stateRef.current.scope === scope ? stateRef.current.run : null;
      const prior = stateRef.current.scope === scope ? stateRef.current : null;
      const changed = !!(admitted && (admitted.settingsRevision !== data.settingsRevision || admitted.rulesVersion !== data.rulesVersion ||
        admitted.rulesHash !== data.rulesHash || data.currentRun?.runId !== admitted.runId)) ||
        !!(prior?.preferencesConfirmed && prior.setup && (prior.setup.settingsRevision !== data.settingsRevision ||
          prior.setup.rulesVersion !== data.rulesVersion || prior.setup.rulesHash !== data.rulesHash));
      if (changed) decision.current++;
      const confirmedSave = committedSaveAwaitingReadback.current;
      committedSaveAwaitingReadback.current = false;
      setState(prev => ({ ...prev, scope, setup: data, confirmed: true, loading: false, error: null,
        ...(restore ? { run: restoredRun, preferencesConfirmed: restoredConfirmed, view: restoredRun ? 'running' as const : 'summary' as const,
          reviewOpen: !restoredConfirmed } : {}),
        ...(confirmedSave ? { saveUnconfirmed: false } : {}),
        ...(!restore && changed ? { run: null, preferencesConfirmed: false, starting: false, view: 'summary' as const, reviewOpen: true } : {}) }));
      return data as SavedSetup;
    } catch (error) {
      if (scopeRef.current === scope && requests.current === request) {
        setState(prev => ({ ...prev, scope, loading: false, error: error instanceof Error ? error.message : 'Could not confirm saved setup.' }));
      }
      return null;
    }
  }, [scope]);

  useEffect(() => {
    decision.current++;
    requests.current++;
    startRef.current?.controller.abort();
    startRef.current = null;
    strategyStart.current = null;
    retry.current = null;
    mutations.current.clear();
    committedSaveAwaitingReadback.current = false;
    hydratedSession.current = null;
    drafts.current = { scope, values: {} };
    setUnsavedEditors([]);
    setDraftResetVersion(version => version + 1);
    setSaving(false);
    setState({ scope, setup: null, run: null, view: 'summary', reviewOpen: !!scope, confirmed: false, preferencesConfirmed: false, saveUnconfirmed: false, loading: !!scope, starting: false, error: null });
    if (scope) void reload();
    return () => {
      decision.current++;
      requests.current++;
      startRef.current?.controller.abort();
      startRef.current = null;
    };
  }, [scope, reload]);

  const hold = useCallback((view: 'summary' | 'editor', reviewOpen = view === 'summary') => {
    if (scopeRef.current !== scope) return;
    decision.current++;
    // A superseded start must not occupy the next decision's request slot.
    // Server admission still verifies revisions; abort is not rollback.
    startRef.current?.controller.abort();
    startRef.current = null;
    strategyStart.current = null;
    retry.current = null;
    setState(prev => ({ ...prev, scope, run: null, preferencesConfirmed: false, view, reviewOpen, starting: false }));
    window.dispatchEvent(new CustomEvent('vecto-main-run-held'));
  }, [scope]);
  const reviewSetup = useCallback((discardUnsavedChanges = false) => {
    hold('summary');
    const discardDecision = decision.current;
    void reload().then(saved => {
      if (saved && discardUnsavedChanges && scopeRef.current === scope &&
          decision.current === discardDecision && !mutations.current.size) {
        drafts.current = { scope, values: {} };
        setUnsavedEditors([]);
        setDraftResetVersion(version => version + 1);
        setState(prev => ({ ...prev, saveUnconfirmed: false }));
      }
    });
  }, [hold, reload, scope]);
  const dismissReview = useCallback(() => { hold('summary', false); }, [hold]);
  const editSetup = useCallback(() => { hold('editor'); }, [hold]);
  const getEditorDraft = useCallback(<T,>(editor: SetupEditor): T | null =>
    drafts.current.scope === scope ? (drafts.current.values[editor] as T | undefined) ?? null : null, [scope]);
  const setEditorDraft = useCallback((editor: SetupEditor, draft: unknown | null) => {
    if (!scope || scopeRef.current !== scope) return;
    if (drafts.current.scope !== scope) drafts.current = { scope, values: {} };
    if (JSON.stringify(drafts.current.values[editor] ?? null) === JSON.stringify(draft)) return;
    if (draft === null) delete drafts.current.values[editor];
    else {
      drafts.current.values[editor] = structuredClone(draft);
      // Typing also invalidates an in-flight Continue; saved readback cannot clear it.
      decision.current++;
      retry.current = null;
      if (stateRef.current.run || stateRef.current.starting) hold('editor');
    }
    setUnsavedEditors(Object.keys(drafts.current.values) as SetupEditor[]);
  }, [scope, hold]);
  const beginSave = useCallback(() => {
    hold('editor');
    committedSaveAwaitingReadback.current = false;
    setState(prev => ({ ...prev, saveUnconfirmed: true }));
    const mutation = { scope };
    mutations.current.add(mutation);
    setSaving(true);
    return () => {
      mutations.current.delete(mutation);
      if (scopeRef.current === scope) setSaving(mutations.current.size > 0);
    };
  }, [hold, scope]);
  const finishSave = useCallback(async () => {
    if (scopeRef.current !== scope) return false;
    committedSaveAwaitingReadback.current = true;
    const saved = await reload();
    if (!saved || scopeRef.current !== scope) return false;
    localStorage.setItem('vecto-saved-setup-changed', JSON.stringify({ ownerId: scope?.ownerId, at: Date.now(), nonce: crypto.randomUUID() }));
    hold('summary');
    return true;
  }, [reload, hold, scope]);

  useEffect(() => {
    if (!scope) return;
    const focused = () => { if (!mutations.current.size && !startRef.current) void reload(); };
    const changed = (event: StorageEvent) => {
      if (event.key !== 'vecto-saved-setup-changed' || !event.newValue) return;
      try { if (JSON.parse(event.newValue).ownerId === scope.ownerId) { hold('summary'); void reload(); } } catch { /* Ignore unrelated malformed storage. */ }
    };
    window.addEventListener('focus', focused);
    window.addEventListener('storage', changed);
    return () => { window.removeEventListener('focus', focused); window.removeEventListener('storage', changed); };
  }, [scope, reload, hold]);

  const confirmPreferences = useCallback(() => {
    const present = stateRef.current;
    if (!scope || present.scope !== scope || !present.setup?.ready || !present.confirmed || present.saveUnconfirmed ||
        present.loading || mutations.current.size || startRef.current ||
        (drafts.current.scope === scope && Object.keys(drafts.current.values).length)) return false;
    setState(prev => ({ ...prev, preferencesConfirmed: true, reviewOpen: false, view: prev.run ? 'running' : 'ready', error: null }));
    return true;
  }, [scope]);

  const continueWithSavedPreferences = useCallback(async (expectedSnapshotId: string) => {
    const saved = stateRef.current.scope === scope ? stateRef.current.setup : null;
    if (!scope || !expectedSnapshotId || !saved?.ready || !stateRef.current.confirmed || !stateRef.current.preferencesConfirmed || stateRef.current.saveUnconfirmed ||
        (drafts.current.scope === scope && Object.keys(drafts.current.values).length > 0) ||
        stateRef.current.loading || mutations.current.size || startRef.current) return false;
    const operation = { controller: new AbortController() };
    startRef.current = operation;
    const revision = decision.current;
    // A readback can reveal a committed admission whose response was lost. Its
    // downstream snapshot is an alias of the same prepared source, not another
    // user intent. Replay the exact original CAS body until this intent resolves.
    const snapshot = saved.currentSnapshot;
    const sourceSnapshotId = snapshot && (expectedSnapshotId === snapshot.snapshot_id || expectedSnapshotId === snapshot.sourceSnapshotId)
      ? snapshot.sourceSnapshotId || snapshot.snapshot_id : expectedSnapshotId;
    const fingerprint = JSON.stringify([scope.ownerId, saved.sessionId, saved.settingsRevision,
      saved.rulesVersion, saved.rulesHash, sourceSnapshotId]);
    if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, body: {
      expectedSettingsRevision: saved.settingsRevision, expectedRulesVersion: saved.rulesVersion,
      expectedRulesHash: saved.rulesHash, expectedRunId: saved.currentRun?.runId ?? null,
      expectedSnapshotId, requestId: crypto.randomUUID() } };
    const intent = retry.current;
    setState(prev => ({ ...prev, starting: true, error: null }));
    try {
      const response = await fetch(API_ROUTES.MAIN_RUNS.CONTINUE, { method: 'POST',
        headers: { Authorization: `Bearer ${scope.token}`, 'Content-Type': 'application/json' },
        signal: operation.controller.signal,
        body: JSON.stringify(intent.body) });
      if (scopeRef.current !== scope || decision.current !== revision || operation.controller.signal.aborted) return false;
      if (handleRequestAuthFailure(response.status, scope.token)) return false;
      const run = await response.json();
      if (scopeRef.current !== scope || decision.current !== revision) return false;
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) retry.current = null;
        if (response.status === 409) await reload();
        throw new Error(run.message || 'Your saved setup changed. Review it before continuing.');
      }
      if (run.current === false) {
        hold('summary');
        const heldDecision = decision.current;
        await reload();
        if (scopeRef.current === scope && decision.current === heldDecision) setState(prev => ({ ...prev,
          error: 'That start belongs to an earlier setup. Review your current saved setup before continuing.' }));
        return false;
      }
      if (!run.runId || !run.snapshotId || run.sessionId !== saved.sessionId || run.settingsRevision !== saved.settingsRevision ||
          run.rulesVersion !== saved.rulesVersion || run.rulesHash !== saved.rulesHash) throw new Error('The new run did not confirm your saved setup.');
      retry.current = null;
      strategyStart.current = { runId: run.runId, snapshotId: run.snapshotId, sourceSnapshotId: run.sourceSnapshotId ?? intent.body.expectedSnapshotId };
      setState(prev => ({ ...prev, run, view: 'running', reviewOpen: false, starting: false, error: null,
        setup: prev.setup ? { ...prev.setup, currentRun: run } : null }));
      return true;
    } catch (error) {
      if (scopeRef.current === scope && (decision.current === revision || startRef.current === operation)) setState(prev => ({ ...prev, starting: false,
        error: error instanceof Error ? error.message : 'Could not start. Your setup is still held.' }));
      return false;
    } finally { if (startRef.current === operation) startRef.current = null; }
  }, [scope, reload, hold]);

  useEffect(() => {
    const event = strategyStart.current;
    if (!event || current?.run?.runId !== event.runId || current.run.snapshotId !== event.snapshotId) return;
    strategyStart.current = null;
    window.dispatchEvent(new CustomEvent('vecto-strategy-started', { detail: event }));
  }, [current?.run?.runId, current?.run?.snapshotId]);

  return <RunSetupContext.Provider value={{ setup: current?.setup ?? null, run: current?.run ?? null,
    view: current?.view ?? 'summary', loading: current?.loading ?? !!scope, starting: current?.starting ?? false,
    reviewOpen: current?.reviewOpen ?? false, saveUnconfirmed: current?.saveUnconfirmed ?? false,
    preferencesConfirmed: current?.preferencesConfirmed ?? false,
    unsavedEditors: current ? unsavedEditors : [], draftResetVersion, getEditorDraft, setEditorDraft,
    canContinue: !!current?.setup?.ready && current.confirmed && !current.saveUnconfirmed && !unsavedEditors.length && !current.loading && !current.starting && !saving,
    saving, error: current?.error ?? null, reload, reviewSetup, dismissReview, editSetup, beginSave, finishSave, confirmPreferences, continueWithSavedPreferences }}>
    {children}
  </RunSetupContext.Provider>;
}
