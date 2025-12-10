# Future Functionality

This folder contains code that is **not yet active** but is planned for future features. Files here are excluded from the active import tree to keep the codebase clean.

## Structure

```
_future/
├── user-settings/       # Sign-up/sign-in and profile settings
│   ├── vehicleTiers.ts  # Vehicle tier selection for driver profiles
│   ├── driver.ts        # Driver profile types (vehicle, preferences)
│   ├── location.ts      # Location preference types
│   ├── performance.ts   # Performance tracking types
│   └── settings.ts      # User settings types
└── README.md
```

## When to Move Files Here

- Code written for features not yet implemented
- Placeholder components waiting for backend support
- Configuration for upcoming functionality

## When to Activate

When implementing a feature:
1. Move files from `_future/` to appropriate active directory
2. Update imports in consuming components
3. Remove from this folder
4. Update UI_FILE_MAP.md

## Current Future Features

### User Settings (user-settings/)
**Status:** Waiting for sign-up/sign-in implementation
**Files:**
- `vehicleTiers.ts` - Vehicle tier options for driver profiles
- `driver.ts` - Driver profile types (name, vehicle info, preferences)
- `location.ts` - Location preference types (home base, favorite areas)
- `performance.ts` - Performance tracking types (earnings, ratings, trips)
- `settings.ts` - User settings types (notifications, display preferences)

**To activate:**
1. Implement authentication system
2. Create Settings modal/drawer component
3. Connect to GlobalHeader.tsx Settings gear button
4. Store user preferences in `users` table
5. Import types from this folder into active components
