# Airport empty-state comment preservation — September 11, 2026

Provenance: Replit Codex/Astra, frontend sprint follow-up to todo #8. The card
now waits for its section and requires a server reason for an empty result.
Recommendations and a generic geographical assertion no longer substitute for
that reason. Failure remains visible when nearby airport identities are retained.

The replaced comment below is preserved from main `6a97c058` and the v1 frontend
patch. Its static fallback instruction is superseded by the current behavior.

```text
2026-08-06: verifiedEmpty shape carries server-provided text
(e.g., "No major airports within 50 miles of this location") —
prefer it so verified-empty / missing-coords / residual
failures are distinguishable. Static string is final fallback.
```
