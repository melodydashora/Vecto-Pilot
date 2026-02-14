# IDE Tools for Vecto Pilot

This document describes the powerful IDE tools available for development with **Replit IDE + Claude Opus 4.5**.

---

## Overview

Vecto Pilot is configured with a comprehensive AI-enhanced development environment:

| Tool | Purpose | Status |
|------|---------|--------|
| **Claude Opus 4.5** | Primary AI assistant | ✅ Enabled |
| **Extended Thinking** | 10k token reasoning budget | ✅ Enabled |
| **Web Search** | Real-time web search | ✅ Enabled |
| **Web Fetch** | Fetch and analyze URLs | ✅ Enabled |
| **Shell Execution** | Full bash access | ✅ Enabled |
| **Computer Use** | Screenshot and UI interaction | ✅ Enabled |
| **Code Execution** | Run code in sandbox | ✅ Enabled |
| **SQL Access** | Direct database queries | ✅ Enabled |

---

## Replit Workflows

Quick-access workflows available via Replit's workflow picker:

### Development
| Workflow | Action |
|----------|--------|
| **Run App** | Start development server |
| **TypeCheck** | Check TypeScript types |
| **Lint** | Run ESLint on client + server |
| **Format** | Format code with Prettier |

### Testing
| Workflow | Action |
|----------|--------|
| **Test: Unit** | Run Jest unit tests |
| **Test: E2E** | Run Playwright E2E tests |
| **Test: All** | Run all tests |

### Build
| Workflow | Action |
|----------|--------|
| **Build: Client** | Build frontend only |
| **Build: Production** | Full production build |
| **Pre-PR: Full Validation** | lint → typecheck → build |

### Database
| Workflow | Action |
|----------|--------|
| **DB: Push Schema** | Push schema changes |
| **DB: Migrate** | Run migrations |
| **DB: Studio** | Open Drizzle Studio |

---

## Claude Code Plugins

8 plugins enabled for enhanced capabilities:

| Plugin | Purpose |
|--------|---------|
| **context7** | Enhanced context awareness |
| **github** | GitHub integration (PRs, issues) |
| **atlassian** | Jira/Confluence integration |
| **frontend-design** | UI/UX design assistance |
| **pr-review-toolkit** | Code review automation |
| **gitlab** | GitLab integration |
| **code-review** | Code quality analysis |
| **serena** | TypeScript LSP integration |

---

## Claude Agents

Specialized agents for specific tasks (invoke via Task tool):

### `docs-sync`
**Purpose**: Keep documentation synchronized with code changes
**Use When**: After implementing features, fixing bugs, or modifying APIs
**Model**: Opus (high quality)

### `db-explorer`
**Purpose**: Explore database schema, query data, analyze relationships
**Use When**: Debugging data issues, understanding data model
**Model**: Haiku (fast)

### `api-tester`
**Purpose**: Test API endpoints, validate responses, debug HTTP issues
**Use When**: Testing new endpoints, debugging API errors
**Model**: Haiku (fast)

### `perf-analyzer`
**Purpose**: Analyze performance, identify bottlenecks, optimize
**Use When**: Slow endpoints, memory issues, bundle size problems
**Model**: Sonnet (balanced)

---

## Hooks

Automated hooks for quality assurance:

### `pre-commit.sh`
Runs before commits:
- ✅ TypeScript type check
- ✅ ESLint validation
- ⚠️ Console.log detection (warning)
- ⚠️ TODO/FIXME detection (warning)
- ❌ Secrets detection (blocks commit)

### `session-start.sh`
Runs at session start:
- Git status summary
- Review queue check
- Recent commits display
- Key reminders
- Quick command reference

---

## Assistant Configuration

The Replit Assistant is configured with Claude Opus 4.5:

```toml
[assistant]
model = "claude-opus-4-5-20251101"
web_search = true
web_fetch = true
shell_exec = true
```

### Extended Capabilities (via .replit-assistant-override.json)

| Capability | Status |
|------------|--------|
| Extended Thinking | ✅ 10k token budget |
| Context Window | ✅ 200k tokens |
| Max Tokens | ✅ 64k output |
| Web Search | ✅ 10 uses/session |
| Web Fetch | ✅ 5 uses/session |
| Computer Use | ✅ 1920x1080 |
| Self-Healing | ✅ Auto-recovery enabled |
| Autonomous Mode | ✅ Full access |

---

## System Packages (via replit.nix)

Development tools installed at system level:

### Core
- Node.js 22, PostgreSQL 16, Python 3.11

### Build Tools
- TypeScript, pnpm

### Database
- pgcli (PostgreSQL CLI with autocomplete)

### Development
- jq (JSON processor)
- ripgrep (fast search)
- fd (fast file finder)
- fzf (fuzzy finder)
- bat (better cat)
- delta (better git diff)

### Playwright Dependencies
- Chromium and all required X11 libraries

---

## Quick Reference

### NPM Scripts
```bash
npm run dev           # Start dev server
npm run typecheck     # TypeScript check
npm run lint          # ESLint (client + server)
npm run format        # Prettier format
npm run test          # All tests
npm run guard         # All QA checks
npm run build         # Production build
```

### Claude Code Permissions
189 pre-approved operations including:
- File system: read, write, delete, create, rename
- Shell: exec, spawn, kill
- SQL: query, execute, DDL, DML
- HTTP: fetch, post, put, delete
- Web: search, fetch, research
- IDE: modify, config, workspace, debug

---

## Best Practices

### For Maximum Productivity

1. **Use Workflows**: Access via Replit's workflow picker for one-click operations
2. **Trust Extended Thinking**: Claude uses 10k tokens for reasoning before responding
3. **Leverage Agents**: Use specialized agents for focused tasks
4. **Check Hooks Output**: Review pre-commit and session-start output
5. **Use Web Search**: Claude can search the web for current information

### For Code Quality

1. **Run Pre-PR Validation**: Always run before creating PRs
2. **Check TypeScript**: Types catch bugs early
3. **Format on Save**: Prettier keeps code consistent
4. **Review TODOs**: Don't let them accumulate

---

## Troubleshooting

### Assistant Not Working
1. Check `.replit-assistant-override.json` is valid JSON
2. Verify model is set to `claude-opus-4-5-20251101`
3. Restart the Repl

### Workflows Not Showing
1. Check `.replit` file syntax
2. Ensure `[workflows]` section is properly formatted
3. Refresh Replit workspace

### Hooks Not Running
1. Verify hooks are executable: `chmod +x .claude/hooks/*.sh`
2. Check hook file paths
3. Review hook output for errors

---

*Last updated: 2026-02-14*
