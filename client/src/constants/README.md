# Constants

Centralized constants for the Vecto Pilot client application.

> **Created:** 2026-01-06 (P4-F audit remediation)
> **Purpose:** Prevent string-based key mismatch bugs

## Why This Exists

LESSONS_LEARNED.md documents a production incident caused by using different localStorage keys in different files. This folder provides a single source of truth.

## Files

| File | Purpose |
|------|---------|
| `storageKeys.ts` | localStorage and sessionStorage key constants |
| `events.ts` | Custom DOM event name constants |
| `queryKeys.ts` | React Query key factory functions |
| `apiRoutes.ts` | API endpoint URL constants |
| `index.ts` | Barrel export for convenience |

## Usage

```typescript
// Import from barrel
import { STORAGE_KEYS, EVENTS, queryKeys, API_ROUTES } from '@/constants';

// Storage
localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
sessionStorage.setItem(SESSION_KEYS.RESUME_REASON, RESUME_REASONS.RESUME);

// Events
window.dispatchEvent(new CustomEvent(EVENTS.SNAPSHOT_SAVED, { detail: {...} }));
window.addEventListener(EVENTS.MANUAL_REFRESH, handler);

// Query keys
useQuery({ queryKey: queryKeys.strategy(snapshotId), ... });
queryClient.invalidateQueries({ queryKey: queryKeys.briefing.weather(snapshotId) });

// API routes
fetch(API_ROUTES.BLOCKS.FAST, { method: 'POST', ... });
fetch(API_ROUTES.BRIEFING.WEATHER(snapshotId));
```

## Rules

1. **NEVER** use raw strings for storage keys, event names, or query keys
2. **ALWAYS** import from this folder
3. **ADD** new constants here before using them
4. **UPDATE** these files when API routes change

## Migration

The codebase still has raw strings that should be migrated to use these constants. When touching a file, consider migrating its string usage to constants.
