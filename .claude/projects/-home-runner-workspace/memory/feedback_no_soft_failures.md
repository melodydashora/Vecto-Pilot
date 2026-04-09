---
name: No soft failures — treat broken features as broken
description: Never dismiss production warnings as "non-fatal" — if a feature is broken, it's broken. Melody expects root-cause thinking, not surface-level triaging.
type: feedback
---

Never say "these aren't fatal" about production warnings that mean features are broken. If `TOKEN_ENCRYPTION_KEY` is missing and Uber OAuth is configured, that's not a "warning" — that's a broken feature hiding behind a soft error.

**Why:** Melody is building a reference implementation to showcase what a non-coder can achieve with AI-assisted development. Every "non-fatal warning" that hides a broken feature undermines that showcase. The standard is: if it's broken, call it broken and fix it.

**How to apply:** When reviewing logs, validation output, or audit findings — if something will cause a user-facing failure at runtime, escalate it to an error regardless of how the code currently classifies it. Think ahead, trace the consequence chain, and flag the root cause.
