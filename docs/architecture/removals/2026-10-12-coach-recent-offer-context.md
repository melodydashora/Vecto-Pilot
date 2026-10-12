# Coach recent offers and outcome context — October 12, 2026

Melody clarified that recent quick/deep analysis is distinct from the separately
named Saved Offers feature. Current source stores both analyses on
`offer_intelligence`; this record does not invent separate tables or a new save
action. The authenticated Coach read now includes the separate owner-matched
`offer_outcomes` row, with null meaning unknown, and orders observations by valid
numeric `request_at`. Legacy or malformed observation timestamps explicitly use
`created_at`. Deep completion order must not determine the latest observed offer.

The quick verdict, deep evidence and outcome remain distinct. Passenger names are
usable only when actually present in evidence; an Accepted outcome does not prove
an active trip. The existing asynchronous ingestion can leave a just-returned quick
result unavailable until persistence. That limitation is preserved rather than
covered by an invented record.

The earlier method and presentation are preserved verbatim below from the
pre-edit working source based at `380bdb619dfdea77be9b357f02e3ef62bc5a8e43`.
The read previously omitted per-offer outcomes and ordered by completion-time
`created_at`; the display also formatted that time in the server's local zone.
Current verification uses disposable PostgreSQL fixtures and mocked provider
streams; this is not deployment or live-driver evidence.

## Previous recent-offer reader

```js
  async getOfferHistory(userId, limit = 20) {
    const windowLimit = Math.min(50, Math.max(1, Number.isInteger(limit) ? limit : 20));
    if (!userId) {
      console.warn('[COACH] getOfferHistory: no userId — returning empty history (offers are per-user)');
      return { offers: [], stats: null, source_state: 'unavailable', limit: windowLimit };
    }
    try {
      const history = await db
        .select()
        .from(offer_intelligence)
        .where(and(eq(offer_intelligence.user_id, userId), isNull(offer_intelligence.removed_at)))
        .orderBy(desc(offer_intelligence.created_at))
        .limit(windowLimit);

      if (history.length === 0) {
        return { offers: [], stats: null, source_state: 'available', limit: windowLimit };
      }

      const accepted = history.filter(h => h.decision === 'ACCEPT');
      const rejected = history.filter(h => h.decision === 'REJECT');
      const overrides = history.filter(h => h.user_override != null);
      const perMileValues = history
        .map(h => h.per_mile == null ? null : Number(h.per_mile))
        .filter(v => v != null && Number.isFinite(v) && v >= 0);

      const stats = {
        total: history.length,
        accepted: accepted.length,
        rejected: rejected.length,
        accept_rate_pct: Math.round((accepted.length / history.length) * 100),
        overrides: overrides.length,
        avg_per_mile: perMileValues.length > 0
          ? (perMileValues.reduce((a, b) => a + b, 0) / perMileValues.length).toFixed(2)
          : null,
        avg_response_ms: Math.round(
          history.reduce((sum, h) => sum + (h.response_time_ms || 0), 0) / history.length
        ),
      };

      console.log(`[COACH] getOfferHistory: ${history.length} offers, ${stats.accept_rate_pct}% accept rate`);
      // 2026-07-06: normalize legacy daypart keys in historical rows so LLM/
      // analytics consumers see one taxonomy (raw value passes through only if
      // it's not a known key — stored data, not a fabrication).
      const offers = history.map(h => ({
        ...h,
        day_part: h.day_part ? (normalizeDayPartKey(h.day_part) ?? h.day_part) : null,
      }));
      return { offers, stats, source_state: 'available', limit: windowLimit };
    } catch (error) {
      console.error('[COACH] getOfferHistory error:', error);
      return { offers: [], stats: null, source_state: 'read_failed', limit: windowLimit };
    }
  }

```

## Previous recent-offer summary

```js
    // ========== OFFER ANALYZER HISTORY ==========
    // Saved analyzed offers for pattern-aware coaching.
    const { offerHistory } = context;
    if (offerHistory?.stats && offerHistory.stats.total > 0) {
      const s = offerHistory.stats;
      prompt += `\n\n=== OFFER ANALYZER HISTORY ===`;
      prompt += `\nStats (last ${s.total} offers):`;
      prompt += `\n   Accept rate: ${s.accept_rate_pct}% (${s.accepted} accepted, ${s.rejected} rejected)`;
      if (s.avg_per_mile) prompt += `\n   Avg $/mile: $${s.avg_per_mile}`;
      prompt += `\n   Avg response time: ${s.avg_response_ms}ms`;
      if (s.overrides > 0) {
        prompt += `\n   Driver overrides: ${s.overrides} (driver disagreed with AI ${s.overrides} time${s.overrides > 1 ? 's' : ''})`;
      }

      prompt += `\n\n   Recent offers:`;
      offerHistory.offers.slice(0, 5).forEach((offer, i) => {
        const price = offer.price != null ? `$${Number(offer.price).toFixed(2)}` : '?';
        const miles = offer.total_miles != null ? `${Number(offer.total_miles).toFixed(1)}mi` : '?';
        const pm = offer.per_mile != null ? `$${Number(offer.per_mile).toFixed(2)}/mi` : '';
        const override = offer.user_override ? ` [DRIVER OVERRIDE: ${offer.user_override}]` : '';
        const time = new Date(offer.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        prompt += `\n   ${i + 1}. ${offer.decision} ${price}/${miles} ${pm} (${time})${override}`;
      });

      prompt += `\n\n   Use offer patterns to advise on positioning, timing, and offer strategy.`;
    }


```

## Retired terminology

The settings prompt phrase `directs you to review saved offers and tune settings`
is now `directs you to review recent offers and tune settings`. This is a naming
correction, not a new authorization rule.

The earlier source prompt said:

```text
Stored offer decisions belong to the Offer Analyzer. Discuss their evidence and
longitudinal patterns; never OCR a new offer or issue a new ACCEPT/REJECT/CANCEL
verdict. A later analysis pass may enrich the same saved offer; preserve its
original decision and distinguish analysis evidence from the driver's outcome.
The recent-offer window is bounded; it is not the driver's entire history.
```

The preceding Coach lexicon row and canonical document paragraphs are already
preserved in [the snapshot context record](2026-10-12-coach-snapshot-context.md).
The current capability map retains existing event, intelligence, notes, settings,
memo and refresh paths; a feature/test request memo is not a shell/test execution
receipt. No Coach offer bookmark, outcome mutation or new verdict action was added.

