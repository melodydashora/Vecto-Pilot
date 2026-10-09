# Session replacement wording retired October 9, 2026

Codex/Astra, implementing Melody's request to close an inaccessible session from
sign-in. This records superseded source wording; it does not assert deployment.

In `server/api/auth/auth.js`, the Google admission comment read:

```javascript
// Account/link writes and admission commit together. If a prior session is
// live, refusal also rolls back a verified existing account's Google link.
```

It now describes refusal of replacement: an explicitly confirmed, matching
session can be replaced after fresh authentication. Transaction rollback still
preserves account linking and the prior session on failure.

In `client/src/pages/auth/google/Callback.tsx`, the exchange comment read:

```javascript
// Reuse a one-time exchange during StrictMode effect replay; never retry conflicts.
```

The callback still shares its one-time exchange and never repeats a consumed code.
An explicit replacement action starts a fresh Google authorization flow.

The old session error in `server/lib/auth/driver-session.js` read:

> You already have an active session. Log out of that session before starting a new one.

It now explains that the driver can close the old session and sign in here.
See [authentication](../AUTH.md) for exact-session matching, recovery, token-binding
limits and the distinction between source verification and deployment.
