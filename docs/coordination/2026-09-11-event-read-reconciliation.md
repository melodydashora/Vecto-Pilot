# Event report presentation reconciliation

Provenance: Desktop Astra implementation during Melody's September 10 four-hour
Vecto session (September 11 UTC). The immediate input was Desktop's signed-in UI
observation of three concert title variants and two football title variants.
Those are observed app rows, not externally verified schedules or event identities.

Base: `0a80e83fb677108738ff3269b87dfa0927224e15`.
Branch: `astra/event-read-reconcile-20260911`.
This is an isolated, unpublished candidate. It must be reconciled with the newer
Replit integration rather than replacing that tree or its Briefing ownership fixes.

## Scope and contract

The existing Briefing API silently discarded exact title/date/venue duplicates
while letting the observed title variants through. The replacement is a pure
presentation projection. It neither changes storage hashes nor deactivates,
deletes, updates, or verifies discovery records. Earlier storage-dedup doctrine
still applies to actual storage identity; this patch does not claim to repair it.

- Grouping requires an equal resolved `venue_id` (or equal explicit `place_id`),
  date span, and exactly equivalent normalized start time. Report IDs, venue names,
  addresses, similar spelling, and a nearby time are not substitute venue identity.
- Exact titles may group. Concert-category titles also allow two exact colon
  segments in either order and an omitted comma-delimited supporting lineup.
  Differing explicitly supplied lineups do not merge. Pairwise agreement against
  every member prevents a short title bridging contradictory lineups.
- Every grouped original remains in `event_variants`, including its original title,
  dates, times, ID and other supplied fields. `source_event_ids` lists known row IDs.
  These IDs identify source rows, not independently verified external event IDs.
- If normalized end reports disagree, including known versus missing, the API
  omits the group's `event_end_time` and sets `event_end_conflict: true`. The UI
  displays the start, states that the end is unconfirmed, and expands all reports.
  It never promotes the longest end time or title to authoritative status.
- Freshness and active-time predicates run on original rows. A group remains while
  any eligible original remains, keeping expired conflicting reports for explanation.
  All-expired groups disappear; an omitted projected end cannot make them ongoing.
- Local and market lists are reconciled together. A visible local report owns the
  one displayed card; otherwise a visible market report retains it in the market list.
  Existing local-versus-market active-filter semantics are preserved.

## Identity availability and limitations

The preserved schema has `discovered_events.venue_id` linked to `venue_catalog`.
The discovery-to-Briefing mapping already carries it; this patch additionally
preserves the selected event `id`. Both market API mappings now select and retain
the existing venue and event IDs. No schema migration or new lookup is needed.

Legacy snapshots or discovery rows with no resolved venue identity remain separate.
The live UI did not expose those IDs, so this work does not establish whether every
observed duplicate will group in production. The regression fixtures use synthetic
resolved venue IDs and also prove that removing them preserves separate rows.

The two football titles remain separate: the short/expanded school names have no
verified alias relationship here. The discovery normalizer's destructive `@`
suffix handling is documented for separate identity work and was not broadened.
Other distinct performers, opponents, starts, dates, and venues remain separate.

This patch does not alter Strategy/Coach event context or explain the separate
"no nearby events" narrative. Planner-grade venue and distance filters differ
from the Briefing presentation; matching generation/source evidence is still needed.
Consumers of these API projections must treat `event_end_conflict` as uncertainty
and may inspect `event_variants`, rather than treating a missing end as indefinite.

## Validation

Executed without provider calls, database calls, migrations, or private case data:

- `tests/events/event-read-reconciliation.test.js`: 17 passing checks, including
  the exact observed title/time tuples with synthetic identities, distinct starts,
  performers/opponents, missing identity, line-up bridge rejection, local/market
  preservation, known/missing ends, and mixed-expired/all-expired source reports.
  The actual `filterFreshEvents` predicate is exercised with infrastructure mocked:
  ends at 18:00/18:30 retain one group and both reports at 20:15 during the existing
  two-hour surge window, then disappear at 20:31. An exact-window visibility
  callback also retains the group at 18:15 and drops it at 18:31; this does not
  directly exercise the route's private active-time parser.
- `tests/EventsComponentReconciliation.test.tsx`: 8 passing tests of the real
  component, grouped counts, expandable originals, end conflicts, separate starts
  and school variants, and date/timezone eligibility.
- `node node_modules/typescript/bin/tsc -b` passed.
- ESLint over every changed application file, server syntax checks, and
  `git diff --check` passed.
- Independent read-only peer review found no blocking defect. All six input
  permutations of a short title and two incompatible explicit lineups retained
  all source IDs without placing both explicit lineups into one group.

No hosted browser/responsive check or integrated protected-app acceptance is
claimed. The backend tests exercise the pure projection and visibility contract;
they do not make a real HTTP request through the authenticated database routes.
Inspect the updated Briefing cards in the combined candidate before publication.
