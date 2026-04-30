> **Last Verified:** 2026-04-14

# Architecture Documentation

This folder contains focused, readable technical documentation for Vecto Pilot's architecture. Each document is designed to be read in a single pass (<300 lines). All canonical docs use **UPPERCASE** filenames.

## Document Trust Tiers

| Tier | Meaning | Examples |
|------|---------|----------|
| **Canonical** | Must match code. Manually maintained or generated from source. | DB_SCHEMA.md, API_REFERENCE.md, AI_ROLE_MAP.md, CONSTRAINTS.md |
| **Operational Queue** | Current work only. Items resolved here, not stored. | DOC_DISCREPANCIES.md, pending.md |
| **Historical** | Never use as current truth. Read-only reference. | LESSONS_LEARNED.md, archive files, etl-pipeline-refactoring-*.md |
| **Generated Map** | Informational only. May lag code unless regenerated this session. | SYSTEM_MAP.md, DATA_FLOW_MAP.json |

## Document Index

### Core System (Start Here)

| Document | Purpose | Read When... |
|----------|---------|--------------|
| [DB_SCHEMA.md](DB_SCHEMA.md) | PostgreSQL tables and relationships | Working with DB |
| [API_REFERENCE.md](API_REFERENCE.md) | Complete API endpoint documentation | Adding/modifying API routes |
| [API_VERSIONING.md](API_VERSIONING.md) | API versioning strategy | Planning API changes |
| [UX_SCHEMA.md](UX_SCHEMA.md) | React component hierarchy, routing, design system | Modifying frontend |
| [GLOBALHEADER.md](GLOBALHEADER.md) | GlobalHeader component, location resolution, GPS → snapshot flow | Modifying location/header |
| [SNAPSHOT.md](SNAPSHOT.md) | Snapshot lifecycle, persistence, zombie snapshot problem | Modifying snapshot flow |

### AI System

| Document | Purpose | Read When... |
|----------|---------|--------------|
| [RIDESHARE_COACH.md](RIDESHARE_COACH.md) | Rideshare Coach: architecture, voice, action tags, known issues | Working with Rideshare Coach |
| [AI_BEST_PRACTICES.md](AI_BEST_PRACTICES.md) | Prompt patterns, cost optimization, hallucination prevention | Writing AI prompts |
| [AI_MODEL_ADAPTERS.md](AI_MODEL_ADAPTERS.md) | Model adapter pattern, provider routing | Adding/changing AI providers |
| [AI_MODEL_UPDATE_STRATEGY.md](AI_MODEL_UPDATE_STRATEGY.md) | Model versions, swap patterns, deprecation migration | Upgrading models |
| [LLM-REQUESTS.md](LLM-REQUESTS.md) | Every LLM API call path, auth, and model used | Auditing AI costs/security |
| [OFFER_ANALYZER.md](OFFER_ANALYZER.md) | Siri Shortcuts, ride offer analysis, Gemini Vision | Modifying offer analysis |
| [STRATEGY.md](STRATEGY.md) | Strategy generation, recommendation pipeline | Modifying strategy |
| [MARKET_INTELLIGENCE.md](MARKET_INTELLIGENCE.md) | Market data sources, intelligence storage, MI API | Working with market data |
| [AI_ROLE_MAP.md](../AI_ROLE_MAP.md) | Every AI role: model, file, function, data flow | Auditing roles or swapping models |

### System Rules

| Document | Purpose | Read When... |
|----------|---------|--------------|
| [CONSTRAINTS.md](CONSTRAINTS.md) | Critical rules that cannot be violated | **Before ANY code change** |
| [DECISIONS.md](DECISIONS.md) | WHY choices were made, fix capsules | Questioning architecture |
| [DEPRECATED.md](DEPRECATED.md) | Removed features — DO NOT re-implement | Before adding features |
| [STANDARDS.md](STANDARDS.md) | Coding standards and conventions | Writing new code |
| [RISKS.md](RISKS.md) | Risk register with severity matrix and mitigations | Assessing impact |

### Infrastructure

| Document | Purpose | Read When... |
|----------|---------|--------------|
| [AUTH.md](AUTH.md) | Full auth system (JWT, login, register, logout) | Modifying auth |
| [DATABASE_ENVIRONMENTS.md](DATABASE_ENVIRONMENTS.md) | **Dev vs Prod DB architecture** | **Every session start** |
| [LOGGING.md](LOGGING.md) | Workflow logging conventions | Adding logging |
| [SSE.md](SSE.md) | Server-Sent Events lifecycle, auth-drop behavior | Working with real-time data |
| [SCALABILITY.md](SCALABILITY.md) | Rate limiting, load balancing, caching | Tuning performance |
| [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) | Backup & recovery procedures | Handling outages |
| [SECURITY.md](SECURITY.md) | Security posture and hardening plan | Security review |
| [TESTING.md](TESTING.md) | Test pyramid, catalog, CI/CD, coverage targets | Writing tests |

### Domain Features

| Document | Purpose | Read When... |
|----------|---------|--------------|
| [BRIEFING.md](BRIEFING.md) | Briefing tab architecture | Modifying briefing |
| [briefing-transformation-path.md](briefing-transformation-path.md) | DB column → strategist field mapping, event source contract | Tracing briefing data flow |
| [VENUES.md](VENUES.md) | Venue discovery, scoring, ranking, Google Places | Working with venues |
| [LOUNGES_AND_BARS.md](LOUNGES_AND_BARS.md) | Lounge/bar discovery, filtering, scoring | Modifying lounge features |
| [MAP.md](MAP.md) | GPS tracking, map rendering, districts/zones | Modifying map |
| [CONCIERGE.md](CONCIERGE.md) | Passenger-facing share mode, public endpoints | Modifying concierge |
| [DISTRICT_TAGGING.md](DISTRICT_TAGGING.md) | District metadata for venue matching | Improving venue accuracy |
| [USER_PREFERENCES.md](USER_PREFERENCES.md) | Preference storage, personalization, onboarding | Working with user settings |

### Internationalization & Compliance

| Document | Purpose | Read When... |
|----------|---------|--------------|
| [TRANSLATION.md](TRANSLATION.md) | Real-time translation, language support, TTS | Adding language features |
| [GLOBALIZATION.md](GLOBALIZATION.md) | Currency/date formatting, RTL, locale logic | Expanding to new markets |
| [ACCESSIBILITY.md](ACCESSIBILITY.md) | WCAG 2.1 compliance, screen reader, keyboard nav | Improving accessibility |
| [ISO.md](ISO.md) | ISO 27001 Annex A compliance mapping | Compliance audits |
| [NIST.md](NIST.md) | NIST Cybersecurity Framework mapping | Security compliance |

### Platform & Future

| Document | Purpose | Read When... |
|----------|---------|--------------|
| [NATIVE_APPS.md](NATIVE_APPS.md) | iOS/Android conversion strategy | Planning mobile apps |
| [CONVERSION.md](CONVERSION.md) | Web-to-native migration paths, feature flags | Planning platform shift |
| [SDK.md](SDK.md) | Eidolon agent server, tool definitions, API surface | Working with SDK |
| [FUTURE.md](FUTURE.md) | Roadmap, consolidated TODOs, strategic direction | Planning features |
| [FEASIBILITY.md](FEASIBILITY.md) | Scalability limits, mobile feasibility, dependencies | Assessing viability |
| [ROI.md](ROI.md) | LLM cost analysis, revenue model, optimization | Budgeting |

### Historical / Incident Reports

| Document | Purpose |
|----------|---------|
| [AUDIT_SYNTHESIS_2026-04.md](../AUDIT_SYNTHESIS_2026-04.md) | 65-issue audit synthesis — product, subsystems, risks, verdicts |
| [full-audit-2026-04-04.md](full-audit-2026-04-04.md) | Comprehensive 37-issue audit findings |
| [etl-pipeline-refactoring-2026-01-09.md](etl-pipeline-refactoring-2026-01-09.md) | ETL pipeline refactoring record |
| [iterable-crash-root-cause-analysis.md](iterable-crash-root-cause-analysis.md) | Root cause analysis for iterable crash |

## Quick Reference

### TRIAD Pipeline Phases

```
POST /api/blocks-fast → TRIAD Pipeline (~35-50s)
├── Phase 1 (Parallel): Strategist + Briefer + Holiday
├── Phase 2 (Parallel): Daily + Immediate Consolidator
├── Phase 3: Venue Planner + Enrichment
└── Phase 4: Event Validator (disabled)
```

### Model Configuration

> Models change frequently — do not hardcode versions in index docs.
> See [docs/AI_ROLE_MAP.md](../AI_ROLE_MAP.md) for current model assignments per role.

### Runtime Entrypoints

| Path | Command | Sources `.env.local` | Use Case |
|------|---------|---------------------|----------|
| **Replit Run** | `.replit` → `sh -c "set -a && . .env.local && set +a && node scripts/start-replit.js"` | Yes | Replit editor Run button (builds client first via `prestart:replit`) |
| **Local Dev** | `npm run dev` | No (uses process env) | Local development (`NODE_ENV=development`) |
| **Deployment** | `.replit [deployment]` → `npm ci && npm run build:client` then `node gateway-server.js` | No | Replit cloud deployment (`NODE_ENV=production`) |
| **npm start** | `NODE_ENV=production node gateway-server.js` | No | Manual production start |

All paths ultimately run `gateway-server.js`. The Replit Run path adds `.env.local` sourcing and `scripts/start-replit.js` (health gate + PORT binding). The deployment path builds the client first and uses Replit-injected env vars.

### Node.js Version Matrix

| Source | Declares | Notes |
|--------|----------|-------|
| `package.json` engines | `>=18.0.0` | Minimum for ESM + top-level await |
| `.replit` modules | `nodejs-20` | Replit runtime module |
| `.replit` nix packages | `nodejs-22` | Nix overlay (may or may not be active) |

**Effective runtime:** Node 20 (from Replit modules). The `>=18` engine floor is the compatibility contract; 20 is the deployed version.

### Deployment Secrets Checklist

| Variable | Required | Dev Fallback | Purpose |
|----------|----------|-------------|---------|
| `DATABASE_URL` | Yes | Auto-injected by Replit | PostgreSQL connection |
| `JWT_SECRET` | Prod: Yes | `REPLIT_DEVSERVER_INTERNAL_ID` | Auth token signing (HMAC-SHA256) |
| `VECTO_AGENT_SECRET` | Prod: Yes | None (agent auth fails) | Agent/system auth header |
| `ANTHROPIC_API_KEY` | Yes (at least 1 AI key) | None | Claude models |
| `OPENAI_API_KEY` | Yes (at least 1 AI key) | None | GPT models |
| `GEMINI_API_KEY` | Yes (at least 1 AI key) | `GOOGLE_AI_API_KEY` alias | Gemini models |
| `GOOGLE_CLIENT_ID` | Optional | None (Google OAuth disabled) | Google OAuth consent |
| `GOOGLE_CLIENT_SECRET` | Optional | None | Google OAuth exchange |
| `TOKEN_ENCRYPTION_KEY` | If Uber OAuth configured | None (Uber auth fails) | Uber token AES encryption |
| `UBER_CLIENT_ID` | Optional | None (Uber OAuth disabled) | Uber OAuth |
| `UBER_CLIENT_SECRET` | Optional | None | Uber OAuth |
| `PERPLEXITY_API_KEY` | Optional | None (web research disabled) | Perplexity Sonar Pro |

See `server/config/validate-env.js` for the full validation logic. In production, missing required secrets cause startup errors (not warnings).

### Database Core Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `snapshots` | Location moment-in-time | `snapshot_id`, `formatted_address`, `user_id` |
| `strategies` | AI-generated strategies | `strategy_for_now`, `phase` |
| `briefings` | Real-time briefing data | `events`, `traffic_conditions`, `news` |
| `rankings` | Venue sessions | `snapshot_id`, `ranking_id` |
| `ranking_candidates` | Individual venues | `features`, `business_hours`, `distance_miles` |

## Navigation Guide

### New to the Codebase?

Read in this order:
1. [CONSTRAINTS.md](CONSTRAINTS.md) — What you cannot do
2. [UX_SCHEMA.md](UX_SCHEMA.md) or [DB_SCHEMA.md](DB_SCHEMA.md) — Where things are
3. [AI_BEST_PRACTICES.md](AI_BEST_PRACTICES.md) — How AI works
4. [DECISIONS.md](DECISIONS.md) — Why things are the way they are

### Before Making Changes

Always check:
1. [CONSTRAINTS.md](CONSTRAINTS.md) — Critical rules
2. [DEPRECATED.md](DEPRECATED.md) — Don't re-implement removed features
3. Relevant domain doc (AI, database, auth, etc.)

### Finding the Right README

The codebase has **68 folder README files**. Key entry points:

| What You're Looking For | README |
|------------------------|--------|
| Server overview | [server/README.md](../../server/README.md) |
| API routes | [server/api/README.md](../../server/api/README.md) |
| AI layer | [server/lib/ai/README.md](../../server/lib/ai/README.md) |
| Client overview | [client/src/README.md](../../client/src/README.md) |
| Route pages | [client/src/pages/co-pilot/](../../client/src/pages/co-pilot/) |
| Layouts | [client/src/layouts/](../../client/src/layouts/) |
| Contexts | [client/src/contexts/README.md](../../client/src/contexts/README.md) |
| Hooks | [client/src/hooks/README.md](../../client/src/hooks/README.md) |
| Components | [client/src/components/README.md](../../client/src/components/README.md) |
| Database | [server/db/README.md](../../server/db/README.md) |
| Tests | [tests/README.md](../../tests/README.md) |

Every folder has a README.md. Use `find . -name README.md` or your editor's file search to locate them.

## Related Documentation

- [CLAUDE.md](../../CLAUDE.md) — AI assistant quick reference
- [ARCHITECTURE.md](../../ARCHITECTURE.md) — Pointer file (redirects here)
- [LESSONS_LEARNED.md](../../LESSONS_LEARNED.md) — Historical issues and fixes
- [AI_PARTNERSHIP_PLAN.md](../AI_PARTNERSHIP_PLAN.md) — Documentation improvement roadmap

### Research

- [Rideshare Algorithm Research](../research/rideshare-algorithm-research.md) — Platform algorithm behaviors and detection patterns
- [Mobile Subscription Architecture](../research/mobile-subscription-architecture.md) — iOS/Android subscription service solutions

## Document Statistics

| Category | Count |
|----------|-------|
| Core System | 6 |
| AI System | 9 |
| System Rules | 5 |
| Infrastructure | 8 |
| Domain Features | 8 |
| i18n & Compliance | 5 |
| Platform & Future | 6 |
| Historical | 3 |
| **Total** | **50** |

All canonical documents use UPPERCASE filenames. Historical/incident reports retain lowercase date-stamped names.
