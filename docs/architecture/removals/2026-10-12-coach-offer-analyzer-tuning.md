# Retired Coach tuning descriptions and comments

October 12, 2026 (UTC), Codex/Astra. Melody authorized Coach to explain scenarios
using saved offer evidence and adjust Offer Analyzer settings as driving conditions
change. This record preserves text replaced by that source change, based on
`380bdb619dfdea77be9b357f02e3ef62bc5a8e43`. It is historical context, not a
deployment or live acceptance receipt.

The current contract remains in [Rideshare Coach](../RIDESHARE_COACH.md),
[Offer Analyzer](../OFFER_ANALYZER.md#15-coach-integration), and the
[lexicon](../../../LEXICON.md). User-directed settings changes preserve original
offer decisions, use the existing owner rules schema and concurrency checks, and
require a durable save receipt before a success claim. They do not start Strategy.

## CoachPage relocation header

Source: `client/src/pages/co-pilot/CoachPage.tsx`, baseline lines 1–8.
The old pass-specific prohibition no longer describes the current confirmed-action
and settings-refresh wiring.

```tsx
// 2026-04-25 (Phase A, Pass 1): Dedicated Coach surface.
// This is a pure relocation of the existing <RideshareCoach> from inside
// StrategyPage to its own route. Internals are unchanged in this pass —
// do not refactor speech/TTS/state inside RideshareCoach yet (Pass 2 + Phase B).
//
// Prop names mirror StrategyPage's existing invocation EXACTLY (verified via
// preflight grep at lines 879–887): userId, snapshotId, strategyId, strategy,
// snapshot, blocks, strategyReady.
```

## Coach action boundary wording

Source: `docs/architecture/RIDESHARE_COACH.md`, opening paragraph. The explicit
prohibition on silent changes remains; user-directed tuning is now explained.

```markdown
The Coach reduces the driver's need to read or type while driving. Typed and
spoken questions reach the same backend reasoning/action path. The Offer Analyzer
owns offer decisions; Coach explains saved evidence, preferences and strategy.
It must not run a second live offer analyzer or silently change a driver's rules.
```

## Offer Analyzer integration wording

Source: `docs/architecture/OFFER_ANALYZER.md`, section 15. Retired offer-record
mutations remain retired. This paragraph previously omitted the new, separately
validated settings action.

```markdown
Coach’s legacy model-emitted offer mutation actions are retired (§11.5). Other
validated Coach actions are separate. There is no automatic Offer Analyzer-rule tuning
from chat or outcomes.
```

## Coach lexicon row

Source: `LEXICON.md`, Feature names and pipeline roles.

```markdown
| **Coach** | The independent assistant using owned saved context, conversation and longitudinal evidence. Saved Offer Analyzer patterns inform it; it does not issue a fresh live Offer Analyzer decision. | [Coach contract](docs/architecture/RIDESHARE_COACH.md) |
```


## Ruleset cache removed for immediate saved changes

Melody's October 12 direction requires newly captured tokened offers to read the
current committed rules. The prior 15-second instance cache could retain an older
config on a different deployment instance after a successful save. Each new
resolution now reads the database; an already running analysis retains the rules
and provenance it captured. A failed authoritative read remains unavailable and
cannot substitute stale rules.

Superseded `OFFER_ANALYZER.md` section 7 description and section 16.1 table row:

```markdown
`driver_profiles.shortcut_token` maps a headless request to `user_id`.
`offer_rulesets.user_id` supplies that owner’s config/version/hash. `ruleset-store.js`
uses a bounded 15-second process cache and invalidates it after saves/token rotation,
including protection against an older in-flight read repopulating invalidated data.
Unknown supplied tokens and failed/invalid personal-rule reads fail closed.

| Rule/service cache | 15 s, maximum 500 tokens; `ruleset-store.js` | Local save/rotation invalidation; other instances can retain their cache until expiry. Unknown tokens are not cached. |
```

The complete pre-change `server/lib/offers/ruleset-store.js` below preserves the
removed cache comments, state, lookup/population guards and invalidation/test-hook
implementations. Source: the task's exact pre-edit copy, matching the reviewed
baseline for this file.

```js
// server/lib/offers/ruleset-store.js
// 2026-07-03 (todo #10): Per-driver ruleset resolution for the analyze-offer hot path.
//
// FLOW (Siri request → rules):
//   X-Shortcut-Token header (or shortcut_token form field)
//     → driver_profiles.shortcut_token → user_id
//     → offer_rulesets.config → migrateRuleset() → { ruleset, userId, version, hash }
//
// 2026-09-11: provided tokens fail closed when identity or saved rules cannot be
// verified. The ingest route speaks NO DATA, never ACCEPT under substituted rules.
// Untokened legacy requests retain their explicitly anonymous default path.
//
// CACHING: measured Phase-1 p50 is ~5.3s, so one indexed read (~10-20ms) is
// noise — the 15s in-process TTL exists to absorb trip-radar bursts, not to
// save latency. Deployment is Cloud Run (can autoscale): cross-instance edits
// converge within TTL; the PUT handler busts the local instance immediately.

import { db } from '../../db/drizzle.js';
import { sql } from 'drizzle-orm';
import { DEFAULT_RULESET, migrateRuleset } from './rules-engine.js';
import { validateRuleset } from './ruleset-schema.js';
import { initialRulesetFromProfile } from './profile-ruleset.js';
import { hashRuleset } from './ruleset-hash.js';
import { normalizeSelectedServices } from '../../../shared/driver-services.js';

// Pure identity helpers live in ruleset-hash.js (no DB import — testable without
// a pool); re-exported here so API consumers keep a single import site.
export { hashRuleset, generateShortcutToken } from './ruleset-hash.js';

const CACHE_TTL_MS = 15_000;
const CACHE_MAX = 500; // bound the map — the public path must not grow memory on attacker-minted tokens
const cache = new Map(); // token → { value, expiresAt }
// 2026-08-17 (race review): a read that STARTED before a save and lands after it would
// re-populate the cache with the pre-save rules for up to 15 s (invalidateUser only
// clears what is already there). Remember when each user was last invalidated and
// refuse to cache a value whose read began before that instant.
const invalidatedAt = new Map(); // userId → epoch ms

/**
 * Resolve the ruleset for an incoming analyze-offer request.
 * @param {string|null|undefined} token - X-Shortcut-Token header / shortcut_token field
 * @returns {Promise<{ruleset: object|null, userId: string|null, version: number|null, hash: string|null, selectedServices: string[]|null, selectionVerified: boolean, status: string}>}
 *   No token → defaults with null identity (legacy behavior, zero change).
 *   Invalid token or unreadable rules → null rules, with an explicit status.
 *   Service selection is profile context, not part of the persisted rules hash.
 *   Null remains an explicitly unverified legacy selection; it is never inferred.
 */
export async function resolveRuleset(token) {
  const defaults = { ruleset: DEFAULT_RULESET, userId: null, version: null, hash: null, status: 'anonymous_defaults', selectedServices: null, selectionVerified: false };
  if (!token || typeof token !== 'string') return defaults;

  const cached = cache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const readStartedAt = Date.now();
  try {
    const result = await db.execute(sql`
      SELECT dp.user_id, dp.pref_shared, dp.max_deadhead_mi, dp.selected_services, r.config, r.version, r.config_hash
      FROM driver_profiles dp
      LEFT JOIN offer_rulesets r ON r.user_id = dp.user_id
      WHERE dp.shortcut_token = ${token}
      LIMIT 1
    `);
    const row = result.rows?.[0];

    let value;
    if (!row) {
      // NOT cached: unknown tokens are unbounded attacker input — caching them
      // would let a scanner grow the map; a real driver's token resolves next try.
      console.warn('[ruleset-store] Unknown shortcut token — personal rules unavailable');
      return { ruleset: null, userId: null, version: null, hash: null, status: 'invalid_token', selectedServices: null, selectionVerified: false };
    } else if (row.version == null && row.config == null) {
      const { config } = initialRulesetFromProfile(row);
      value = { ruleset: config, userId: row.user_id, version: null, hash: hashRuleset(config), status: 'profile_defaults' };
    } else {
      if (!row.config || typeof row.config !== 'object' || Array.isArray(row.config)
          || !row.config.global || !validateRuleset(migrateRuleset(row.config)).ok) {
        throw new Error('Saved personal rules are invalid');
      }
      value = {
        ruleset: migrateRuleset(row.config),
        userId: row.user_id,
        version: row.version,
        hash: row.config_hash,
        status: 'saved',
      };
    }
    value.selectedServices = normalizeSelectedServices(row.selected_services);
    value.selectionVerified = value.selectedServices !== null;
    if ((invalidatedAt.get(value.userId) ?? -1) >= readStartedAt) {
      // Saved while this read was in flight — serve it (it is what the DB said when we
      // asked) but do not cache it; the next request reads the fresh row.
      return value;
    }
    if (cache.size >= CACHE_MAX) {
      // Evict the oldest entry (Map preserves insertion order) — simple and enough
      // at this scale; a full sweep would be overkill for a 500-entry bound.
      cache.delete(cache.keys().next().value);
    }
    cache.set(token, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (err) {
    console.error(`[ruleset-store] Personal rules could not be verified (${err.message})`);
    return { ruleset: null, userId: null, version: null, hash: null, status: 'rules_unavailable', selectedServices: null, selectionVerified: false };
  }
}

/** Bust the local cache for a user (called by the PUT handler after a save). */
export function invalidateUser(userId) {
  for (const [token, entry] of cache) {
    if (entry.value?.userId === userId) cache.delete(token);
  }
  const now = Date.now();
  invalidatedAt.set(userId, now);
  // Bounded: an invalidation older than the TTL can no longer race any read.
  for (const [uid, at] of invalidatedAt) {
    if (now - at > CACHE_TTL_MS * 2) invalidatedAt.delete(uid);
  }
}

/** Test hook. */
export function _clearCache() {
  cache.clear();
  invalidatedAt.clear();
}
```


## Shared rules writer extraction and prior read-only prompt

The editor's previous PUT implementation below was extracted into the shared
rules writer so Coach and the editor use one validation, session lock and
versioned persistence boundary. The read-only model instruction was superseded
by Melody's explicit authorization for directed settings changes. Offer-record
mutations and historical verdicts remain separate.

Sources: task pre-edit copies of `server/api/offer-analyzer/index.js` lines
101–187 and `server/api/chat/chat.js` lines 1042–1047.

```js
// PUT /api/offer-analyzer/rules — validate strictly, upsert, bump version.
// This is the fail-loud write gate: an invalid config NEVER persists (OFFER_ANALYZER.md §7 fail posture).
// 2026-08-17 (race review finding #4): optimistic concurrency. The body may carry
// `expected_version` — the version the editor loaded (null = "no saved row yet").
// When present, the update applies ONLY if the stored version still matches;
// otherwise 409 with the current row so the client reloads instead of silently
// overwriting another tab's/device's save (last-write-wins was the old behavior).
// An expected version is required; an older client must reload before saving.
// The response now returns the canonical stored config too, so the editor needs no
// second GET (whose form.reset() could clobber a slider moved during the round-trip).
router.put('/rules', async (req, res) => {
  try {
    const supplied = req.body?.config;
    // Migration fills older rules' missing fields and also supplies defaults
    // for absent input. At the write boundary, absent/malformed rules must not
    // reset the driver's choices or advance the saved revision.
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied) ||
        !supplied.global || typeof supplied.global !== 'object' || Array.isArray(supplied.global)) {
      return res.status(422).json({ error: 'Invalid ruleset', details: ['config: a rules object with a global rules object is required'] });
    }
    // Both fields belong to the original global contract. Older versions may
    // omit newer fields, basis or tiers; an empty core is not a saved decision.
    if (!Object.hasOwn(supplied.global, 'rating_floor') || !Object.hasOwn(supplied.global, 'require_verified')) {
      return res.status(422).json({ error: 'Invalid ruleset', details: ['config.global: rating_floor and require_verified are required'] });
    }
    const config = migrateRuleset(supplied);
    const validation = validateRuleset(config);
    if (!validation.ok) {
      return res.status(422).json({ error: 'Invalid ruleset', details: validation.errors });
    }
    const hasExpectation = req.body != null && Object.prototype.hasOwnProperty.call(req.body, 'expected_version');
    if (!hasExpectation) return res.status(400).json({ error: 'rules_version_required', message: 'Reload saved rules before saving changes.' });
    const rawExpected = hasExpectation ? req.body.expected_version : undefined;
    // Strict: a JSON number that is a non-negative int4, or null. No coercion (true → 1,
    // "" → 0, [7] → 7 would all sneak through Number()); out-of-int4 would 500 at the cast.
    if (hasExpectation && rawExpected !== null
      && !(typeof rawExpected === 'number' && Number.isInteger(rawExpected) && rawExpected >= 1 && rawExpected < 2147483647)) {
      return res.status(400).json({ error: 'expected_version must be a positive integer or null' });
    }
    const expectedVersion = hasExpectation && rawExpected !== null ? rawExpected : null;

    const hash = hashRuleset(validation.config);
    const configJson = JSON.stringify(validation.config);
    // IS NOT DISTINCT FROM: an expectation of null (client saw defaults) matches no
    // existing row → 409 if someone saved first; a stale integer likewise.
    const versionGuard = hasExpectation
      ? sql`offer_rulesets.version IS NOT DISTINCT FROM ${expectedVersion}::integer`
      : sql`TRUE`;
    const result = await withDriverSettingsLock(req.auth, async tx => {
      const current = await tx.execute(sql`SELECT version FROM offer_rulesets WHERE user_id = ${req.auth.userId} LIMIT 1`);
      if ((current.rows?.[0]?.version ?? null) !== expectedVersion) return { rows: [] };
      return tx.execute(sql`
      INSERT INTO offer_rulesets (user_id, version, config, config_hash)
      VALUES (${req.auth.userId}, 1, ${configJson}::jsonb, ${hash})
      ON CONFLICT (user_id) DO UPDATE SET
        config = EXCLUDED.config,
        config_hash = EXCLUDED.config_hash,
        version = offer_rulesets.version + 1,
        updated_at = NOW()
      WHERE ${versionGuard}
      RETURNING version
      `);
    });

    if (!result.rows?.length) {
      const current = await db.execute(sql`
        SELECT config, version, config_hash FROM offer_rulesets WHERE user_id = ${req.auth.userId} LIMIT 1
      `);
      const row = current.rows?.[0];
      console.warn(`[offer-analyzer] Rules save REJECTED (version conflict): user=${req.auth.userId} expected v${expectedVersion ?? 'none'}, stored v${row?.version ?? 'none'}`);
      return res.status(409).json({
        error: 'version_conflict',
        message: 'Your rules were changed elsewhere since this page loaded. Reload and re-apply your change.',
        current: row ? { config: migrateRuleset(row.config), version: row.version, hash: row.config_hash } : null,
      });
    }

    invalidateUser(req.auth.userId); // next Siri request on this instance sees the new rules
    const version = result.rows?.[0]?.version ?? 1;
    console.log(`[offer-analyzer] Rules saved: user=${req.auth.userId} v${version} ${hash.slice(0, 12)}`);
    res.json({ success: true, version, hash, config: validation.config });
  } catch (err) {
    if (err instanceof MainRunAdmissionError) return res.status(err.status).json({ error: err.code, message: err.message, ...err.details });
    console.error('[offer-analyzer/rules PUT]', err.message);
    res.status(500).json({ error: err.message });
  }
});
```

```text
📐 **Offer Analyzer Rules (read-only — DO NOT EDIT, only consult):**
Below is the canonical offer-analyzer doctrine + the LLM role definitions. Use these to:
- Explain WHY the existing analyzer recommended ACCEPT/REJECT on past offers
- Identify when your judgment in chat *disagrees* with the rules — propose changes via [COACH_MEMO]
- Cite the rule by section number (e.g., "per §7 deterministic fallback") when you're applying it
You do NOT have write access to these — you can only read and reason about them.
```




## Prior routine preference confirmation wording

Source: `docs/architecture/ai-pipeline.md`. Melody's October 12 direction keeps
one explicit Strategy start using valid saved setup, without a routine extra
confirmation. Missing settings, unsaved drafts and failed readback still hold
admission. These replaced passages are preserved verbatim:

```markdown
Entry-sequence correction: Codex/Astra, September 30, 2026, checked the current location provider, portal capture, header refresh and admission sources. Location and Briefing prepare before preference confirmation; Strategy starts only through explicit admission of that prepared context.

  Q --> C[Explicit Strategy start with confirmed preferences]

### 1. Session and preference review

- [run-setup-context.tsx](../../client/src/contexts/run-setup-context.tsx) loads canonical setup and saved same-session context. [RunSetupSummary.tsx](../../client/src/components/co-pilot/RunSetupSummary.tsx) offers preference confirmation or editing; [SettingsPage.tsx](../../client/src/pages/co-pilot/SettingsPage.tsx) saves edits. Confirmation holds/releases new Strategy, while location and Briefing prepare independently. Saving or confirming preferences does not itself start Strategy.
```


