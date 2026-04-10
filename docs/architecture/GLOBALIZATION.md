# GLOBALIZATION.md — Internationalization, Localization, and Global Readiness

> **Canonical reference** for currency/date formatting, RTL support, locale-specific logic, regulatory differences, and global expansion readiness.
> Last updated: 2026-04-10

---

## Table of Contents

1. [Current Localization Status](#1-current-localization-status)
2. [Currency Handling](#2-currency-handling)
3. [Date/Time Formatting](#3-datetime-formatting)
4. [RTL Language Support](#4-rtl-language-support)
5. [Market/Platform Differences by Region](#5-marketplatform-differences-by-region)
6. [GPS and Mapping Considerations](#6-gps-and-mapping-considerations)
7. [Regulatory Differences](#7-regulatory-differences)
8. [Multi-Timezone Handling](#8-multi-timezone-handling)
9. [Current State](#9-current-state)
10. [Known Gaps](#10-known-gaps)
11. [TODO — Hardening Work](#11-todo--hardening-work)

---

## 1. Current Localization Status

### UI Language: English Only (Intentional)

No i18n library installed. No locale files. All UI labels hardcoded in English. This is intentional — the app targets English-speaking rideshare drivers in US markets.

### Real-Time Translation: 20 Languages

The TRANSLATION.md system translates **conversational text** between driver and rider, but NOT the UI itself. See TRANSLATION.md for full details.

### What Would Need to Change for Non-English Markets

| Layer | Current | Required for Global |
|-------|---------|-------------------|
| UI strings | Hardcoded English | react-i18next + locale files |
| Currency | Hardcoded USD | Intl.NumberFormat with locale param |
| Date/time | Hardcoded 'en-US' | Intl.DateTimeFormat with locale param |
| Market structure | US-only (1,092 cities) | Add international markets |
| Platform data | Uber/Lyft only | Add Didi, Grab, Bolt, etc. |
| Regulatory | US-focused | GDPR, data residency by region |

---

## 2. Currency Handling

### Current Implementation

**File:** `client/src/lib/utils.ts`

```typescript
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD'
  }).format(amount);
}
```

**Hardcoded to USD.** Used across venue scoring, offer analysis, strategy display.

### For Global Readiness

```typescript
export function formatCurrency(amount: number, locale: string, currency: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}
// formatCurrency(9.43, 'en-GB', 'GBP') → "£9.43"
// formatCurrency(9.43, 'de-DE', 'EUR') → "9,43 €"
```

---

## 3. Date/Time Formatting

### Current Implementation

All date/time formatting uses `Intl.DateTimeFormat` with hardcoded `'en-US'` locale:

```typescript
// GlobalHeader.tsx, BarsDataGrid.tsx, BriefingPage.tsx, etc.
new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', timeZone: tz })
```

**Good:** Already uses `Intl` API (not moment.js) — just needs locale parameter.
**Good:** Timezone-aware via `timeZone` option from snapshot data.

### For Global Readiness

Replace hardcoded `'en-US'` with driver's locale preference (from profile or browser).

---

## 4. RTL Language Support

### Status: NOT IMPLEMENTED

Arabic (`ar`) is in the 20 supported translation languages. Arabic text renders correctly in message bubbles (Unicode BiDi algorithm). But:

- No `dir="rtl"` attribute on any container
- No RTL-aware CSS
- Buttons and controls remain LTR
- Layout doesn't mirror

### What's Needed

1. `dir="rtl"` on `<html>` when locale is RTL
2. Tailwind RTL plugin (`tailwindcss-rtl`)
3. Logical properties: `margin-inline-start` instead of `margin-left`
4. Mirror layout for RTL readers

### RTL Languages in Scope

Arabic (ar), Hebrew (he — not currently supported), Urdu (ur — not currently supported)

---

## 5. Market/Platform Differences by Region

### Current: US Markets Only

**Table:** `market_cities` — 1,092 US cities mapped to market anchors.
**Table:** `platform_data` — Uber and Lyft only.

### Global Rideshare Platforms

| Region | Platforms | Status |
|--------|----------|--------|
| USA | Uber, Lyft | Supported |
| UK | Uber, Bolt, FreeNow | Not supported |
| EU | Uber, Bolt, FreeNow, Heetch | Not supported |
| Southeast Asia | Grab, Gojek | Not supported |
| China | Didi | Not supported |
| India | Uber, Ola | Not supported |
| Latin America | Uber, 99, DiDi | Not supported |
| Middle East | Uber, Careem | Not supported |
| Africa | Uber, Bolt | Not supported |

### Architecture Impact

The `platform_data` schema supports arbitrary platforms — adding new ones requires data, not code changes. The offer analysis would need platform-specific screenshot parsing.

---

## 6. GPS and Mapping Considerations

### Google Maps

Google Maps SDK works globally. The current implementation has no US-specific map restrictions.

### Geocoding

Google Geocoding API returns localized results based on `language` parameter (currently not set — defaults to English). For non-English markets, would need to pass driver's locale.

### Address Formats

Different countries have different address formats. Google's `formatted_address` handles this automatically, but the `formatted_address` field in snapshots currently assumes US-style addresses.

---

## 7. Regulatory Differences

### GDPR (EU)

| Requirement | Current Status |
|------------|---------------|
| Right to erasure (delete user data) | NOT IMPLEMENTED — no deletion endpoint |
| Data portability (export user data) | NOT IMPLEMENTED |
| Consent management | NOT IMPLEMENTED — no cookie banner |
| Data Processing Agreement (DPA) | NOT AVAILABLE |
| Privacy policy (EU-compliant) | PARTIAL — exists but not GDPR-specific |
| Data Protection Officer (DPO) | NOT DESIGNATED |

### Data Residency

Current: All data stored in Replit's US infrastructure. For EU expansion, would need EU-based database instance.

### Market-Specific Regulations

| Market | Regulation | Impact |
|--------|-----------|--------|
| US (California) | CCPA | Privacy policy + opt-out |
| EU | GDPR | Full compliance framework |
| UK | UK GDPR | Similar to EU GDPR |
| Brazil | LGPD | Data protection similar to GDPR |
| India | DPDP Act | Consent + data localization |

---

## 8. Multi-Timezone Handling

### Current (Strong)

- **Server:** Google Timezone API resolves coordinates → IANA timezone
- **Snapshot:** `timezone` field stores IANA string (e.g., `America/Chicago`)
- **Client:** `Intl.DateTimeFormat` with `timeZone` option
- **Strategy:** `local_iso` stored as wall-clock time in driver's timezone

**28 files** reference timezone handling across client and server. This is well-implemented.

### For Global Readiness

Already works globally — timezone handling is coordinate-based, not region-hardcoded.

---

## 9. Current State

| Area | Status |
|------|--------|
| UI language (English) | Working — hardcoded, intentional |
| Real-time translation (20 langs) | Working — TRANSLATION.md |
| Currency (USD) | Hardcoded — needs parameterization |
| Date/time (en-US) | Hardcoded — needs locale param |
| RTL support | NOT IMPLEMENTED |
| Multi-timezone | Working — coordinate-based |
| Market structure (US) | US-only — 1,092 cities |
| GDPR compliance | NOT IMPLEMENTED |

---

## 10. Known Gaps

1. **All formatting hardcoded to en-US/USD** — Can't display GBP, EUR, or non-US date formats.
2. **RTL not supported** — Arabic text renders but UI doesn't mirror.
3. **US-only market structure** — No international market data.
4. **No GDPR compliance** — No data deletion, no consent, no DPA.
5. **No locale selection** — Users can't choose language/region preferences.
6. **Address format assumptions** — US-style addresses assumed in snapshots.

---

## 11. TODO — Hardening Work

- [ ] **Parameterize currency formatting** — Accept locale + currency from driver profile (P2)
- [ ] **Parameterize date/time locale** — Replace all `'en-US'` with driver preference (P2)
- [ ] **Add RTL support** — Tailwind RTL plugin + dir attribute + logical properties (P3)
- [ ] **GDPR compliance framework** — Data deletion endpoint, consent management, DPA (P1 for EU)
- [ ] **International market data** — Add UK, EU, SEA markets to platform_data (P3)
- [ ] **Locale preference in profile** — Add `preferred_locale` field to driver_profiles (P3)
- [ ] **i18n library evaluation** — react-i18next if full UI localization needed (P3)

---

## Supersedes

Expands on findings from TRANSLATION.md (RTL status, language support, UI hardcoding).

---

## Key Files

| File | Purpose |
|------|---------|
| `client/src/lib/utils.ts` | Currency formatting (hardcoded USD) |
| `client/src/lib/daypart.ts` | Timezone-aware time classification |
| `client/src/components/GlobalHeader.tsx` | Date/time display (en-US) |
| `shared/schema.js` (driver_profiles) | No locale preference field |
| `TRANSLATION.md` | Real-time translation system (20 languages) |
