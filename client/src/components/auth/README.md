> **Last Verified:** 2026-09-29 (synthetic client auth and isolated session tests)

# Auth Components (`client/src/components/auth/`)

## Purpose

Authentication-related UI components for protecting routes and managing auth state.

## Files

| File | Purpose |
|------|---------|
| `ProtectedRoute.tsx` | Protects private routes while verifying saved sessions |
| `AuthRedirect.tsx` | Routes the root entry after session verification |
| `SessionCheck.tsx` | Shared loading and recoverable session-check view |

## ProtectedRoute

A wrapper component that protects routes from unauthorized access.

**Behavior:**
1. Shows loading spinner while checking auth status
2. Keeps an interrupted saved-session check on a retry screen; temporary connection failures do not clear the token or saved data
3. Redirects to `/auth/sign-in` when no authenticated session remains
4. Saves attempted location for post-login redirect
5. Renders children if authenticated

**Usage:**
```tsx
import ProtectedRoute from '@/components/auth/ProtectedRoute';

// In routes.tsx
<Route
  path="/co-pilot/*"
  element={
    <ProtectedRoute>
      <CoPilotLayout />
    </ProtectedRoute>
  }
/>
```

## AuthRedirect

Handles the root route after checking authentication.

**Behavior:**
1. Waits for session verification and shares the retry screen after temporary failure
2. Redirects an authenticated driver to `/co-pilot/strategy`
3. Redirects a driver without an authenticated session to `/auth/sign-in`

**Usage:**
```tsx
import AuthRedirect from '@/components/auth/AuthRedirect';

// In the root entry route
<Route path="/" element={<AuthRedirect />} />
```

## Dependencies

- `@/contexts/auth-context` - `useAuth` hook for auth state
- `react-router-dom` - Navigation and location
- `lucide-react` - Loading spinner icon

## Connections

`AuthProvider` retries an interrupted initial verification on explicit retry,
network recovery or foreground return. A verified mounted session does not trigger
a new login or workflow on focus. The server retains its existing 60-minute
inactivity window and two-hour absolute limit; the client does not extend either.
An actual `401` still clears the rejected session. Account transitions fence old
responses before they can change the new owner's state.

- **State from:** `../../contexts/auth-context.tsx`
- **Used by:** `../../routes.tsx`
- **Redirects to:** `/auth/sign-in` (from `../../pages/auth/`)

## See Also

- [`../pages/auth/README.md`](../../pages/auth/README.md) - Auth pages (sign in, register, etc.)
- [`../../contexts/auth-context.tsx`](../../contexts/README.md) - Auth context provider
