# Last completed Strategy during refresh and reopen — design only

Provenance: Astra Replit, September 10, 2026. Requested after VP-002/VP-006.
Grounded in `3674a440` plus the isolated auth candidate. No retention implementation
or edits to Desktop Astra's overlapping files. Linked existing task: todo 34.

## Current behavior verified in source

`App.tsx` already places CoPilotProvider above RouterProvider; moving it will not
fix refresh loss. `co-pilot-context.tsx` holds `immediateStrategy`, wipes it on
`vecto-strategy-cleared`, snapshot change and auth loss, and adopts any nonempty
`strategyData.strategy.strategyForNow`. Its query tags responses with `_snapshotId`.
`location-context-clean.tsx` manual refresh clears query cache and both legacy
strategy storage slots, then emits the clear event. Auth completion/logout clears
those slots for session isolation.

`StrategyPage.tsx` reads the provider. Its current ternary gives GPS absence and
immediateStrategy precedence over failure/pending display. Simply keeping that string
would hide a new failure and label old advice “Where to Go NOW.” The retired
`useStrategyPolling.ts` throws if called; `useStrategy.ts` is used only by `_future`
components, not this page. There is no active `lastGood` identifier or functioning
legacy persistent-strategy writer in this baseline. Recheck Desktop's candidate
before implementing: its readiness/error handling changes these same paths.

## Proposed state and behavior

Keep `lastCompletedStrategy` in CoPilotProvider separately from the active snapshot,
Briefing, query data and pipeline progress. Store an immutable display record with
owner user ID, source snapshot ID, strategy identity/version if supplied, actual
completion timestamp, snapshot timezone/context label and completed text. Adopt only
a response matching the active request's auth generation and snapshot, with the
server's verified complete-Strategy contract. Desktop's full-Briefing guard is a
prerequisite. Nonempty text, `pending_blocks`, timeout, or an error marker alone must
not authorize promotion; confirm the final endpoint status contract after integration.

On refresh, cancel/reset active work as today while retaining the completed display
record. Show “Previous strategy” with its original time/context and “New strategy is
being prepared.” If ANY Briefing section fails, keep Desktop's visible red retry and
reason above the historical card. No partial Strategy generation. Never feed the
previous strategy/Briefing into the new generation to bypass missing inputs:
full context means the active snapshot plus its FULL Briefing.

Replace the record atomically when the new completed Strategy arrives. An old delayed
response must not replace a newer record. Historical display must not borrow the new
snapshot's map, venue actions, feedback identifiers, current-status labels or timezone.
Propose read-only historical text initially; no old venue/action replay.

Route changes and background/foreground reopen in the same mounted app naturally
retain provider state. Cold reload requires persistence: propose a versioned,
owner-bound envelope using the existing strategy storage surface, rather than a new
parallel cache. Hydrate only after authenticated owner verification; reject malformed,
legacy unowned or future-dated records. Clear on logout/account switch/auth invalidation,
and ignore storage events from other owners. Keep active snapshot restore independent.
Storage failure should leave in-memory display working with an explicit persistence
limitation. Auth cleanup and storage ownership must be coordinated with this candidate.

## Decisions and verification before implementation

Melody's failure rule is resolved: a failed Briefing blocks new Strategy and shows red
retry/reason. Remaining product decision: maximum age for displaying historical advice
on cold reopen (todo 23's resume policy is still open). Do not silently extend the
15-minute active-snapshot resume TTL or treat historical text as current advice.

After Desktop's readiness candidate is selected, agree exact completed-output predicate,
record fields, age policy and storage migration before touching shared files. Tests:
A complete → B pending; B Briefing failure with A still labelled historical and red
reason visible; B success replaces A; late A response ignored; route return/background
resume/cold reload; malformed/wrong-owner/expired storage; logout then another user;
retry during refresh; GPS absent with historical text and honest current GPS failure.
