# UI Schema — Color Palette (HARDENED)

**Status:** Hardened (`-DONE`). Do not modify without explicit approval from Melody.
**Created:** 2026-05-15
**Authoritative source:** `client/src/index.css` (`:root` HSL custom properties)
**Reference implementation:** `client/src/pages/landing/LandingPage.tsx` (most complete in-the-wild usage of the brand)

---

## 1. Brand Identity Summary

Vecto Pilot uses a **blue + violet + gold** identity built on a `from-blue-600 to-violet-600` signature gradient. White is the canonical surface. Amber is reserved for warm CTA accents (Honk button, gold highlights).

The palette is light-mode-first. Dark mode tokens exist in `index.css` but are not the design target for the public-facing surfaces (`/welcome`, `/welcome/support`, `/demo`, `/c/:token`).

---

## 2. Canonical HSL Tokens (from `client/src/index.css` `:root`)

| Token | HSL | Hex equivalent | Tailwind closest |
|---|---|---|---|
| `--background` | `0 0% 100%` | `#ffffff` | `white` |
| `--foreground` | `210 11% 15%` | `#22272e` | `slate-900` |
| `--muted` | `210 11% 96%` | `#f1f3f5` | `slate-100` |
| `--muted-foreground` | `210 7% 46%` | `#6c757d` | `slate-500` |
| `--card` | `0 0% 100%` | `#ffffff` | `white` |
| `--card-foreground` | `210 11% 15%` | `#22272e` | `slate-900` |
| `--border` | `210 11% 90%` | `#dee2e6` | `slate-200` |
| `--input` | `210 11% 90%` | `#dee2e6` | `slate-200` |
| `--primary` | `207 90% 54%` | `#1d8ce8` | `blue-500` |
| `--primary-foreground` | `0 0% 100%` | `#ffffff` | `white` |
| `--secondary` | `45 100% 51%` | `#ffc107` | `yellow-400` / `amber-400` |
| `--secondary-foreground` | `0 0% 100%` | `#ffffff` | `white` |
| `--accent` | `210 11% 96%` | `#f1f3f5` | `slate-100` |
| `--destructive` | `0 84% 60%` | `#ef4444` | `red-500` |
| `--ring` | `207 90% 54%` | `#1d8ce8` | `blue-500` |
| `--success` | `120 61% 50%` | `#33cc33` | `green-500` |
| `--warning` | `25 95% 53%` | `#f97316` | `orange-500` |
| `--error` | `4 90% 58%` | `#f44336` | `red-500` |
| `--surface` | `210 11% 98%` | `#f8fafc` | `slate-50` |

---

## 3. Brand Gradient (signature element)

| Element | Tailwind classes |
|---|---|
| **Primary CTA gradient** | `bg-gradient-to-br from-blue-600 to-violet-600` |
| **Hero / page-header gradient** | `bg-gradient-to-br from-blue-600 via-blue-700 to-violet-700` |
| **Stat / badge gradient** | `bg-gradient-to-r from-blue-600 to-violet-600` |
| **Text gradient** (transparent fill) | `text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-violet-600` |

In-the-wild: `client/src/pages/landing/LandingPage.tsx:176, 402, 412, 451, 490, 609, 698`.

---

## 4. Tailwind Color Usage Conventions

| Purpose | Class | Notes |
|---|---|---|
| Primary button | `bg-blue-600 hover:bg-blue-700 text-white` | Solid CTA |
| Secondary button | `bg-yellow-400 hover:bg-yellow-300 text-slate-900` | Warm accent (HONK button uses this) |
| Card surface | `bg-white shadow-md border border-blue-100` | Standard card |
| Card surface (subtle) | `bg-slate-50` or `bg-blue-50` | Background variants |
| Body text | `text-slate-700` | Default body |
| Heading text | `text-slate-900` (or `text-blue-700` for accent) | |
| Muted text | `text-slate-500` (or `text-blue-100` on dark bg) | |
| Border | `border-blue-100` (light) or `border-blue-200` (medium) | |
| Focus ring | `focus-visible:ring-2 focus-visible:ring-blue-400` | Standard a11y ring |
| Destructive | `bg-red-500 text-white` | Use sparingly |

---

## 5. `/welcome` Kiosk T-Token Mapping (re-skinned 2026-05-15)

The welcome iPad kiosk (`client/src/pages/welcome/`) uses an internal `T` token object in `slides.tsx` so 22 slides can be re-skinned in one place. Token names mirror the original PDF deck for backwards-compat with slide source code; values map to brand colors:

| `T.*` token | Hex value | Tailwind equivalent | Used for |
|---|---|---|---|
| `T.navy` | `#1e40af` | `blue-800` | Dark slide bg (theme="navy") |
| `T.navyDeep` | `#172554` | `blue-950` | Darkest gradient stop |
| `T.cream` | `#f8fafc` | `slate-50` | Light slide bg (theme="cream") + light text on dark |
| `T.rose` | `#a78bfa` | `violet-400` | Lighter accent / pop color |
| `T.burgundy` | `#1d4ed8` | `blue-700` | Primary deep accent / numbered badges / CTAs |
| `T.slate` | `#475569` | `slate-600` | Neutral text and borders |
| `T.terracotta` | `#f59e0b` | `amber-500` | Warm gold accent (autism note divider, etc.) |
| `T.cardCream` | `#eff6ff` | `blue-50` | Soft blue card background |

**Authoritative location:** `client/src/pages/welcome/slides.tsx` lines 12-22.

**Storytelling colors (intentionally hardcoded, not in `T`):**

| Color | Hex | Where | Why |
|---|---|---|---|
| Old-taxi yellow | `#fff5d6` bg / `#a07000` text | `SlideTaxisVs` "Taxis in the Past" card | Editorial: yellow = legacy taxi |
| Modern-rideshare blue | `#e6f0ff` bg / `#1e4f99` text | `SlideTaxisVs` "Modern Ride-Share" card | Editorial: blue = modern app |
| Quiz-correct green | `#4a7c4a` bg / `#e8f5e8` light / `#2d5a2d` text | Quiz answer feedback | Universal correct semantic |
| Quiz-wrong red | `#c0392b` bg / `#fdecec` light / `#7a2a1c` text | Quiz answer feedback | Universal wrong semantic |
| HONK button yellow | `#facc15` (= `yellow-400`) | `SlideHero` HONK button | Universal "horn / attention" |

These do NOT change when the brand palette is re-skinned. They carry narrative or universal-semantic meaning.

---

## 6. Public Donate Page (`/welcome/support`)

`client/src/pages/welcome/PublicDonatePage.tsx` follows the brand directly using Tailwind utility classes (no `T` indirection):

- Hero: `bg-gradient-to-br from-blue-600 via-blue-700 to-violet-700` (matches LandingPage hero)
- CTA button: `bg-yellow-400 hover:bg-yellow-300 text-slate-900` (HONK-style warm accent)
- Card surfaces: `bg-white shadow-md border border-blue-100`
- Cost item bullet: `bg-gradient-to-br from-blue-600 to-violet-600`
- Text hierarchy: `text-slate-900` headings, `text-slate-700` body, `text-slate-500` muted

Square donation URL: `https://square.link/u/6PbBaNCi?src=sheet` (single source — also referenced in `client/src/pages/co-pilot/DonatePage.tsx:17`).

---

## 7. Anti-patterns (DO NOT)

- **Do not introduce a parallel theme/token system** for any sub-area. The `T` object inside `slides.tsx` is scoped to the welcome kiosk only — it is not a project-wide theming layer. Use Tailwind utility classes everywhere else.
- **Do not hardcode brand colors** outside of `T` (welcome) or Tailwind utilities (everywhere else). Hex values like `#1d4ed8` should not appear in TSX files — use `bg-blue-700` instead, or `T.burgundy` if inside the welcome kiosk.
- **Do not use the cream/burgundy/navy palette from the source PDF deck.** That palette was retired 2026-05-15 in favor of brand alignment.
- **Do not change the values in `T` without updating this doc.** This doc is the auditable record of what each token means.
- **Do not change the storytelling colors in section 5.** They carry semantic meaning that survives re-skins.

---

## 8. Change Log

| Date | Change | By |
|---|---|---|
| 2026-05-15 | Initial hardening. Re-skinned welcome kiosk from PDF cream/burgundy palette to Vecto Pilot blue/violet brand. | Claude Code (under Melody's direction) |
