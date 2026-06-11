---
name: welcome-schema-source
description: Where the /welcome kiosk's color schema authority lives, and which patterns are documented vs anti-pattern.
metadata:
  type: reference
---

The hardened color schema for the /welcome iPad kiosk is `UI_SCHEMA_COLOR_PALETTE-DONE.md` at the workspace root (status `-DONE`, do not modify without Melody approval).

Authoritative locations:
- HSL token source: `client/src/index.css` `:root` (light mode is the design target)
- T-token table: `client/src/pages/welcome/slides.tsx` lines 16-25 (8 tokens: navy, navyDeep, cream, rose, burgundy, slate, terracotta, cardCream)
- Brand reference implementation: `client/src/pages/landing/LandingPage.tsx`
- PublicDonatePage convention: `client/src/pages/welcome/PublicDonatePage.tsx` (Tailwind utilities only, no T indirection)

Documented storytelling colors per Schema §5 (intentional hardcodes):
- Old-taxi yellow: `#fff5d6` bg / `#a07000` text (SlideTaxisVs)
- Modern-rideshare blue: `#e6f0ff` bg / `#1e4f99` text (SlideTaxisVs)
- Quiz-correct green: `#4a7c4a` bg / `#e8f5e8` light bg / `#2d5a2d` text
- Quiz-wrong red: `#c0392b` bg / `#fdecec` light bg / `#7a2a1c` text
- HONK button yellow: `#facc15` (= yellow-400)

Anti-patterns per Schema §7:
- Don't introduce parallel theme/token systems
- Don't hardcode brand hex outside of T (welcome) or Tailwind utilities (everywhere else)
- Don't use the retired PDF cream/burgundy/navy palette: `#1f2238`, `#13152b`, `#f7f2ec`, `#d99696`, `#7a4a5e`, `#c47c5e`, `#fdf9f3`, `#4b556d`
- Don't change T values without updating the schema doc
- Don't change storytelling colors

Related: [[build-source-drift-caveat]] — always verify visual audit against fresh build.
