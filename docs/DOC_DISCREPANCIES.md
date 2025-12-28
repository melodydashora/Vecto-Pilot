# Documentation Discrepancy Tracker

This file tracks discrepancies between documentation and actual codebase state.

**Last Updated:** 2025-12-27
**Status Legend:** 🔴 Critical | 🟡 Medium | 🟢 Low | ✅ Resolved

---

## Active Discrepancies

### 🟡 Old Replit Documents

| Field | Value |
|-------|-------|
| **File Path** | `/home/runner/workspace/docs/melswork/needs-updating/` |
| **Issue** | Contains outdated documentation from Replit era |
| **Reality** | User mentioned "Replit documents are old and not what I wanted this app to become" |
| **Date Found** | 2025-12-27 |
| **Priority** | Medium - may contain incorrect feature claims |

**Notes:**
- User: "put amazing functionality it said was working or coded but never did"
- Need systematic review of all files in this folder
- Compare claimed features vs actual implementation

---

### 🟢 BottomTabNavigation Props

| Field | Value |
|-------|-------|
| **File Path** | `/home/runner/workspace/client/src/components/co-pilot/BottomTabNavigation.tsx` |
| **Issue** | File header comment may reference old prop-based API |
| **Reality** | Now uses React Router hooks (useNavigate, useLocation) |
| **Date Found** | 2025-12-27 |
| **Priority** | Low - component still works correctly |

---

## Resolved Discrepancies

### ✅ Memory Table MCP Tools (2025-12-27)

| Field | Value |
|-------|-------|
| **Issue** | docs/memory/README.md referenced MCP tools that no longer exist |
| **Resolution** | Updated README with REST API endpoints (`/agent/memory/*`), 4 memory tables, and architecture diagram |
| **Session** | Review queue processing |

---

### ✅ CLAUDE.md - Client Structure (2025-12-27)

| Field | Value |
|-------|-------|
| **Issue** | Referenced deleted `co-pilot.tsx` |
| **Resolution** | Already updated with router-based pages, routes.tsx, CoPilotLayout.tsx, co-pilot-context.tsx |
| **Session** | Review queue processing |

---

### ✅ co-pilot.tsx Missing Modern Features (2025-12-27)

| Field | Value |
|-------|-------|
| **Issue** | Branch had old version of co-pilot.tsx |
| **Resolution** | Merged main branch, then refactored to router-based architecture |
| **Session** | Router refactor session |

---

## How to Add New Discrepancies

```markdown
### 🔴/🟡/🟢 [Short Title]

| Field | Value |
|-------|-------|
| **File Path** | `/full/path/to/file.md` |
| **Line(s)** | Line number(s) if applicable |
| **Issue** | What the doc says |
| **Reality** | What the code actually does |
| **Date Found** | YYYY-MM-DD |
| **Session** | Session name/description |
| **Priority** | Critical/Medium/Low |

**Notes:**
- Additional context
- Questions to resolve
```

---

## Files Needing Full Review

These files in `docs/melswork/needs-updating/` need systematic comparison with actual code:

| Subfolder | Contents | Status |
|-----------|----------|--------|
| `architecture/urgent/` | MISMATCHED.md (entry point analysis) | ⏳ Needs review |
| `architecture/ai-ml/` | AI/ML documentation | ⏳ Unknown |
| `architecture/auth/` | Auth system docs | ⏳ Unknown |
| `architecture/guides/` | Setup guides | ⏳ Unknown |
| `architecture/integration/` | Integration docs | ⏳ Unknown |
| `architecture/reports/` | Analysis reports | ⏳ Unknown |
| `architecture/rules/` | Code rules | ⏳ Unknown |
| `architecture/schema/` | Database schema | ⏳ Unknown |
| `architecture/ui/` | UI documentation | ⏳ Unknown |
| `architecture/workflow/` | Workflow docs | ⏳ Unknown |
| `assistant/` | Assistant docs | ⏳ Unknown |
| `eidolon/` | Eidolon SDK docs | ⏳ Unknown |
| `agent/` | Agent docs | ⏳ Unknown |
| `repo/` | Repo structure docs | ⏳ Unknown |

---

## Cross-Reference: Features Claimed vs Implemented

| Feature Claimed | Doc Source | Actually Works? | Notes |
|-----------------|------------|-----------------|-------|
| *Add as discovered* | | | |

---

## Session Notes Reference

All session notes are stored in `/home/runner/workspace/docs/memory/sessions/`
