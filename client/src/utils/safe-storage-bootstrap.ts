// client/src/utils/safe-storage-bootstrap.ts
// 2026-05-30: Resilient storage bootstrap — MUST run before React mounts.
//
// WHY: On iOS Safari (and others) third-party storage is blocked inside cross-site
// iframes — e.g. the Replit webview. There, *accessing* window.localStorage /
// window.sessionStorage throws a SecurityError (it does not merely return null).
// Our App-level context providers (auth/location/co-pilot) read storage on mount,
// so that throw crashed the entire React tree into the App ErrorBoundary fallback
// (SafeScaffold: "Something went wrong loading the app"). The very same URL opened
// first-party (not embedded in an iframe) worked fine — the classic signature.
//
// FIX: probe each storage area once; if access throws, shadow it with an in-memory
// implementation so every call site degrades gracefully (no cross-reload
// persistence) instead of crashing. Completely no-op when storage works normally.
//
// This is intentionally a side-effecting module imported first in main.tsx.

function createMemoryStorage(): Storage {
  let store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store = new Map();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  } as Storage;
}

function harden(kind: 'localStorage' | 'sessionStorage'): void {
  try {
    const probe = '__vecto_storage_probe__';
    const s = window[kind]; // throws here in a blocked cross-site iframe
    s.setItem(probe, '1'); // ...or throws here if access is read-only-blocked
    s.removeItem(probe);
    // Storage works — leave the native implementation untouched.
  } catch {
    try {
      Object.defineProperty(window, kind, {
        value: createMemoryStorage(),
        configurable: true,
      });
      // eslint-disable-next-line no-console
      console.warn(
        `[VectoPilot] ${kind} is blocked (cross-site iframe / private mode) — ` +
          `using an in-memory fallback. Sessions will not persist in this context.`,
      );
    } catch {
      // Could not shadow the property (older engine) — nothing safe left to do.
    }
  }
}

try {
  harden('localStorage');
  harden('sessionStorage');
} catch {
  // The storage shim itself must never break app boot.
}

export {};
