# PLAN: Public Event Sign-Up Page (POC)

**Author:** Claude Opus 4.7 (1M context)
**Date:** 2026-04-25
**Branch:** `claude/add-event-signup-page-mapyz`
**Status:** Pre-approved by Melody as POC ("ship asap, public, fastest model")

---

## 1. Objectives

Ship a public-facing event sign-up flow on Vecto Pilot so Melody can run paid driver-mentor sessions (the kind she's been promoting on Next Door):

- Public page lists upcoming events
- Each event capped at **6 attendees**, with **waitlist** beyond cap
- **Dynamic price per attendee** — cost-sharing curve (more signups → lower per-person price), config-driven per event
- **Email alert to Melody** on every signup (uses existing Resend infra)
- **Admin-triggered AI itinerary** — once roster locks, Melody clicks a button and the system generates a pickup/route/timing itinerary from attendee addresses + event location

## 2. Non-goals (deferred to v2)

- **Payment collection.** v1 displays price only — Melody collects payment off-platform (Cash App / Zelle / etc.) per Next Door norms. Stripe Checkout integration is out of scope.
- **Auto-promotion of waitlist on cancellation.** v1 = manual promote button.
- **Recurring events / templates.** v1 = each event is a standalone row.
- **Per-attendee individual itineraries.** v1 = one shared itinerary per event for the whole roster.
- **SMS notifications.** v1 = email only.

## 3. POC defaults (locked in without follow-up Q&A)

| Question | Default chosen | Rationale |
|---|---|---|
| Audience | Drivers attending Melody-hosted paid sessions | Matches Next Door context + max-6 + addresses |
| Events source | New `hosted_events` table (NOT `discovered_events`) | Rule 11 forbids polluting briefing pipeline with curated events |
| Pricing curve shape | Tiered cost-sharing JSONB on each event | Arbitrary curves without re-migrating |
| Pricing direction | Descending per-person (more signups → lower per-person price) | Matches "cost split" mental model from Next Door post |
| Alert channel | Email to `melodydashora@gmail.com` via existing Resend | Infra already wired in `server/lib/notifications/email-alerts.js` |
| Itinerary trigger | Admin-only, manual button | Avoids wasting AI calls on cancellable signups |
| Itinerary model | `claude-haiku-4-5` ("fastest model" per ask) | Simple summarization-class task, sub-second responses |
| Waitlist promotion | Manual button in admin | Simpler than auto-promote; no email-on-promote in v1 |
| Payments | RSVP only, display price | Defer Stripe to v2 |
| Auth on signup form | None (public) | POC; rely on email uniqueness + admin moderation |
| Auth on admin views | `requireAuth` middleware (any logged-in user) | Acceptable for single-operator POC; tighten to role check in v2 |

## 4. Data model

```sql
-- New table — Melody-curated paid events. Distinct from discovered_events (system-discovered).
CREATE TABLE hosted_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,        -- URL-safe, e.g. "dallas-honey-holes-walk-may3"
  title         text NOT NULL,
  description   text,
  event_date    date NOT NULL,
  start_time    time,                        -- local time (event timezone implicit = America/Chicago for now)
  end_time      time,
  location_name text,
  location_address text,
  max_attendees int  NOT NULL DEFAULT 6,
  price_tiers   jsonb NOT NULL DEFAULT '[{"min_count":1,"price_cents":12000}]',
  status        text NOT NULL DEFAULT 'draft',   -- draft | published | closed | cancelled
  itinerary_md  text,                            -- last-generated itinerary markdown
  itinerary_generated_at timestamptz,
  created_by    uuid REFERENCES users(user_id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_hosted_events_published_date
  ON hosted_events (status, event_date) WHERE status = 'published';

CREATE TABLE event_signups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES hosted_events(id) ON DELETE CASCADE,
  full_name     text NOT NULL,
  email         text NOT NULL,
  phone         text,
  pickup_address text,
  notes         text,
  status        text NOT NULL DEFAULT 'confirmed',  -- confirmed | waitlist | cancelled
  price_cents_at_signup int,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, email)
);

CREATE INDEX idx_event_signups_event_status_created
  ON event_signups (event_id, status, created_at);
```

## 5. Files

### Created
| Path | Purpose |
|---|---|
| `migrations/20260425_event_signup_poc.sql` | Schema |
| `server/lib/events/pricing.js` | Pure `computePrice(tiers, count)` |
| `server/lib/events/itinerary.js` | `generateItinerary(event, signups)` via Anthropic Haiku |
| `server/api/events/public-events.js` | `GET /api/public/events`, `GET /api/public/events/:slug`, `POST /api/public/events/:slug/signup` |
| `server/api/events/admin-events.js` | Admin CRUD + signups list + generate-itinerary + promote-waitlist |
| `client/src/pages/events/PublicEventsListPage.tsx` | Public list |
| `client/src/pages/events/PublicEventSignupPage.tsx` | Public detail + signup form |
| `client/src/pages/co-pilot/EventsAdminPage.tsx` | Admin view |

### Modified
| Path | Change |
|---|---|
| `server/lib/notifications/email-alerts.js` | Add `sendEventSignupAlert({event, signup, total, status})` |
| `server/bootstrap/routes.js` | Mount `/api/public/events` and `/api/admin/events` |
| `client/src/routes.tsx` | Add `/events` (public list), `/events/:slug` (public detail), `/co-pilot/events-admin` (protected) |

## 6. Pricing logic

```js
// server/lib/events/pricing.js
// tiers: [{min_count, price_cents}, ...] sorted ascending by min_count
// returns the price_cents whose min_count is the largest <= confirmedCount.
// confirmedCount = number of currently confirmed signups (NOT including waitlist).
export function computePrice(tiers, confirmedCount) {
  if (!Array.isArray(tiers) || tiers.length === 0) return null;
  const sorted = [...tiers].sort((a, b) => a.min_count - b.min_count);
  let chosen = sorted[0].price_cents;
  for (const t of sorted) {
    if (confirmedCount >= t.min_count) chosen = t.price_cents;
    else break;
  }
  return chosen;
}
```

Example for "Dallas Honey-Holes Walk":
```json
[
  {"min_count": 1, "price_cents": 15000},
  {"min_count": 3, "price_cents": 10000},
  {"min_count": 5, "price_cents": 7500}
]
```
- 1–2 signed up → $150/person displayed
- 3–4 signed up → $100/person displayed
- 5–6 signed up → $75/person displayed

**Important:** `price_cents_at_signup` is captured on the `event_signups` row at signup time so attendees know what they committed to even if the displayed price moves.

## 7. Itinerary generation

`POST /api/admin/events/:id/generate-itinerary` calls `claude-haiku-4-5` with:
- System: "You are a logistics coordinator for a paid rideshare driver mentorship session. Generate a concise pickup-and-route plan."
- User: structured JSON containing event metadata + array of confirmed signups (name, pickup_address)
- Output: markdown saved to `hosted_events.itinerary_md` and shown in admin view, copy/pasteable for sharing.

No background jobs (Rule 11 compliance — even though Rule 11 is about discovered events, the spirit is "no autonomous AI work for events").

## 8. Notification flow

On `POST /api/public/events/:slug/signup`:
1. Insert into `event_signups` with status auto-determined (confirmed if `count(confirmed) < max_attendees`, else waitlist).
2. Capture `price_cents_at_signup`.
3. Fire-and-forget `sendEventSignupAlert(...)` — Resend email to `melodydashora@gmail.com` with attendee details + current roster snapshot.
4. Return `{ ok: true, status, price_cents }` to client.

## 9. Test cases (Melody to verify)

| # | Test | Expected |
|---|---|---|
| T1 | Run migration on dev DB | `\d hosted_events` and `\d event_signups` show schema; no errors |
| T2 | `GET /api/public/events` returns empty list initially | `{ events: [] }` |
| T3 | Admin creates event with 6 max + 3-tier pricing | Event appears in `GET /api/public/events` once status='published' |
| T4 | Sign up 6 attendees | All `confirmed`; price_cents_at_signup matches tier; 6 emails arrive |
| T5 | Sign up 7th attendee | Status `waitlist`; email arrives flagged WAITLIST |
| T6 | Duplicate email for same event | 409 with friendly error; no email sent |
| T7 | Click "Generate Itinerary" with 4 signups | Markdown returned + persisted; visible in admin |
| T8 | Click "Promote next from waitlist" | First waitlist row → confirmed; price recomputed for new count |
| T9 | TypeScript build (`npm run build` or vite build) | Clean |
| T10 | Visit `/events` and `/events/<slug>` while signed out | Pages render publicly |
| T11 | Visit `/co-pilot/events-admin` while signed out | Redirected to sign-in |

## 10. Risks / known limitations

- **No payment integration** — attendees may flake without skin in the game. Acceptable for POC; Melody can ask for a Cash App ping in the post-signup confirmation message.
- **Email-only contact** — no SMS reminder loop. Add in v2 if attendance becomes an issue.
- **Single-timezone assumption** — start_time is local America/Chicago; cross-market expansion needs a timezone column.
- **Itinerary quality depends on address quality** — Haiku will hallucinate distances; Google Distance Matrix integration deferred to v2.
- **Rule 8 surface check:** `hosted_events` is intentionally NOT in the Coach's write-access table per Rule 8 — these are operator-curated, not Coach-discovered.

## 11. Test approval

Per Rule 1, code lands behind this plan; **Melody must run T1–T11 and reply "all tests passed"** before this graduates from POC.
