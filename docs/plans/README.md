# Implementation Plans

This directory contains formal implementation plans for significant changes to the codebase.

## Active Plans

| Plan | Status | Priority | Created |
|------|--------|----------|---------|
| [AUDIT_REMEDIATION_PLAN.md](./AUDIT_REMEDIATION_PLAN.md) | AWAITING APPROVAL | P0/P1/P2 | 2026-01-06 |

## Plan Lifecycle

1. **DRAFT** - Plan being written
2. **AWAITING APPROVAL** - Ready for Melody's review
3. **APPROVED** - Ready for implementation
4. **IN PROGRESS** - Implementation underway
5. **COMPLETED** - All tasks done, tests passed
6. **ARCHIVED** - Historical reference

## Creating a New Plan

Plans are for architectural, naming, source-of-truth, destructive, or outward-facing work —
the cases CLAUDE.md §2 says to pause on. Safe, reversible, in-scope leaf work does not need a
plan document (CLAUDE.md §2 "Act on what you can safely do"; the numbered "Rule 1"
plan-then-approve gate this section used to cite was retired with claudeRev1 on 2026-08-17).

Plans must include:
- Objectives
- Approach
- Files affected
- Test cases

## Approval Process

For the plan-worthy cases above, Melody approves the plan (joint decision per
AI_PARTNERSHIP_AGREEMENT.md §2.3 / §12). Verification is the implementer's job: run the real
checks (`npm run lint`, `npm run typecheck`, the relevant jest suites) and report their output.
