# User Settings Types (`client/src/_future/user-settings/`)

## Purpose

TypeScript type definitions for future user settings/profile features. These are staged for implementation and not currently imported.

## Status

**Staged** - Types defined, awaiting feature implementation.

## Files

| File | Purpose |
|------|---------|
| `driver.ts` | Driver profile type (name, experience, platforms) |
| `location.ts` | Home location preferences |
| `performance.ts` | Driver performance metrics types |
| `settings.ts` | App settings (notifications, theme, etc.) |
| `vehicleTiers.ts` | Vehicle tier configuration |

## Planned Features

These types will support:
- Driver profile management
- Home location/market selection
- Performance tracking dashboard
- App preference settings
- Vehicle tier eligibility

## Usage (Future)

```typescript
import type { DriverProfile } from '@/_future/user-settings/driver';
import type { PerformanceMetrics } from '@/_future/user-settings/performance';
```

## See Also

- [`../_future/README.md`](../README.md) - Parent staging area
- [`../../contexts/auth-context.tsx`](../../contexts/README.md) - Current auth implementation
