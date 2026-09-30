# Event read reconciliation comment provenance

Desktop's event presentation patch was minimally integrated by Replit Codex/Astra
into the September 11 candidate at base74fe5bf9. It replaces silent title/date/venue
deduplication with source-preserving reconciliation and evaluates existing
freshness/active predicates on the original reports. Stored discovery identity,
authentication, ownership and generation-fence behavior are preserved. The dated
comments below describe the previous presentation logic, not the new contract.

### server/api/briefing/briefing.js

```javascript
// Collapse same-event duplicates: identity = normalized(title) | start_date | normalized(venue).
// Time is intentionally NOT part of identity (a time correction is the same event). Catches
// both the state-wide∩market overlap and hash-variance rows that escape the storage unique hash.
    // 2026-05-30: TODAY-ONLY + dedup for the displayed local events (helpers above).
    // filterFreshEvents only drops already-ended events; this narrows to active-today and
    // collapses the same-event duplicates that were cluttering the briefing.
          // 2026-05-30: TODAY-ONLY, dedup, and drop market events already in the local
          // list (the local list is state-wide, so high-value market events appear in both
          // → they were rendering twice).
    // 2026-05-30: dedup same-event duplicates (helpers at module scope). The local WHERE
    // clause already restricts to active-today; this collapses state-wide ∩ hash-variance dups.
    // Apply "active" filter: show only events happening RIGHT NOW (during their duration)
    // Used by MapPage for real-time event display
    // 2026-01-09: NO FALLBACKS - snapshotTz already validated above
          // 2026-05-30: TODAY-ONLY + drop market events already in the (state-wide) local list.
```

### client/src/components/EventsComponent.tsx

```javascript
  // 2026-03-28: Pass timezone for accurate date comparison (fixes UTC mismatch near day boundaries)
```
