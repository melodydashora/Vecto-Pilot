# Architecture Audits

This directory captures architectural audit passes on the Vecto-Pilot codebase. Each pass is named by letter (A, B, C, D, E, F, ...) and documents the topology, findings, rules extracted, and follow-ups identified during that pass.

**Distinction from DECISIONS.md:**
- `DECISIONS.md` = prescriptive rules ("never do X", "always use Y")
- `audits/` = descriptive topology snapshots ("here's what the system looked like on date Z, here's what we learned")

Audit passes typically produce 0-N new DECISIONS.md entries. The audit file captures the full reasoning; the decision entry captures the shortest actionable rule.

## Index

| Pass | Date | Scope | Outcome |
|------|------|-------|---------|
| A | (prior) | (not yet captured retroactively) | |
| B | (prior) | (not yet captured retroactively) | |
| C | 2026-04-16 | API surface relationship map | Produced DECISIONS.md #16 (four-hop contract) |
| D | 2026-04-16 | Client field survivability | Closed by commit 6b321afb (beyond_deadhead end-to-end) |
| E | 2026-04-16 | Coach / notes / memory / observability relationship map | 5 E-Rules documented, Pass F queued |
| F | (pending) | Issue logging / feedback / monitoring survivability | Not yet run |

## Retroactive captures

Passes A and B happened earlier in session history. They can be reconstructed from commit messages and memory entries if needed. Priority for now is forward-capture (E, F, future passes).
