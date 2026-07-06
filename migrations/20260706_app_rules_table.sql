-- 20260706_app_rules_table.sql
--
-- app_rules: the canonical, queryable home for product invariants ("the
-- rules") so every Claude session loads them at boot instead of re-deriving
-- them from incident archaeology. Proposed by Melody 2026-07-06 ("so you
-- don't have to rework the rework"). CLAUDE.md §3 boot sequence points here.
--
-- Provenance: rule_text is verbatim-Melody where provenance='melody';
-- 'joint' rows were directed by Melody and formalized by Claude.
-- claude_memory keeps the session journal; THIS table is the rules surface.
-- Additive DDL + idempotent seeds (ON CONFLICT DO NOTHING).

CREATE TABLE IF NOT EXISTS app_rules (
  id SERIAL PRIMARY KEY,
  rule_key TEXT UNIQUE NOT NULL,
  rule_text TEXT NOT NULL,
  rationale TEXT,
  provenance TEXT NOT NULL DEFAULT 'melody' CHECK (provenance IN ('melody', 'claude', 'joint')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded')),
  superseded_by INTEGER REFERENCES app_rules(id),
  enforced_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_rules (rule_key, rule_text, rationale, provenance, enforced_by) VALUES
(
  'no-fallbacks',
  'No fallbacks. Missing required data -> throw with a descriptive reason. Missing optional data -> omit the feature/field, never substitute a guess. A catch that returns a default to hide a problem is a bug.',
  'Silent fallbacks poisoned field data (Indiana trip 2026: device-timezone and UTC fallbacks wrote wrong time-of-day rows and the issues never surfaced to the team).',
  'melody',
  'Doctrine enforced per-module; exemplars: shared/dayparts.js (throws), server/lib/location/holiday-detector.js (HolidayDetectionError)'
),
(
  'coords-six-decimals',
  'Coords are always 6 decimals.',
  'Coordinate identity and cache keys depend on a single canonical precision (~11cm).',
  'melody',
  'server/lib/location/coords-key.js'
),
(
  'snapshot-complete-waterfall',
  'The snapshot is its own table/pipeline and is a row that can have NO blank fields; once it is done, the snapshot row is sent with all calls after it in the waterfall.',
  'Every downstream call (strategy, briefing, coach, offers) trusts the snapshot row verbatim; one blank field means the whole waterfall runs on bad data.',
  'melody',
  'server/util/validate-snapshot.js + snapshots NOT NULL constraints (shared/schema.js)'
),
(
  'no-hardcoded-location',
  'No location hardcoded, anywhere. No hardcoded cities, coordinates, timezones, or airports standing in for real data.',
  'Hardcoded location data masquerades as resolved GPS truth and cannot be detected downstream.',
  'melody',
  'Code review doctrine (CLAUDE.md hard limits)'
),
(
  'briefing-complete-with-reason',
  'The briefing row must always have no null fields until the calls come back, and must have a reason.',
  'A briefing consumer cannot distinguish "pending" from "failed" from "absent" without an explicit reason on the row.',
  'melody',
  'server/lib/briefing/* (verify per change)'
),
(
  'timezone-gps-only',
  'Timezone ALWAYS comes from GPS coords via the Google Timezone API. Never device/browser timezone, never markets-table timezone-by-city, never UTC hours, never the home profile. The markets table is for market IDENTITY only. Applies to riders (public concierge) worldwide.',
  'A market''s blanket timezone is wrong near zone borders (Indiana splits Central/Eastern by county); device timezone is wrong whenever the driver works outside their home market.',
  'melody',
  'shared/dayparts.js (requires IANA tz, throws); /api/location/resolve + /api/location/timezone (coords -> Google Timezone API)'
),
(
  'model-agnostic-roles',
  'We are model agnostic: models are invoked by ROLE via the callModel adapter (e.g. BRIEFING_HOLIDAY, Strategist, VenuePlanner) — never by vendor or model name in code paths, logs, prompts, or env-key gates outside the adapter/registry.',
  'Roles let the registry swap providers without touching call sites; vendor names in code create hidden coupling (e.g. a GEMINI_API_KEY gate that breaks the moment a role moves providers).',
  'melody',
  'server/lib/ai/adapters/index.js + server/lib/ai/model-registry.js'
),
(
  'time-context-adapter',
  'All hour/day-of-week/daypart/local-date/local-iso derivation flows through shared/dayparts.js — the single time-context adapter for server AND client. No inline Intl/toLocaleString time math anywhere else. Stored taxonomy keys must be semantically self-describing because LLMs read them verbatim.',
  '2026-07-06: two drifted daypart implementations labeled 12-3 PM "late morning" in the header and in LLM prompts (bad model outputs), and inline hour12:false math stored hour=24 at midnight.',
  'joint',
  'shared/dayparts.js (+ re-export shims server/lib/location/daypart.js, client/src/lib/daypart.ts); tests/dayparts.test.js'
),
(
  'holiday-required-snapshot-field',
  'Holiday is a required snapshot field: detected server-side on every snapshot write path, stored on the row, and read from the row by both the header UI and LLM prompts. holiday=''none'' means VERIFIED not a holiday; detection failure fails snapshot creation (except an explicitly configured override, which is human-authored truth).',
  'The detector silently returned ''none'' on every failure and its override config loaded from a wrong path for 13 months — aesthetics never fired and LLMs got false "no holiday" context.',
  'joint',
  'server/lib/location/holiday-detector.js (throws HolidayDetectionError); all three snapshot write paths'
),
(
  'adapter-per-concern',
  'One shared, named adapter per concern (time-context, geocoding, timezone resolution, snapshot context, validation) importable by server and client; everything else imports it. No duplicate implementations, no barrels.',
  'Near-duplicate modules drift and disagree (geocode vs geocode-enhanced, two snapshot-context modules); one adapter makes drift structurally impossible. Consolidation plan: docs/architecture/audits/2026-07-06-location-time-validation-duplication-audit.md.',
  'joint',
  'Exemplar: shared/dayparts.js; remaining adapters pending Melody''s approval of the consolidation plan'
)
ON CONFLICT (rule_key) DO NOTHING;
