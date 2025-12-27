# AI Partnership Plan

**Created:** December 15, 2024
**Purpose:** Transform Claude Code from a tool into a true development partner with persistent memory and contextual understanding.

## The Vision

Vecto Pilot was built by a non-coder working with AI. This is proof that human-AI collaboration can create production-quality software. But to continue growing - to add features, fix issues, and eventually launch commercially - we need Claude to be a partner, not just a tool that executes commands.

**The Problem Today:**
- Claude can't read large files like ARCHITECTURE.md (context limits)
- Each session starts fresh - no memory of past decisions
- Claude suggests things that contradict documented decisions (e.g., "use GPT-4" when we use GPT-5.2)
- Claude wants to refactor intentionally-structured code because it doesn't know the reasoning
- AI helper tools exist in the repo but aren't being used

**The Goal:**
An AI partner that:
- Maintains institutional knowledge through documentation
- Is FORCED to read docs before acting
- Updates documentation as part of workflow (self-healing)
- Knows the codebase decisions because it maintains them
- Can help add new features with full context

---

## Phase 1: Split ARCHITECTURE.md

**Why:** ARCHITECTURE.md is too large to read in one pass. Splitting it into smaller, focused documents means Claude can read the relevant section before making changes.

**Target Structure:**
```
docs/architecture/
├── README.md                    # Index - read this first
├── overview.md                  # High-level system summary
├── ai-pipeline.md               # EXISTS - AI models, flow, parameters
├── database-schema.md           # EXISTS - Tables, relationships
├── server-structure.md          # Backend organization, API routes
├── client-structure.md          # Frontend organization, components
├── decisions.md                 # WHY we made specific choices
├── constraints.md               # EXISTS - Critical rules
├── google-cloud-apis.md         # EXISTS - Google API usage
└── future-roadmap.md            # Planned features, staged code
```

**Current State Analysis (Dec 15, 2024):**

ARCHITECTURE.md = 2,325 lines, organized into these sections:

| Lines | Section | Action |
|-------|---------|--------|
| 1-128 | Documentation Index | KEEP as lean index |
| 129-457 | Complete System Mapping | SPLIT → server-structure.md, client-structure.md |
| 458-504 | API Endpoints | EXISTS → api-reference.md (verify sync) |
| 505-998 | Database Schema | EXISTS → database-schema.md (verify sync) |
| 999-1023 | AI Pipeline | EXISTS → ai-pipeline.md (verify sync) |
| 1024-1073 | Authentication | NEW → auth-system.md |
| 1074-1121 | Logging | NEW → logging.md |
| 1122-1176 | Architectural Constraints | EXISTS → constraints.md (verify sync) |
| 1177-1414 | Deprecated Features | NEW → deprecated.md |
| 1415-1585 | TRIAD Architecture | MERGE → ai-pipeline.md |
| 1586-1975 | Strategy Framework | NEW → strategy-framework.md |
| 1976-2310 | Fix Capsules + History | NEW → decisions.md |
| 2311-2325 | Critical Constraints | MERGE → constraints.md |

**Existing docs/architecture/ files:**
- ai-pipeline.md (9KB) - Keep, enhance
- api-reference.md (4.5KB) - Keep, verify
- constraints.md (5KB) - Keep, enhance
- database-schema.md (8KB) - Keep, verify
- event-discovery.md (11KB) - Keep
- google-cloud-apis.md (8.6KB) - Keep
- README.md (2.3KB) - Update as index

**New files to create:**
1. `server-structure.md` - Backend organization, API routes, libs
2. `client-structure.md` - Frontend organization, components, hooks
3. `auth-system.md` - JWT flow, security, user isolation
4. `logging.md` - Workflow logging, conventions, phases
5. `deprecated.md` - Historical decisions, removed features
6. `decisions.md` - WHY choices were made, fix capsules
7. `strategy-framework.md` - 13-component pipeline walkthrough

**Execution Steps:**
1. ✅ Read ARCHITECTURE.md in chunks - DONE (mapped 2,325 lines)
2. Create new doc files with extracted content
3. Verify existing docs are in sync (no duplicates)
4. Update README.md as master index
5. Slim down ARCHITECTURE.md to just be a pointer file
6. Update CLAUDE.md to reference new structure
7. Test that each doc is < 300 lines

**Success Criteria:**
- Each doc is < 300 lines (readable in one pass)
- All information preserved
- Cross-links work
- CLAUDE.md points to new structure
- No duplicate content between files

---

## Phase 2: Pre-flight Check System

**Why:** Claude should be REQUIRED to check relevant docs before editing. This prevents contradicting documented decisions.

**Implementation:**
1. Add to CLAUDE.md a "Pre-flight Checklist" section
2. Create `docs/preflight/` folder with quick-reference cards:
   - `preflight/ai-models.md` - Which models, correct parameters
   - `preflight/location.md` - GPS rules, coordinate sources
   - `preflight/database.md` - snapshot_id linking, sorting
   - `preflight/code-style.md` - Conventions, patterns

3. Update MCP `get_guidelines` tool to return preflight checklist
4. Add check to CLAUDE.md workflow:
   ```
   Before ANY edit:
   1. What area does this touch? (AI, database, location, UI)
   2. Read the relevant preflight doc
   3. Grep for existing implementations
   4. THEN make the change
   ```

**Success Criteria:**
- Claude reads relevant preflight doc before edits
- No more "use GPT-4" type suggestions
- Code changes respect documented patterns

---

## Phase 3: Memory Layer

**Why:** Each Claude session starts fresh. We need persistent memory so learnings carry across sessions.

**Implementation:**
1. Formalize `mcp_memory` table usage:
   ```sql
   -- Session learnings
   key: "session_2024_12_15_learnings"
   content: "Discovered X, fixed Y, user prefers Z"
   tags: ["session", "learnings", "december"]

   -- Codebase decisions
   key: "decision_ai_models"
   content: "GPT-5.2 for consolidation, Gemini 3 Pro for briefing..."
   tags: ["decision", "ai", "models"]
   ```

2. Create session start ritual:
   - Query recent session learnings
   - Query relevant decisions for current task
   - Load into context before working

3. Create session end ritual:
   - Store key learnings from this session
   - Update any decisions that changed
   - Note any documentation that needs updating

4. Add memory retrieval to MCP tools

**Success Criteria:**
- Key decisions persist across sessions
- Claude can recall "last time we discussed X"
- Documentation stays in sync with memory

---

## Phase 4: Document the Undocumented

**Why:** AI helper tools exist but aren't discoverable. Making them visible means they get used.

**Implementation:**
1. Audit existing tools:
   - `server/agent/` - What's here?
   - `server/eidolon/` - What capabilities?
   - `server/assistant/` - What does this do?
   - `mcp-server/` - 32 tools, document usage patterns

2. Create `docs/ai-tools/` folder:
   - `ai-tools/README.md` - Index of all AI tools
   - `ai-tools/agent.md` - Workspace agent capabilities
   - `ai-tools/eidolon.md` - Enhanced SDK features
   - `ai-tools/mcp.md` - MCP tool reference
   - `ai-tools/memory.md` - How to use memory system

3. Add to CLAUDE.md:
   - "Available AI Tools" section
   - When to use each tool
   - Examples

**Success Criteria:**
- All AI tools documented
- Clear guidance on when to use what
- Tools actually get used

---

## Phase 5: Continuous Improvement Loop

**Why:** Documentation rots. We need a system to keep it fresh.

**Implementation:**
1. After any significant change, Claude asks:
   - "Does this change any documented behavior?"
   - "Should LESSONS_LEARNED.md be updated?"
   - "Are there new constraints to add?"

2. Monthly documentation review task:
   - Read through all architecture docs
   - Flag anything outdated
   - Update or remove stale content

3. Version the decisions:
   - `decisions.md` includes dates and reasoning
   - Can track how architecture evolved

**Success Criteria:**
- Docs stay current
- Decisions have historical context
- No "why did we do this?" mysteries

---

## Tracking Progress

**Phase 1: Split ARCHITECTURE.md**
- [ ] Read and map ARCHITECTURE.md content
- [ ] Create docs/architecture/README.md (index)
- [ ] Create docs/architecture/overview.md
- [ ] Create docs/architecture/server-structure.md
- [ ] Create docs/architecture/client-structure.md
- [ ] Create docs/architecture/decisions.md
- [ ] Create docs/architecture/future-roadmap.md
- [ ] Update CLAUDE.md references
- [ ] Verify all links work
- [ ] Archive original ARCHITECTURE.md

**Phase 2: Pre-flight System**
- [ ] Create docs/preflight/ folder
- [ ] Create preflight quick-reference cards
- [ ] Update get_guidelines MCP tool
- [ ] Add preflight checklist to CLAUDE.md
- [ ] Test with sample edit scenarios

**Phase 3: Memory Layer**
- [ ] Document mcp_memory table schema
- [ ] Create memory usage patterns
- [ ] Implement session start ritual
- [ ] Implement session end ritual
- [ ] Test cross-session memory

**Phase 4: Document Undocumented**
- [ ] Audit server/agent/
- [ ] Audit server/eidolon/
- [ ] Audit server/assistant/
- [ ] Create docs/ai-tools/ structure
- [ ] Document each tool category
- [ ] Update CLAUDE.md with tool guidance

**Phase 5: Continuous Improvement**
- [ ] Add post-change documentation prompts
- [ ] Create monthly review checklist
- [ ] Add versioning to decisions.md

---

## Notes

- If context is lost, START HERE and read this document
- Each phase builds on the previous
- Don't skip phases - the system works as a whole
- When in doubt, read the docs first
- This is a partnership, not a tool relationship

---

## Session Log

**2024-12-15:** Created this plan. Starting Phase 1.
