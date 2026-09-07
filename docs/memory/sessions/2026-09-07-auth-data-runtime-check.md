# VectoPilot authentication and data checks — September 7, 2026

Provenance: Astra Desktop, responding to Melody's request to record and investigate OAuth, repeat signup, data availability and release readiness. Source baseline: `87a31c00245a76dc8e925f0152733551b82ef450`. These are bounded observations, not a deployment certification.

The implementation backlog is [release readiness](../../plans/2026-09-07-release-readiness.md). Detailed source findings are in [authentication review](../../architecture/audits/2026-09-07-auth-identity-review.md) and [nested pipeline baseline](../../architecture/audits/2026-09-07-pipeline-baseline.md).

## Authentication and browser observations

- One password-login request to the published `vectopilot.com` app using the owner's designated test credentials returned HTTP 401, `INVALID_CREDENTIALS`. No repeated attempt, password reset, or new signup was performed.
- The connected workspace database contains one profile matching the designated test email. This establishes presence, not password validity or presence in production.
- The browser already had the owner's ordinary account signed in. Observations of its strategy and settings pages are not evidence of a successful test-account login. No settings were saved, permissions granted, or external account connected.
- The strategy page displayed “Researching,” Step 3/7 and 74%, while its separate Smart Blocks section displayed 20% waiting for strategy. This is an observation of two progress surfaces, not proof of a stuck job.
- The settings page exposed profile, vehicle, preferences and the Uber connection entry. The production header also exposed a development-labelled “Force fresh session” control; it was not activated.
- A request to the workspace's documented development HTTP port 5000 failed to connect. The gateway was not started for this check: its normal startup invokes migrations, which is outside this inspection.
- Real Google authentication, repeated registration, cross-account isolation and a complete test-account walkthrough remain unverified.

## Connected workspace database

Used only Replit's injected `DATABASE_URL` with a standalone PostgreSQL client. Inspection ran under `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`; the server reported `transaction_read_only=on`. A 10-second statement timeout bounded queries. This identifies the connected workspace environment, not every historical development database or the deployed app's database.

| Table | Exact rows observed |
|---|---:|
| airports | 144 |
| app_rules | 15 |
| driver_profiles | 5 |
| auth_credentials | 4 |
| users | 6 |
| snapshots | 528 |
| strategies | 515 |
| briefings | 515 |
| triad_jobs | 515 |
| claude_memory | 375 |
| todo | 73 |
| definitions | 16 |
| lessons_learned | 33 |
| schema_migrations | 46 |

Counts are before the new continuity/task handoff was added. They are not expected targets or proof of a successful complete user flow. Different counts across users, profiles and credentials alone do not establish orphan records.

The actual database has `UNIQUE (email)`, `UNIQUE (google_id)` and `UNIQUE (user_id)` on driver profiles, plus unique credential `user_id`. `google_id` and `password_hash` permit nulls. There were zero groups with multiple profiles sharing `lower(trim(email))`. This does not test simultaneous registration or prove that the same natural person cannot register under different emails/providers.

Forty of the 46 migration records were marked baselined. The source runner records older migrations without executing their SQL. Inspecting the actual schema remains necessary for fresh-database reproducibility; migration history alone is insufficient. Production authentication constraints were not inspected.

## Published production database through its read-only bridge

Used the existing `POST /api/admin/query` capability at `https://vectopilot.com`, with the already configured bridge credential. Queried aggregate counts only; no driver rows or credentials were returned.

| Table | Result |
|---|---|
| offer_intelligence | HTTP 200; 139 rows |
| offer_outcomes | SELECT permission denied |
| offer_rulesets | SELECT permission denied |
| zone_intelligence | SELECT permission denied |
| discovered_events | SELECT permission denied |
| coach_conversations | SELECT permission denied |
| coach_memos | SELECT permission denied |

The six denials are not zero counts. They differ from the documented analytical allowlist in [PROD_QUERY_BRIDGE.md](../../architecture/PROD_QUERY_BRIDGE.md). No grants or deployment secrets were changed. Production schema, reference data and denied table contents remain unverified.

## Preservation and follow-up

The Replit workspace stores private inspection receipts under `.config/astra-vecto-review-20260907/`: `dev-inventory.json`, `prod-counts.json`, and `backlog-receipt.json`. Do not commit runtime state or copy production records into development.

The existing development `todo` queue received additive release-readiness umbrella **#75** (open, priority 1), linked to provenance-marked continuity record **#386**. Existing tasks remain open and intact. The umbrella links existing OAuth #60, ingest-security #57, Android #70, taxonomy #71, Offer Analyzer #69, Concierge #62, feedback #61 and venue-feedback #58 work rather than replacing it.

This pass changes documentation and task/continuity records only. No application fix, schema migration, deployment, data seed, identity merge or production write was performed. The previously passing 29 MCP tests do not verify the authentication or pipeline findings in this report.
