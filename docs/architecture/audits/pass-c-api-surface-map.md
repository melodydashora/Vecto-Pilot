# Pass C — API Surface Relationship Map

**Date:** 2026-04-16
**Auditor:** Melody (with Opus review)
**Triggered by:** Need to formalize inter-endpoint contracts after scattered defensive-field-by-field bugs.
**Status:** Documented. Produced DECISIONS.md #16 (four-hop contract).

## Core finding

Field-level contracts span four hops: compute → persist → serialize → client-render. A field can silently die at any hop, and the defensive field-by-field pattern on both server (`enhanced-smart-blocks.js`) and client (`co-pilot-context.tsx`) made this a recurring bug class.

## Outcome

- DECISIONS.md #16 formalized the four-hop contract rule.
- Commit ec41f462 landed the rule in doctrine.
- Pass D ran immediately after and found the same pattern at the client layer, validating the doctrine in under 24 hours.

(Full Pass C content was captured via chat message. The outcome is what matters for reference.)
