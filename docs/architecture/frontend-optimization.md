# Frontend Optimization & Standards

**Last Updated:** 2026-02-10

This document outlines the optimization strategies and standards for the React Client (`client/`).

## 1. Performance Optimization

### Build Optimization (Vite)
- **Bundler:** Vite 5.
- **Minification:** esbuild (default).
- **Strategy:** Tree-shaking enabled by default for ES modules.

### Code Splitting
- **Route-Based:** `React.lazy()` + `Suspense` can be used for route components in `client/src/routes.tsx` to split bundles by page.
- **Current Status:** Monolithic bundle (acceptable for current app size, but splitting recommended as features grow).

## 2. Progressive Web App (PWA)

### Offline Capabilities
- **Status:** Basic.
- **Service Worker:** Not currently configured.
- **Manifest:** `public/manifest.json` needs to be created to support "Add to Home Screen" (A2HS).
- **Caching:** `CoPilotContext` persists state to `sessionStorage` to survive reloads/offline blips.

### Push Notifications
- **Status:** Planned.
- **Tech:** Firebase Cloud Messaging (FCM) or Web Push API.
- **Use Case:** "High Demand Alert", "Traffic Warning", "Strategy Ready".

## 3. Globalization

### Internationalization (i18n)
- **Current:** Hardcoded English ('en-US').
- **Strategy:** Adopt `react-i18next`.
- **Formatting:** Use `Intl.DateTimeFormat` and `Intl.NumberFormat` for currency/dates (already implemented in `briefing-service.js` and `MapTab.tsx` for timezone correctness).

## 4. Accessibility (a11y)

### Standards
- **Goal:** WCAG 2.1 AA.
- **UI Lib:** `shadcn/ui` (based on Radix UI) handles most ARIA attributes and keyboard navigation out-of-the-box.
- **Audit:** Run Lighthouse or axe-core periodically.

## 5. SEO & Social

### SEO
- **Application Type:** Private SaaS / Tool (Auth required). SEO is low priority for app routes.
- **Marketing Site:** Should live outside this repo (e.g., Webflow/Wordpress) or on `/` public routes.
- **Sitemap:** Not required for authenticated app pages.

### Social Sharing
- **Open Graph:** Add `og:title`, `og:description`, `og:image` tags to `index.html` for nicer link previews when drivers share the app (e.g., referral links).
