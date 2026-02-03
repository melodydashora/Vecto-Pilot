> **Last Verified:** 2026-01-06

# Pages (`client/src/pages/`)

## Purpose

Page-level components that represent full screens/routes.

## Structure

```
pages/
├── auth/                  # Authentication pages
│   ├── SignInPage.tsx     # Login form
│   ├── SignUpPage.tsx     # Multi-step registration (43KB)
│   ├── ForgotPasswordPage.tsx # Password reset request
│   ├── ResetPasswordPage.tsx  # Password reset form
│   ├── TermsPage.tsx      # Terms and conditions
│   └── index.ts           # Barrel export
├── co-pilot/              # Main app pages
│   ├── StrategyPage.tsx     # AI strategy + blocks + coach (40KB)
│   ├── VenueManagerPage.tsx # Premium venue listings (renamed from BarsPage 2026-01-09)
│   ├── BriefingPage.tsx     # Weather, traffic, news
│   ├── MapPage.tsx          # Interactive map
│   ├── IntelPage.tsx        # Rideshare intelligence
│   ├── SettingsPage.tsx     # User profile settings (42KB)
│   ├── AboutPage.tsx        # About/donation
│   ├── PolicyPage.tsx       # Privacy policy
│   └── index.tsx            # Barrel export
└── SafeScaffold.tsx       # Safe scaffold wrapper
```

## Sub-folders

### auth/

Authentication flow pages:

| Page | Route | Purpose |
|------|-------|---------|
| `SignInPage.tsx` | `/auth/sign-in` | Email/password login |
| `SignUpPage.tsx` | `/auth/sign-up` | Multi-step registration |
| `ForgotPasswordPage.tsx` | `/auth/forgot-password` | Request password reset |
| `ResetPasswordPage.tsx` | `/auth/reset-password` | Reset with token/code |
| `TermsPage.tsx` | `/auth/terms` | Terms of service |

See [auth/README.md](auth/README.md) for full documentation.

### co-pilot/

Main application pages (router-based architecture):

| Page | Route | Purpose |
|------|-------|---------|
| `StrategyPage.tsx` | `/co-pilot/strategy` | AI recommendations, smart blocks |
| `VenueManagerPage.tsx` | `/co-pilot/bars` | Premium venue listings |
| `BriefingPage.tsx` | `/co-pilot/briefing` | Weather, traffic, events |
| `MapPage.tsx` | `/co-pilot/map` | Interactive venue/event map |
| `IntelPage.tsx` | `/co-pilot/intel` | Rideshare platform intel |
| `SettingsPage.tsx` | `/co-pilot/settings` | User profile settings |
| `AboutPage.tsx` | `/co-pilot/about` | About & donations |
| `PolicyPage.tsx` | `/co-pilot/policy` | Privacy policy |

See [co-pilot/README.md](co-pilot/README.md) for full documentation.

## Route Configuration

Routes defined in [`../routes.tsx`](../routes.tsx):

```
/                         → Redirect to /co-pilot/strategy
/co-pilot                 → Redirect to /co-pilot/strategy
/co-pilot/*               → CoPilotLayout (with auth protection)
/auth/*                   → Auth pages (no auth required)
```

## Connections

- **Layout:** `../layouts/CoPilotLayout.tsx`
- **Components:** `../components/*`
- **Hooks:** `../hooks/*`
- **Context:** `../contexts/co-pilot-context.tsx`, `../contexts/auth-context.tsx`
- **APIs:** `/api/blocks-fast`, `/api/strategy/*`, `/api/briefing/*`, `/api/auth/*`
