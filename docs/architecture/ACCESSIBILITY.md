# ACCESSIBILITY.md — Accessibility Compliance and Implementation

> **Canonical reference** for WCAG 2.1 compliance status, screen reader compatibility, keyboard navigation, and accessibility roadmap.
> Last updated: 2026-04-10

---

## Table of Contents

1. [Current WCAG 2.1 Compliance Status](#1-current-wcag-21-compliance-status)
2. [ARIA Attributes Audit](#2-aria-attributes-audit)
3. [Keyboard Navigation](#3-keyboard-navigation)
4. [Color Contrast](#4-color-contrast)
5. [Focus Management](#5-focus-management)
6. [Screen Reader Compatibility](#6-screen-reader-compatibility)
7. [Touch Target Sizes](#7-touch-target-sizes)
8. [Reduced Motion Support](#8-reduced-motion-support)
9. [Text Scaling](#9-text-scaling)
10. [Current State](#10-current-state)
11. [Known Gaps](#11-known-gaps)
12. [TODO — Hardening Work](#12-todo--hardening-work)

---

## 1. Current WCAG 2.1 Compliance Status

| Level | Status | Notes |
|-------|--------|-------|
| **A (minimum)** | Partial | Semantic HTML, alt text, ARIA on some components. Missing: skip links, consistent nav labels |
| **AA (target)** | Partial | Color contrast passes (HSL palette designed well). Missing: reduced motion, text resize, consistent focus indicators |
| **AAA (aspirational)** | Not assessed | No formal AAA audit conducted |

### Baseline from Shadcn/ui

The UI component library (Shadcn/ui built on Radix UI) provides:
- Focus traps in dialogs/modals (automatic)
- ARIA roles on standard components (alert, navigation, dialog)
- Keyboard interaction patterns (Radix UI handles this internally)

Custom components (GlobalHeader, MapTab, AICoach, etc.) have inconsistent accessibility.

---

## 2. ARIA Attributes Audit

### Components WITH ARIA

| Component | Attributes | Assessment |
|-----------|-----------|------------|
| `GlobalHeader.tsx` | `aria-hidden`, `aria-label` on refresh/GPS buttons | Good |
| `HamburgerMenu.tsx` | `aria-label="Open menu"` | Good |
| `DriverCard.tsx` (concierge) | `aria-label` on star ratings | Good |
| `SchedulePage.tsx` | `aria-label` on shift toggles | Good |
| `ScreenshotUploader.tsx` | `tabIndex={0}` for paste events | Adequate |
| All Shadcn/ui components | Radix UI provides comprehensive ARIA | Good |

### Components MISSING ARIA

| Component | Issue | Fix |
|-----------|-------|-----|
| `BottomTabNavigation.tsx` | No `role="navigation"`, no `aria-current` on active tab | Add nav role + current page indicator |
| `MapTab.tsx` | Map markers have no alt text or ARIA labels | Add labels to custom markers |
| `AICoach.tsx` | Chat messages have no `role="log"` or `aria-live` | Add live region for streaming |
| `BarsMainTab.tsx` | Venue cards lack `role="listitem"` | Add list semantics |
| `BriefingPage.tsx` | Data cards lack descriptive labels | Add `aria-label` per card |
| `SmartBlocksPipeline.tsx` | Venue recommendation cards lack structure | Add `role="article"` or similar |

---

## 3. Keyboard Navigation

### Working

- **Shadcn dialogs/modals:** Focus trap, Escape to close (Radix UI)
- **Shadcn sheets/drawers:** Focus management, Escape to close
- **Tab navigation:** Standard browser tab order works for most interactive elements
- **Sidebar:** Keyboard shortcut "b" for toggle

### Missing

| Component | Issue |
|-----------|-------|
| Bottom tab bar | No arrow key navigation between tabs |
| Map markers | Not keyboard-focusable |
| Chat input | No Ctrl+Enter to send |
| Venue cards | Not focusable or expandable via keyboard |
| Quick phrases (translation) | Not navigable via keyboard |

---

## 4. Color Contrast

### Light Mode (Passes WCAG AA)

| Combination | Ratio | Status |
|-------------|-------|--------|
| Foreground on Background (dark gray on white) | >7:1 | AAA |
| Primary on Primary-Foreground (blue on white) | >4.5:1 | AA |
| Muted-Foreground on Muted (medium gray on light gray) | >4.5:1 | AA |
| Destructive on Destructive-Foreground (red on white) | >4.5:1 | AA |

### Dark Mode (Passes WCAG AA)

| Combination | Ratio | Status |
|-------------|-------|--------|
| Foreground on Background (light on dark) | >7:1 | AAA |
| Primary on dark background | >4.5:1 | AA |

### Potential Issues

| Context | Concern |
|---------|---------|
| Map markers (colored dots on map tiles) | Color alone conveys meaning (grade A=red, B=orange) — needs shape/label differentiation |
| Green/red open/closed indicators | Colorblind users may not distinguish — needs text label |
| Zone colors (green=honey, red=dead) | Same colorblind concern |

---

## 5. Focus Management

### Radix UI (Automatic)

Dialogs, sheets, alert-dialogs, popovers — all have automatic focus trap and return-on-close via Radix UI primitives.

### Custom Components (Gaps)

| Component | Issue |
|-----------|-------|
| `CriticalError.tsx` | Full-screen overlay — should trap focus |
| `AICoach.tsx` | Streaming messages — no focus management as new messages arrive |
| `TranslationOverlay.tsx` | Split-screen — focus should move to active panel |

---

## 6. Screen Reader Compatibility

### sr-only Text Found

- `breadcrumb.tsx`: "More"
- `carousel.tsx`: "Previous slide", "Next slide"
- `pagination.tsx`: "More pages"
- `sheet.tsx`, `dialog.tsx`: "Close"
- `sidebar.tsx`: "Toggle Sidebar"
- `ForgotPasswordPage.tsx`: Radio label text

### Missing sr-only Text

| Component | Needs |
|-----------|-------|
| Bottom tab icons | Screen reader label for each tab (currently icon-only) |
| Weather/AQI badges in GlobalHeader | Descriptive text for values |
| Progress bar | `aria-valuenow`, `aria-valuemin`, `aria-valuemax` |
| Loading skeletons | `aria-busy="true"` on loading containers |

---

## 7. Touch Target Sizes

### Button Sizes (from `button.tsx`)

| Variant | Size | WCAG 2.5.5 (44×44px) |
|---------|------|----------------------|
| `default` | h-10 (40px) | Below target |
| `sm` | h-9 (36px) | **Below target** |
| `lg` | h-11 (44px) | Meets target |
| `icon` | h-10 w-10 (40×40px) | Below target |

### Recommendation

Increase `default` to `h-11` (44px) and `icon` to `h-11 w-11` (44×44px). Keep `sm` for non-critical desktop-only use.

---

## 8. Reduced Motion Support

### Status: NOT IMPLEMENTED

**Animations found in `index.css`:**
- `@keyframes progressBar`, `fadeIn`, `pulseGlow`, `enter`, `exit`
- Multiple fade, zoom, slide animations
- No `@media (prefers-reduced-motion: reduce)` query anywhere

### Required

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 9. Text Scaling

### Current

Tailwind uses `rem` units by default (relative to root font size). Text scaling via browser zoom should work for most content.

### Untested

- 200% zoom behavior not verified
- Fixed-width containers may clip at large text sizes
- Map UI may break at high zoom levels

---

## 10. Current State

| Area | Status |
|------|--------|
| Semantic HTML | Partial — Shadcn components good, custom components mixed |
| ARIA attributes | Partial — interactive elements covered, data display lacking |
| Keyboard navigation | Partial — modals good, custom UI lacking |
| Color contrast | Good — palette passes AA |
| Focus management | Partial — Radix handles modals, custom components missing |
| Screen reader text | Partial — Shadcn has sr-only, custom components missing |
| Touch targets | Below target — most buttons 40px, should be 44px |
| Reduced motion | NOT IMPLEMENTED |
| Text scaling | Untested |

---

## 11. Known Gaps

1. **No reduced motion support** — Animations play regardless of user preference.
2. **Touch targets too small** — Default buttons are 40px, below 44px WCAG AAA target.
3. **Map not accessible** — Markers not keyboard-focusable, no alt text.
4. **No skip links** — No "Skip to content" link for keyboard users.
5. **Color-only indicators** — Map marker grades and open/closed status rely on color alone.
6. **No accessibility testing tools** — No axe, Lighthouse, or automated a11y checks in CI.
7. **Chat streaming not announced** — Screen readers don't know when new content arrives.

---

## 12. TODO — Hardening Work

- [ ] **Add `prefers-reduced-motion` media query** — Disable all animations (P1)
- [ ] **Increase touch targets to 44px** — Update button default + icon sizes (P1)
- [ ] **Add skip link** — "Skip to main content" at top of CoPilotLayout (P1)
- [ ] **Add `aria-live="polite"` to chat** — Screen readers announce new messages (P2)
- [ ] **Add labels to map markers** — `aria-label` with venue name + grade (P2)
- [ ] **Add shape differentiation to markers** — Not just color (circle vs diamond vs star) (P2)
- [ ] **Add `aria-current="page"` to active tab** — Bottom navigation (P2)
- [ ] **Integrate axe-core in tests** — Automated a11y checks in CI (P2)
- [ ] **200% zoom testing** — Verify all pages at 200% browser zoom (P3)
- [ ] **Full WCAG 2.1 AA audit** — Professional accessibility audit (P3)

---

## Key Files

| File | Purpose |
|------|---------|
| `client/src/components/ui/button.tsx` | Button sizes (touch targets) |
| `client/src/index.css` | Animations (no reduced-motion) |
| `tailwind.config.js` | Color palette (contrast) |
| `client/src/components/ui/*.tsx` | Shadcn/Radix components (good baseline) |
| `client/src/components/ErrorBoundary.tsx` | Error UI accessibility |
| `client/src/components/CriticalError.tsx` | Critical error UI |
