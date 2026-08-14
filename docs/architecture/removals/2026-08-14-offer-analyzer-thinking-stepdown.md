# Removed: OFFER_ANALYZER HIGH-thinking config + its 8192-token rationale (2026-08-14)

**What was removed** (lived at `server/lib/ai/model-registry.js` in the
`OFFER_ANALYZER` entry, both lines landed 2026-05-29):

```js
    // 2026-05-29: Raised 1024 → 8192. HIGH thinking consumes the output-token budget
    // (same rationale as BRIEFING_TRAFFIC's 4096→8192 bump). At 1024 the JSON decision
    // truncates mid-token — the exact "[HOOKS] Phase 1 JSON parse failed" symptom.
    maxTokens: 8192,
    temperature: 0.1, // Near-deterministic for consistent decisions
    thinkingLevel: 'HIGH', // 2026-05-29: per request (see latency trade-off note above)
```

**Why**: superseded by Melody's <3s hard latency requirement (2026-08-14,
verbatim: "We have to get it to less than 3 seconds", todo #43). The registry's
own latency trade-off note (dated 2026-02-26/2026-05-29, still in place above
the entry) prescribed exactly this exit: "step down to 'LOW'/'MINIMAL' or move
deep reasoning to Phase 2." Phase 2 (`OFFER_ANALYZER_DEEP`, async) has owned
deep reasoning since 2026-02-28, so HIGH on the synchronous Siri-bound path
bought latency without a decision-quality role.

Live benchmark (2026-08-14, gemini-3.5-flash, 3 runs/config, real Phase-1
prompts; text HIGH avg matched prod p50 5.2s, validating the method):

| Config | text avg | vision avg |
|---|---|---|
| HIGH/8192 (removed) | 5249ms | 5496ms (1/3 parse-fail) |
| MINIMAL/1024 (new) | 3120ms | 2512ms (clean) |

Decision parity held at MINIMAL (same ACCEPT + identical terse reason).
The 8192 cap fell WITH the thinking level — it existed only because HIGH
thinking consumed the output budget; at MINIMAL the ~40–150-token JSON fits
1024 with headroom, and the low cap truncates observed degenerate repetition
tails in ~1s (a truncated parse fail-overs to the deterministic rules engine —
the always-answer contract in `analyze-offer.js`).

**Coverage**: decision-parity for the deterministic answer-of-last-resort is
pinned by `tests/offers/rules-engine-parity.test.js`; the same-day fast-lane +
downscale changes are covered in `tests/offers/downscale-offer-image.test.js`.
