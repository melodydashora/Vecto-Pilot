# Venue feedback changes — September 11, 2026

Provenance: Replit Codex/Astra venue backend subagent, within Melody's authorized
sprint and Desktop's explicit scoped dismissal/Undo approval. Base74fe5bf9.

## Backend

The old vote-only route returned `{ok:true}` after an unchecked scope upsert and
optional action insert. It now validates authenticated snapshot and ranking
ownership, relationship, and candidate membership; persists the vote and display
receipt atomically; and replays identical request IDs. It uses the existing
`venue_feedback` vote row plus append-only `actions` with the private action name
`venue_feedback_state`, which public instrumentation's enum does not accept.

Undo appends a new state receipt and preserves the original downvote. It does not
invent an upvote, delete feedback, change the venue/catalog, or affect another
user or ranking. The current owned ranking/snapshot is the scope; no TTL or global
manual scoring policy was added. Todo58's broader learning/scoring work remains.

`GET /api/blocks-fast/saved` reads existing candidates and receipt state only.
Existing cached/pending/new block returns also honor exclusions. Once feedback
state exists, cached reloads skip external address resolution. The housekeeping
rate-limit timer is unref'ed so importing the route cannot hold a CLI test open.
SQL failures log only correlation/code because Drizzle error messages can embed
private feedback text and complete receipt parameters.

Actual disposable PostgreSQL verification found only the vote table's primary
key and foreign keys; the user/ranking/place uniqueness assumed by the old route
was absent. The helper now selects the owned vote while holding the ranking row
lock, updates that exact identity or inserts once, and returns an explicit
conflict for ambiguous historical duplicates or snapshot mismatch. No schema or
historical-row repair was performed. The PGlite fixture now mirrors that missing
constraint, and real PostgreSQL tests exercise simultaneous request queues.

Two repeated-request Undo cases are also covered: an already-restored dismissal
retains its confirmed visible list, and a repeated dismissal retains its original
replacement identity privately in the action record. The latter prevents an
A/B display reorder from removing an unrelated card during Undo. The public
receipt contract is unchanged.

The replaced historical comments are retained below for provenance. They explain
the prior route and do not describe the new action receipt contract.

```javascript
// POST /api/feedback/venue
    // 2026-02-13: Use only authenticated user_id — body userId removed (spoofing risk)
    // Validate required fields
    // Validate sentiment
    // Sanitize comment (limit to 1000 chars, strip HTML)
    // Check rate limit
    // 2026-01-09: Fixed rate limit bug - use authUserId not body userId
    // Using body userId collapsed all anonymous users into one bucket
    // Upsert feedback (update if exists, insert if new)
    // Log to actions table (optional instrumentation)
      // 2026-03-17: SECURITY FIX (F-13) — was `userId` (undefined since 2026-02-13 removal)
    // LEARNING CAPTURE: Index feedback for semantic search (async, non-blocking)
        // 2026-03-17: SECURITY FIX (F-13) — was `userId` (undefined)
```

## Client

The modal's old immediate close, success callback and optimistic thank-you toast
ran before its background request. Its generic request helper did not attach the
current bearer token. The modal now retains the venue/comment until confirmation,
shows retryable errors, and fences late responses by user/token/snapshot/ranking.
Venue receipts apply through the scoped hook; app/strategy feedback keep their
existing endpoints with explicit HTTP and body checks.

Strategy's raw-block/index dwell observers were replaced with observers over the
actual displayed places, keyed by canonical place ID within the ranking. This
prevents replacement cards inheriting another venue's dwell identity. Card and
map identity follow the same place IDs. The historical Grade A-only description
was inaccurate because the existing filter accepts A and B; labels now reflect
that policy and preferred spacing. Numeric zero processing time no longer renders
as a stray child in the header.

Replaced explanatory comments, retained here for provenance:

```typescript
// Choose endpoint based on feedback type
// Build payload based on feedback type
// Close modal immediately for better UX
// Submit feedback in background
// Filter blocks to show only top 3 Grade A venues that are >= 1 mile apart
// This is the "NOW strategy" - focused, actionable recommendations
```
