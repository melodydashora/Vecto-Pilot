# One-Shot POC Pack — Vecto Pilot

A professional, one-shot POC pack: universal prompt, filled requirements, and gates to move
from POC to pilot safely — covering **all features implemented in Vecto Pilot** as of
2026-08-26.

**Provenance:** Claude-authored, generated from a full codebase investigation (routes,
model registry, schema, middleware, bootstrap, client routes) cross-referenced with
`FEATURE_AUDIT.md`, `AUDIT.md`, `SECURITY.md`, `docs/architecture/ai-pipeline.md`,
`docs/architecture/AUTH.md`, and `docs/architecture/DATABASE_ENVIRONMENTS.md`.
Format follows the "One-Shot POC Pack — Sample (HeatGuard)" template.

**How to use:**

1. Copy the Universal One-Shot Prompt below.
2. Paste the filled Requirements (the Vecto Pilot document in this file) into the
   placeholder at the end of the prompt.
3. Run it in a capable model to generate a runnable repo with tests and docs — or use it
   as the acceptance baseline to audit the existing implementation.
4. Use the Exit Criteria to decide if it's safe to pilot.

---

## Universal One-Shot Prompt

```
SYSTEM
You are a senior AI/software architect. Produce production-grade outputs with
conservative defaults and verifiable provenance. Do not ask clarifying
questions. If info is missing, make safe assumptions, list them in
ASSUMPTIONS.md, and make them configurable via env vars.

Standards to consider:
- NIST AI RMF 1.0; NIST SP 800-53 (security); Secure SDLC
- ISO/IEC 23894 (AI risk), ISO/IEC 27001/27002 (ISMS), ISO/IEC 42001 (AI
management)
- GDPR/CCPA by default; HIPAA/PCI-DSS only if the domain declares regulated
data
- WCAG 2.2 AA accessibility

Must do:
1) SELF-DISCLOSURE: Print model_identity (provider/model/version) + parameters.
2) PROOF OF ANALYSIS: Summarize the Requirements (≤10 bullets); list files read
   + SHA256s (if any).
3) COMPLIANCE MAPPING: Short matrix: solution ↔ NIST/ISO families; call out
   assumptions.
4) ARCHITECTURE PLAN: Components, Mermaid data-flow, trust boundaries, secrets,
   failure modes, human-in-loop.
5) DELIVERABLES: Emit repo tree + file contents for:
   - app code, Dockerfile/compose (or IaC per requirements)
   - CI pipeline (lint, tests, SCA)
   - tests: unit/integration + AI eval harness with acceptance BANDS (not exact
     match)
   - prompts/ with prompt contracts + SHA256 (if LLM used)
   - SECURITY.md, PRIVACY.md (+ DPIA.md if high-risk GDPR), ARCHITECTURE.md,
     RUNBOOK.md, OBSERVABILITY.md
   - EVAL/ semantic_regression.jsonl, safety_adversarial.jsonl,
     expected_bands.yaml
   - ASSUMPTIONS.md, RISKS.md, LICENSE, README, SBOM instructions
6) WRAPPER SAFETY (if LLMs): pre-gate policy/RBAC/capability tokens; prompt
   compiler with hash registry + model id assertion; post validators (schema,
   safety, agreement band); fallback/refusal rules.
7) EXIT CRITERIA: POC→Pilot gates + rollback triggers with metrics.

OUTPUT FORMAT:
- model_identity:
- proof_of_analysis:
- compliance_mapping:
- architecture_plan:
- repo_tree:
- files:
  - path: <file>
    content: |
      ...
- exit_criteria:
- assumptions:
- risks:

USER
You will receive a single Requirements document next. Use it and conservative
defaults. Do not ask questions. Proceed.

<<PASTE REQUIREMENTS DOCUMENT HERE>>
```

---

## Filled Requirements — Vecto Pilot

### # 0. Overview

**Project Name:** Vecto Pilot

**One-Line Goal:** Turn a rideshare driver's GPS snapshot into a live earnings strategy —
briefing, venue recommendations (Smart Blocks), offer analysis, coaching, and rider
tools — via a role-based multi-model AI pipeline with verifiable provenance.

**Primary Users / Personas:**
- Rideshare drivers (Uber/Lyft) — primary user, mobile-first web app
- Passengers — via anonymous QR-token Concierge page and iPad Welcome kiosk (no account)
- Operator/admin — market-intel curation and read-only monitoring via agent bridge token

**Deployment Target:** Replit (workspace dev; deployment target Cloud Run, port 5000→80).
Runtime topology selected by `APP_RUNTIME` (workspace | deployment | test), never
`NODE_ENV`. Autoscale mode disables workers/SSE/observers.

**Language/Framework:** Node.js + Express (`gateway-server.js` single gateway);
React 19 + Vite + Tailwind 4 + Radix/shadcn client; PostgreSQL via Drizzle ORM
(dev: Replit Helium PG16, prod: Neon serverless — `DATABASE_URL` is the *only* selector);
SSE backed by Postgres LISTEN/NOTIFY (no Redis, no external queue).

### # 1. Business Objective & Scope

**Problem (≤5 bullets):**
- Drivers position by gut feel; earnings depend on being near demand *before* it peaks.
- Ping/offer accept-decline decisions happen in seconds with no data support.
- Situational context (weather, traffic, events, airport delays, school closures, news)
  is scattered across many apps.
- Language barriers between drivers and riders degrade ratings and tips.
- Advice from generic AI tools hallucinates venues and coordinates; drivers need
  verifiable, market-grounded guidance.

**In-Scope (all implemented features):**
1. **GPS snapshot pipeline** — `POST /api/location/snapshot`: reverse geocode, timezone,
   weather, air quality, market and day-part resolution (all coordinates/addresses from
   Google APIs, never model-generated).
2. **Briefing system** — 7 parallel pipelines (weather, traffic via TomTom+Gemini,
   events discovery, rideshare news, school closures, airport/FAA delays, holiday) with
   per-section reads, curation (deactivate/reactivate events), and realtime passthroughs.
3. **Strategy generation** — `STRATEGY_TACTICAL` (Claude Opus) consolidates briefing +
   driver preferences + earnings/fuel context + validated events into `strategy_for_now`.
4. **Smart Blocks venue recommendations** — `VENUE_SCORER` (GPT-5.5) proposes venues
   *by name only*; coordinates resolved post-LLM via venue_catalog → Google Places;
   Routes API distances; hours parsing; event proximity boost; 25-mile perimeter;
   ranked by $/min. Delivered via SSE (`blocks_ready`) or polling.
5. **Lounges & Bars tab** — standalone Google Places discovery + `VENUE_FILTER`
   (Claude Haiku) quality tiers, expense-rank sorting, open-status evaluation.
6. **Rideshare Coach** — streaming multimodal chat (`AI_COACH`, Gemini), action-tag
   parsing into notes/events/intel, notes panel CRUD with pin/restore, file & camera
   attachments, TTS read-aloud, and two live-voice paths (Gemini Live, OpenAI Realtime).
7. **Offer Analyzer** — public rate-limited ingest hook for Siri Shortcuts / MacroDroid
   screenshots (`OFFER_ANALYZER`, Gemini Flash-Lite vision), per-driver ruleset editor
   (rate targets, gates, geography/corridor rules, limits, vision rules), accept/decline
   verdicts with spoken output, offer history, outcome recording (learning loop).
8. **Translation** — driver↔rider translation in 15 languages (`UTIL_TRANSLATION`),
   explicit rider-language selection by design, plus a Siri Shortcuts hook.
9. **Concierge** — driver-generated QR share tokens; public passenger page with
   weather, explore, ask (streaming), and anonymous feedback.
10. **Welcome kiosk** — deliberately public iPad icebreaker/Q&A surface (IP-rate-limited).
11. **Market intelligence** — markets/cities/zones catalogs, staging areas, demand
    rhythm patterns, deadhead calculators, H3 staging-saturation, intel CRUD.
12. **Auth & accounts** — email/password (bcrypt-12, lockout), Google OAuth login,
    Uber OAuth *data connection* (trips/payments/profile; AES-256-GCM token storage),
    password reset via SendGrid email token or Twilio SMS code; driver profile,
    vehicle (NHTSA catalogs), goals, schedule, settings.
13. **Feedback surfaces** — venue, strategy, app, concierge feedback + action logging.
14. **Continuity & memory** — `claude_memory`/`todo`/`lessons_learned`/`definitions`/
    `app_rules` tables with REST Memory API; coach conversation persistence; agent/SDK
    memory stores; read-only admin monitor behind bridge token.

**Out-of-Scope (hard NOs):**
- Medical, legal, or safety-critical advice (Coach/Concierge must refuse).
- Model-generated coordinates or venue identity by name similarity — identity is Google
  `place_id` + event-hash; coordinates from Google/DB at six decimals.
- Continuous background GPS tracking; passenger identity collection on public surfaces.
- Autonomous offer acceptance — the Offer Analyzer advises; the driver decides.
- Code branching on dev-vs-prod database (`DATABASE_URL` only); deployment gating on
  `NODE_ENV`; raw vendor AI calls bypassing the model adapter.

### # 2. Data & Privacy

**Data Categories (PII/PHI/PCI? yes/no + details):**
- PII: **yes** — email/phone, bcrypt-hashed credentials, home-base address, precise GPS
  snapshots (foreground, driver-initiated), vehicle details, encrypted Uber OAuth tokens,
  offer screenshots (may incidentally contain pickup addresses).
- PHI: **no**. PCI: **no** — payments stay on the rideshare platforms; no card data.

**Data Sources & Retention:** Google Maps Platform (geocode/timezone/places/routes/
weather/air quality/pollen/street view), TomTom traffic, FAA ASWS, NHTSA, web search
(grounded). Sessions: 60-min sliding window, 2-hour hard cap, server-side in `users`.
Snapshot-scoped discoveries (`discovered_events`, `discovered_traffic`) cascade-delete
with snapshots. Continuity/memory tables currently grow unbounded (known gap, §13).

**Residency (regions):** US (Replit workspace + Neon US region). No EU segmentation.

**Prohibited Data:** secrets in code/logs/commits/chat; rider identity on public
concierge/kiosk surfaces; precise coordinates from any model output; sensitive content
in logs (correlation-ID + component-tag logging policy, no message bodies).

**DSR (export/delete):** partial — account data deletable on request via operator;
`driver_profiles` uses `onDelete: restrict` so deletion is deliberate and manual.
Self-serve export/delete dashboard is **not yet implemented** (§13).

### # 3. Regulatory Context

**Regimes:** GDPR (n — US-only pilot, no EU residents), CCPA (y — California drivers
plausible), HIPAA (n), PCI (n), other: platform ToS (Uber API terms) for the data
connection.

**Org Security Baseline:** none formal (POC/pilot). Practices documented in
`SECURITY.md`: bcrypt, server-side sessions, Drizzle parameterized queries, Zod
validation on high-write routes, helmet CSP, CORS allowlist, layered rate limits,
constant-time secret comparison. Two security post-mortems on file (memory-poisoning
incident 2026-05-12).

**Accessibility Target:** WCAG 2.2 AA (default). Radix primitives provide keyboard/ARIA
foundations; a formal AA audit has not been run (§13).

### # 4. Non-Functional Requirements

**SLOs:** p95 API < 300 ms excluding AI/external calls; Smart Blocks waterfall budgeted
per phase (briefing readiness gate ≤ 90 s; venues phase ~90 s is the slowest; total
typically 1–3 min); availability 99% pilot.

**Throughput:** pilot scale (single-market, tens of drivers). Global API limiter
100 req/min/IP; expensive endpoints 5/min; chat 3/min; offer hook 20/min; voice-token
mint 5/min; translation 30/min.

**Cost Guardrails:** per-role model selection in the registry (cheap Flash-Lite +
MINIMAL thinking + 1024 tokens for offers; Flash for briefings; premium models only for
strategy/venue scoring); hedged router runs **sequential failover, not racing** (changed
after a real billing incident); Google Routes responses cached 10 min; venue/places/
coords caches in Postgres.

**Observability (logs/metrics/traces):** component-tagged workflow logger with level
controls; `matrixLog` structured checkpoints through the blocks waterfall; correlation
IDs end-to-end; NDJSON event log; console file-tee feeding an in-app log viewer;
`/api/unified/health` + AI health checks every 30 s; job metrics; circuit breakers
around Google calls; model-error email alerts via Resend.

**DR (RPO/RTO):** RPO 24 h (managed Postgres backups: Neon prod); RTO 8 h pilot.
Gateway exits(1) on uncaught exceptions for supervisor restart; graceful shutdown closes
SSE connections with a 5 s hard timeout.

### # 5. Security & Threat Model

**AuthN/AuthZ:** HS256 JWT (2 h, pinned alg, iss/aud claims) + server-side session
validated on every request; dual-verify dispatcher still accepts legacy HMAC tokens
(tracked, removal pending); Google OAuth with one-time CSRF state (10-min expiry);
service accounts via constant-time header secrets (`x-vecto-agent-secret`,
`x-claude-bridge-token`); resource-level `requireSnapshotOwnership`; admin routes
`requireAgentOnly`; SSE uses `?token=` query auth (EventSource limitation — accepted,
documented risk). Auth **fails closed** on DB errors (503).

**Secrets Mgmt:** environment variables only (validated env registry at boot);
`TOKEN_ENCRYPTION_KEY` for AES-256-GCM Uber token storage; hard rule: never commit or
echo secrets.

**Trust Boundaries:** public surfaces (auth pages, concierge `/c/:token`, welcome kiosk,
offer ingest hook, platform/vehicle reference reads) ⇄ authed driver app (`/co-pilot/*`,
`/api/*` behind `requireAuth`) ⇄ agent embed (IP allowlist + auth) ⇄ admin bridge
(bridge token only) ⇄ external AI vendors (via adapter only) ⇄ Postgres.

**Key Risks (≤5) + mitigations:**
1. Prompt injection / hallucinated action tags in Coach responses → parse caps and size
   limits required (currently uncapped — §13); action writes are per-user scoped.
2. Public offer-ingest abuse → 20/min limiter, device hashing, idempotency, shortcut
   tokens for reads.
3. Venue/coordinate hallucination → coordinates excluded from LLM output; Google Places
   resolution + zod schema validation; hard event validation.
4. Token/URL leakage on SSE query auth → short-lived tokens; planned move to cookie
   tickets (§13).
5. Memory poisoning of continuity tables → provenance columns, post-mortem-driven
   review; content treated as data, not instructions.

**Third-Party Services (names/regions):** Google Maps Platform + Gemini + Vertex AI,
Anthropic, OpenAI (US); TomTom, FAA ASWS, Perplexity, Serper/SerpAPI, OpenWeather,
Twilio, SendGrid, Resend, Uber API, NHTSA (US).

### # 6. Product Requirements (functional)

**Top Stories (5–10):**
1. As a driver, I capture my location and within ~2 minutes get a strategy and 4–6
   ranked venue blocks with real distances, ETAs, and open-status.
2. As a driver, I read a live briefing (weather, traffic, events, news, schools,
   airport) scoped to my snapshot, and curate bad events out.
3. As a driver, I forward an offer screenshot from my phone's share sheet and hear an
   accept/decline verdict scored against my own ruleset within seconds.
4. As a driver, I chat (text or voice) with a coach that remembers my preferences and
   saves actionable notes.
5. As a driver, I translate rider conversations in 15 languages.
6. As a driver, I share a QR code so my passenger gets a concierge page — weather,
   local suggestions, Q&A — with zero account or PII.
7. As a driver, I connect my Uber account to import trips/payments for goal tracking.
8. As an operator, I curate market intelligence (zones, staging areas, demand rhythms)
   and monitor offers read-only through the agent bridge.

**APIs Needed:** implemented surface (all Express routers mounted in
`server/bootstrap/routes.js`; canonical list in `docs/api-routes-registry.md`):
`/api/auth/*` (register, login, Google/Uber OAuth, reset), `/api/location/*` +
`/api/snapshot`, `/api/briefing/*`, `/api/blocks-fast`, `/api/blocks/strategy/:id`,
`/api/strategy/*`, SSE `/events/{strategy,briefing,blocks,phase,offers}`,
`/api/venues/*`, `/api/traffic/*`, `/api/intelligence/*`, `/api/platform/*`,
`/api/vehicle/*`, `/api/chat/*` (+ TTS, realtime/live token mint), `/api/coach/*`
(schema, validate, notes), `/api/hooks/*` (offer + translate ingest),
`/api/offer-analyzer/*`, `/api/concierge/*` (+ public `/p/:token/*`),
`/api/welcome-ai/*`, `/api/translate/*`, `/api/memory/*`, `/api/feedback/*`,
`/api/actions`, `/api/admin/*` (bridge-only), `/agent/*` (allowlisted embed).

**UI Needed (pages/components):** public — landing/demo, portfolio, welcome kiosk,
public concierge, auth (sign-in/up, forgot/reset, terms), privacy/policy; protected
`/co-pilot/*` — Strategy (map + Smart Blocks), Coach, Lounges & Bars, Briefing (cards
per section), Intel (zones, staging map, demand rhythm, deadhead calculators),
Concierge, Translate, Offer Analyzer (ruleset editor + offer history), Settings
(profile, vehicle, Uber connection), Schedule, Donate, Help, About. Bottom-tab
navigation + hamburger; ~45 Radix/shadcn primitives; Google Maps vector map.

**File Types:** offer screenshots (multipart/JSON/raw `image/*`); coach attachments
(images/files, base64); camera capture; QR PNG (client-generated).

**Internationalization (locales):** UI is English; translation feature covers 15 rider
languages (es, pl, fr, ar, zh, ko, …); TTS voice selection is language-aware.

**Admin/Backoffice:** yes — market-intel CRUD (authed), read-only offer monitor +
raw read-only SQL behind agent bridge token; in-app log viewer; no end-user-facing
admin UI.

### # 7. AI/ML Usage

**Use of LLM:** y — role-based, multi-vendor, all through one adapter
(`callModel(role, …)` / `callModelStream`; raw vendor calls are forbidden).

**Tasks (role → default model):** briefings ×7 (`BRIEFING_*`, Gemini Flash +
google_search grounding); strategy (`STRATEGY_TACTICAL`, Claude Opus); venue scoring
(`VENUE_SCORER`, GPT-5.5, zod-validated, no coordinates); venue quality filter
(`VENUE_FILTER`, Claude Haiku); event verification (`VENUE_EVENT_VERIFIER`, Gemini
Flash); coach (`AI_COACH`, Gemini streaming; live voice via Gemini Live and OpenAI
Realtime); offer vision (`OFFER_ANALYZER`, Gemini Flash-Lite, MINIMAL thinking —
benchmark-selected; `OFFER_ANALYZER_DEEP` for escalation); translation
(`UTIL_TRANSLATION`); research/market parsing/concierge/docs utility roles. Every role
overridable per-env via `envKey`.

**Context strategy (RAG/fine-tune/none):** curated context assembly, no fine-tuning —
briefing sections, driver preferences, earnings/fuel context, distance-bucketed
validated events, venue-hours batches; grounded web search only through vendor tools
(google_search / web-search fallback); no free browsing. (A vector-search endpoint
exists but embeddings are stubbed — §13.)

**Safety guardrails:** single-adapter enforcement with role registry + model-ID
normalization; sequential-failover router with error classification and sanitized
errors (stable `causeCode`s); cross-provider fallback for 4 designated roles; Gemini
503 same-provider retry; zod schema validation on venue output (0–8 venues); hard
event validation; coordinates never accepted from models; Coach/Concierge refuse
medical/legal advice; offer analyzer has a deterministic fallback (ARP) path whose
accepts are always spoken/flagged; logs name **roles**, never vendor models.

**Offline acceptable:** n for the strategy pipeline (fails loud with retry/202
semantics — no fabricated strategies); offer analyzer degrades to deterministic
rules; Coach currently has **no fallback model** (known gap, §13).

**Model hints:** use the registry defaults above; "choose best available" only via
registry change, never inline.

**Cost cap per request:** enforced structurally — per-role `maxTokens` (e.g. offers
1024) and thinking levels; expensive endpoints limited to 5/min/user.

**Acceptance BANDS (adjust per eval harness):**
- `venue_resolution.min_place_id_match: 0.95` (venues resolving to a real Google place)
- `venue_output.schema_valid: 1.00` (zod pass rate post-retry)
- `offer_extraction.min_f1: 0.90` (fare/time/distance fields vs. labeled screenshots)
- `offer_verdict.min_agreement: 0.95` (vision verdict vs. deterministic ruleset on
  clean inputs)
- `translation.min_agreement: 0.84`
- `briefing.section_completion: 0.95` (7 sections non-null within the 90 s gate)
- `max_false_refusal_rate: 0.02`

### # 8. Tech Constraints

**Must-Use Stack (runtime, db, queue, cache):** Node.js + Express; PostgreSQL 16
(Drizzle ORM; dev Helium / prod Neon selected **only** by `DATABASE_URL`); queueing/
coordination via Postgres advisory locks + LISTEN/NOTIFY + `triad_jobs`/`http_idem`
tables (no Redis/queue service); caches in Postgres (`places_cache`, `coords_cache`,
`venue_catalog`) + in-process TTL caches; React 19/Vite/Tailwind/Radix client.

**Forbidden Tech/Licenses:** raw vendor AI SDK calls outside the adapter; model-
generated coordinates; `DATABASE_URL_PROD`/`NEON_*` style env inventions; `NODE_ENV`
deployment gating (use `REPLIT_DEPLOYMENT === '1'` / `APP_RUNTIME`); destructive
migrations without human approval.

**Infra Boundary:** Replit workspace + Cloud Run deployment; single gateway process,
optional opt-in strategy worker child process (`ENABLE_BACKGROUND_WORKER=true`);
standalone agent server on a pinned port in workspace.

**CI/CD Provider:** GitHub Actions (`semgrep`, `claude-code-review`, `auto-fix-ci`,
Gemini triage/review/dispatch) + Replit "Verify" workflow (`npm run guard`: jsonlint,
dep check, eslint 0-warnings; `tsc -b`; jest; Playwright e2e).

### # 9. Input/Output Contracts

**Input Schemas (examples):**
```json
POST /api/location/snapshot
{ "lat": 32.912345, "lng": -96.789012, "accuracy": 12,
  "timestamp": "2026-08-26T14:03:00Z", "session_id": "uuid" }

POST /api/blocks-fast
{ "snapshotId": "3f2b6c1e-…" }

POST /api/hooks/analyze-offer   (multipart image OR)
{ "device_id": "…", "image_base64": "…", "source": "siri-shortcut" }

POST /api/translate
{ "text": "Where are you headed?", "sourceLang": "auto", "targetLang": "es" }
```

**Output Schemas (examples):**
```json
GET /api/blocks-fast?snapshotId=…   → 200
{ "status": "ok", "blocks": [ { "name": "Legacy West", "place_id": "ChIJ…",
  "lat": 33.077461, "lng": -96.822764, "driveTimeMinutes": 14,
  "distanceMiles": 9.2, "valuePerMin": 1.42, "isOpen": true,
  "reason": "…" } ], "strategy_for_now": "…" }
                                     → 202 while pending: { "status": "pending", "phase": "venues" }

POST /api/hooks/analyze-offer → { "verdict": "accept" | "decline",
  "spoken": "Accept — $2.10/mi, 12 min pickup", "fallback": false,
  "fields": { "fare": 18.50, "miles": 8.8, "pickupMin": 5 } }
```

**Error Contract:** JSON `{ error, causeCode, correlationId }`; auth fails closed
(401/403/503); pipeline errors surface as 5xx with sanitized messages + stable
`causeCode`; missing required data throws loudly (no silent fallbacks, no fabricated
values) — 202 + `missingFields` for incomplete snapshots.

### # 10. Ops & Runbook

**Run Mode (compose/k8s):** single Node gateway (`node gateway-server.js`) on Replit;
boot order: console file-tee → env validation → SQL migrations under advisory lock →
middleware → routes → listen. Optional worker child process opt-in by env.

**Environments (dev/stage/prod):** workspace (dev, Helium PG, `sslmode=disable`) /
test (`APP_RUNTIME=test`, port 5199) / deployment (Cloud Run, Neon PG, SSL required).
Datasets fully isolated; no sync.

**On-Call/Alerting:** model-error email alerts (Resend); AI health checks every 30 s;
`/api/unified/health` + `/healthz` probes; job metrics; circuit breakers on Google
APIs; supervisor restart on crash (exit 1).

**Logging Policy:** correlation ID per request; component-tagged workflow logs;
structured `matrixLog` checkpoints per pipeline phase; NDJSON events; **no secrets, no
message bodies, roles not model names**; file-tee log accessible in-app.

### # 11. Packaging & Delivery

**Deliverables:** monorepo (client + server + shared schema), SQL migrations (auto-run,
idempotent, advisory-locked), Drizzle schema, jest unit + Playwright e2e suites, guard
scripts, GitHub Actions workflows, docs tree (`docs/architecture/*`, runbooks, audits,
role map, routes registry), continuity tables + Memory API.

**License:** MIT (per `package.json`).

**Repo Structure Constraints:** API paths only via `client/src/constants/apiRoutes.ts`
(no inline `/api/...` strings); folder-level READMEs; product invariants live in the
`app_rules` Postgres table (provenance-marked), not markdown; docs discrepancies
tracked in `docs/DOC_DISCREPANCIES.md`; newest audit wins over older doctrine.

### # 12. Acceptance & Exit

**POC "GO" when:** `npm run guard` clean (eslint 0 warnings, jsonlint, dep tree);
`tsc -b` clean; jest unit suites green (offers ×9, auth, events, strategy, router);
Playwright e2e green; a live snapshot completes the full waterfall within phase budgets
with all 7 briefing sections non-null; venue blocks all carry Google `place_id` +
six-decimal coords; offer hook returns a verdict on the 5 sample screenshots within
bands; no secrets in repo (semgrep + secret scan clean).

**Pilot "GO" when:** 2 weeks of live driving with ≥95% waterfall success rate; venue
resolution band held (≥0.95); offer-extraction F1 ≥0.90 on real captures; driver-
reported earnings/engagement uplift vs. baseline; AI spend within per-role guardrails;
zero safety regressions (refusal + adversarial suites).

**Rollback Triggers:** any safety fail (medical/legal advice emitted, PII echo);
hallucinated venue reaching the UI (place_id mismatch) — freeze VENUE_SCORER and serve
cached catalog; refusal spike >3× baseline; blocks failure rate >10% over 2 h; AI cost
>2× budget in 24 h; auth or token-leak incident — rotate secrets, invalidate sessions.

**Sign-Off Roles:** Product/Owner (Melody) · Engineering partner (Claude, verification
evidence) · Ops (deployment health).

### # 13. Known Unknowns

**List gaps to be assumed (from the repo's own audits — FEATURE_AUDIT.md / AUDIT.md):**
- Coach action-tag parsing has no count/size caps (P1-8); conversation saves are
  fire-and-forget (P1-14); no AI_COACH fallback model (P1-13).
- Realtime voice token minted before ownership check (P1-10).
- Bars tab: `isOpen === null` venues pass the open filter unlabeled (P0-1); an inline
  weekday parser bypasses the canonical WEEKDAY_MAP (P0-2).
- Driver preferences not yet wired into `generateTacticalPlan()` scoring (F-4).
- Memory surfaces (coach notes / memory API / agent memory) lack shared IDs (F-9);
  no retention policy on continuity tables.
- Apple OAuth is a stub; vector-search embeddings are stubbed (deterministic vector,
  TODO real embeddings); `STRATEGY_CORE` role registered but uncalled;
  `venue-events` router unmounted; three background jobs have no in-app callers.
- Legacy 2-segment HMAC tokens still accepted (removal pending); SSE `?token=` auth
  slated for cookie-ticket replacement; `/api/platform/*` and `/api/vehicle/*` are
  reference reads without route auth (IP limiter only).
- Self-serve DSR export/delete and a formal WCAG 2.2 AA audit not yet done.

**Conservative defaults for omissions:** fail loud on missing required data; omit
features on missing optional data (never fabricate); additive/reversible DB changes
only; deterministic fallbacks (static templates / cached catalog / ARP rules) always
labeled as fallbacks to the user.

### # 14. Attachments

**Sample Inputs/Outputs (≥5):**
1. Snapshot request/response (see §9) → enriched snapshot row with formatted address,
   timezone, weather, market, day-part.
2. `GET /api/briefing/snapshot/:id` aggregate → 7-section briefing JSON.
3. Smart Blocks response (see §9) → ranked venue blocks with provenance.
4. Offer screenshot (Siri Shortcut) → spoken verdict JSON (see §9).
5. Translation request/response (see §9) → `{ "translated": "¿A dónde vas?", "sourceDetected": "en" }`.
6. Concierge public page: `GET /api/concierge/p/:token` → driver card + weather +
   ask-stream SSE.

---

## Exit Criteria & Test Strategy (what good looks like)

| Stage | Gate |
|---|---|
| POC → Pilot | Offline: venue-resolution ≥0.95 place_id match, offer-extraction F1 ≥0.90, translation agreement ≥0.84; Safety: 0 regressions on adversarial suite; Ops: 100% adapter calls log role + resolved model + correlationId; guard/typecheck/jest/e2e green; cost & phase-latency within guardrails |
| Pilot → Prod | 2-week live win on driver earnings/engagement KPI; waterfall success ≥95%; robustness drop ≤5% on screenshot noise/paraphrase; runbook fire-drill passed (DB failover, model-vendor outage, secret rotation); alerting live |
| Rollback | Any safety fail; hallucinated venue in UI; refusal spike >3× baseline; blocks failure >10% for 2 h; AI cost >2× budget/24 h |

## Compliance Mapping (brief)

| Framework | Gate / Mapping |
|---|---|
| NIST AI RMF 1.0 | Govern: AI_PARTNERSHIP_AGREEMENT.md + `app_rules` provenance; Map/Measure: role registry + acceptance bands + audits ledger; Manage: rollback triggers, incident post-mortems, model-error alerting |
| NIST SP 800-53 | AC (requireAuth/ownership/bridge token), AU (correlation-ID + matrixLog audit trail), SC (TLS, AES-256-GCM token storage, HS256 pinned), IR (security post-mortems, alerting) |
| ISO/IEC 27001/27002 | A.5 policies (SECURITY.md, hard limits), A.8 asset mgmt (env registry, SBOM via npm), A.12 ops (runbook, health checks), A.14 SDLC (guard, CI, code review workflows) |
| ISO/IEC 23894 | AI risk register (§5, §13), per-role fallback/refusal design, eval bands |
| ISO/IEC 42001 | Role-based model management (registry, env overrides, quirks table), monitoring (bands + telemetry), documented role→table ownership |
| GDPR/CCPA | Minimization (roles/logs, no rider PII), consent-based GPS, DSR path (partial — §13), records via continuity tables |
| WCAG 2.2 AA | Radix keyboard/ARIA primitives, contrast tokens (`colors.ts`); formal audit pending (§13) |
