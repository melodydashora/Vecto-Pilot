> **Last Verified:** 2026-01-06

# Layouts

Shared layout components for React Router pages.

## Files

| File | Purpose |
|------|---------|
| `CoPilotLayout.tsx` | Main layout for all co-pilot pages |

## CoPilotLayout

The primary layout component that wraps all `/co-pilot/*` routes:

```tsx
<CoPilotLayout>
  ├── CoPilotProvider (shared context)
  ├── GlobalHeader (conditional - hidden on /about)
  ├── <Outlet /> (renders current page)
  └── BottomTabNavigation
</CoPilotLayout>
```

### Features

- **Conditional Header**: GlobalHeader hidden on `/co-pilot/about`
- **Shared Context**: CoPilotContext provides strategy/blocks state to all pages
- **Consistent Navigation**: BottomTabNavigation always visible

## Adding New Layouts

For new page groups (e.g., admin pages), create a new layout:

```tsx
// AdminLayout.tsx
export default function AdminLayout() {
  return (
    <AdminProvider>
      <AdminHeader />
      <Outlet />
    </AdminProvider>
  );
}
```

## See Also

- [routes.tsx](../routes.tsx) - Route configuration
- [contexts/co-pilot-context.tsx](../contexts/co-pilot-context.tsx) - Shared state
