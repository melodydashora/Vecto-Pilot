# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

---

## 🚨 DEVELOPMENT PROCESS RULES (MANDATORY)

**These rules govern ALL development work. No exceptions.**

### Rule 1: Planning Before Implementation
- **BEFORE making any code changes**, create a plan document in the same directory as the relevant README.md
- Plan must include: objectives, approach, files affected, and **test cases**
- Implementation requires **formal testing approval from Melody** (human developer)
- Do NOT proceed until Melody confirms: "All tests passed"

### Rule 2: README.md Synchronization
- **Every time** files in a folder/subfolder are modified, the corresponding README.md MUST be updated
- If forgotten, use `docs/review-queue/pending.md` to track and verify later

### Rule 3: Pending.md Verification
- If `docs/review-queue/pending.md` has information, **verify those changes first**
- Ensure README.md files and root documents (CLAUDE.md, ARCHITECTURE.md, LESSONS_LEARNED.md) reflect those changes before proceeding with new work

### Rule 4: Documentation Currency
- Understand the repo in its current state before making changes
- All documentation must be **fully up to date** at all times
- When in doubt, audit and update docs first

### Rule 5: Major Code Changes - Inline Documentation
- When changing **functional blocks of code** (major changes), add inline comments with:
  - Date of change (YYYY-MM-DD)
  - Reason for the change
- Update the relevant README.md and root documents

### Rule 6: Master Architect Role
- **Do NOT blindly accept Melody's memory or advice** - act as a master architect
- Push back on decisions that don't make technical sense
- Create sub-agents (Task tool) for complex investigations
- Make logical, well-reasoned decisions with justification

### Rule 7: AI Coach Data Access (Schema Changes)
When schema changes are made, ensure the **AI Coach** has access to:
- All database tables
- Snapshot history filtered by `user_id`
- Connected static data (markets, platforms, venue catalogues)

### Rule 8: AI Coach Write Access
The AI Coach needs **write access** to capture learnings from real user interactions:

| Table | Purpose |
|-------|---------|
| `venue_catalog` | Driver-contributed venue intel (staging spots, GPS dead zones) |
| `market_intelligence` | Market-specific patterns, surge zones, timing insights |
| `user_intel_notes` | Per-user notes from driver interactions |
| `zone_intelligence` | Crowd-sourced zone knowledge (dead zones, honey holes, staging spots) |
| `coach_conversations` | Thread history for cross-session memory |
| `coach_system_notes` | **AI Coach observations** about system enhancements |
| `discovered_events` | Event deactivation/reactivation (via `is_active` flag) |
| `news_deactivations` | User news hiding preferences |

**Note:** School closures and traffic conditions are stored in `briefings.school_closures` and `briefings.traffic_conditions` (JSONB columns), not separate tables. LLM consolidation via `callModel('BRIEFING_TRAFFIC')` at `briefing-service.js:1543`.

**Use Cases (examples, not exhaustive):**
- "Give me an exact staging location central to events and high-end venues where GPS signal is not blocked"
- "Analyze surge patterns - where do surges always start/end?"
- "How can I get short hops without going far from home?"
- Capture app-specific advice (e.g., "Turn on destination filter to stay in busy area")
- Learn from driver feedback what worked vs. what didn't

### Rule 9: ALL FINDINGS ARE HIGH PRIORITY

**This repo is a "how to code with AI" reference implementation. All issues must be completely resolved.**

- **Every audit finding** (from AI assistants, code review, or human inspection) is HIGH priority
- **No "low priority" bucket** - if an issue is found, it gets fixed or explicitly documented with a timeline
- **Includes "nice to have" suggestions** like model consolidation (e.g., "use fewer models for news/events")
- **Zero tolerance for drift** between docs, schema, metadata, and code
- **Duplicate logic = bug** - if the same calculation exists in multiple places, consolidate immediately

**Tracking Requirements:**
1. All findings MUST be logged in `docs/DOC_DISCREPANCIES.md` (or similar tracking document) if not immediately resolved.

### Rule 10: Unified AI Architecture
- The system uses a centralized AI capability layer defined in `server/lib/ai/unified-ai-capabilities.js`.
- **Do not** create ad-hoc AI implementations in individual services if they can be centralized.
- Ensure `startUnifiedAIMonitoring()` is active in the gateway bootstrap to maintain AI health.

### Rule 11: Event Sync Architecture (2026-02-17)
- **Background event syncing (`startEventSyncJob`) is STRICTLY FORBIDDEN.**
- Events must sync **per-snapshot** via the briefing pipeline.
- This architecture ensures data consistency with the user's current context and reduces unnecessary API load.
- **Do not** re-enable or reimplement background workers for event fetching.

### Rule 12: Session-Start Review Protocol (2026-02-25)
**At the start of EVERY session, review these documents before doing any work:**

| Priority | Document | Why |
|----------|----------|-----|
| 1 | `docs/review-queue/pending.md` | Unfinished doc updates from prior sessions |
| 2 | `docs/architecture/database-environments.md` | Dev vs Prod DB rules — prevents data accidents |
| 3 | `docs/DOC_DISCREPANCIES.md` | Open findings that need resolution |
| 4 | `docs/coach-inbox.md` | Memos from the AI Coach (Gemini) for Claude Code |
| 5 | `LESSONS_LEARNED.md` | Critical production mistakes to never repeat |
| 6 | `docs/architecture/full-audit-2026-04-04.md` | Latest comprehensive audit findings (37 issues) |

**This is your memory layer.** These documents persist across sessions and are your primary source of truth for the current state of the project. When you learn something important during a session, update the relevant document so future sessions benefit.

### Rule 13: Database Environment Awareness (2026-02-25, updated 2026-04-05)
- **Dev and Prod are TWO SEPARATE Replit Helium (PostgreSQL 16) instances** with completely isolated data
- **Dev:** Replit Helium — used in the workspace editor (no SSL)
- **Prod:** Replit Helium — used in published deployments (SSL required)
- Replit **automatically injects** `DATABASE_URL` for the correct instance — this is the ONLY database variable
- **Do NOT** create custom env-swapping logic — Replit handles this natively
- **Do NOT** reference PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE — only `DATABASE_URL` exists
- **Do NOT** assume data from dev exists in prod or vice versa
- See `docs/architecture/database-environments.md` for full details

### Rule 14: Model-Agnostic Adapter Architecture (2026-02-25)
- The system uses a **model-agnostic adapter pattern** (`server/lib/ai/adapters/` + `model-registry.js`)
- Model names are **decoupled** from provider API keys — a model can be routed through any adapter (direct API, Bedrock, Vertex AI, etc.)
- **Do NOT** hardcode model-name-to-API-key mappings (e.g., `claude- → ANTHROPIC_API_KEY`) in validation or config
- Environment validation checks **general** API key presence; **per-model** credential validation happens at runtime through the adapter layer
- When in doubt about model routing, consult the adapter layer — it owns that responsibility

---

## 📂 Key Files & Architecture

- **`gateway-server.js`**: Main application entry point. Handles bootstrap, environment validation, and mounts the Unified AI capabilities.
- **`server/lib/ai/unified-ai-capabilities.js`**: Central registry for AI capabilities and health monitoring.
- **`server/bootstrap/routes.js`**: Central route mounting logic.
- **`server/bootstrap/workers.js`**: Worker process management (Strategy Worker).