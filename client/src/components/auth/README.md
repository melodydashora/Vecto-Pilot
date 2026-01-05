# Auth Components (`client/src/components/auth/`)

## Purpose

Authentication-related UI components for protecting routes and managing auth state.

## Files

| File | LOC | Purpose |
|------|-----|---------|
| `ProtectedRoute.tsx` | 36 | Route guard that redirects unauthenticated users |
| `AuthRedirect.tsx` | ~50 | Handles post-authentication redirects |

## ProtectedRoute

A wrapper component that protects routes from unauthorized access.

**Behavior:**
1. Shows loading spinner while checking auth status
2. Redirects to `/auth/sign-in` if not authenticated
3. Saves attempted location for post-login redirect
4. Renders children if authenticated

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

Handles redirects after successful authentication.

**Behavior:**
1. Checks for saved redirect location in session storage
2. Redirects to saved location or default (`/co-pilot/strategy`)
3. Clears saved location after redirect

**Usage:**
```tsx
import AuthRedirect from '@/components/auth/AuthRedirect';

// In auth callback route
<Route path="/auth/callback" element={<AuthRedirect />} />
```

## Dependencies

- `@/contexts/auth-context` - `useAuth` hook for auth state
- `react-router-dom` - Navigation and location
- `lucide-react` - Loading spinner icon

## Connections

- **State from:** `../../contexts/auth-context.tsx`
- **Used by:** `../../routes.tsx`
- **Redirects to:** `/auth/sign-in` (from `../../pages/auth/`)

## See Also

- [`../pages/auth/README.md`](../../pages/auth/README.md) - Auth pages (sign in, register, etc.)
- [`../../contexts/auth-context.tsx`](../../contexts/README.md) - Auth context provider
