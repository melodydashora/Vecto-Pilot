> **Last Verified:** 2026-04-08

# Scripts (`scripts/`)

## Purpose

Build, development, and operational utility scripts.

## Key Scripts

| Script | Purpose |
|--------|---------|
| `start-replit.js` | Replit-specific startup script |
| `seed-dev.js` | Seed development database |
| `prebuild-check.js` | Pre-build validation |
| `make-jwks.mjs` | Generate JWKS for JWT auth |
| `sign-token.mjs` | Sign JWT tokens |
| `create-all-tables.sql` | Database table creation SQL |
| `populate-market-data.js` | Populate market data |
| `import-platform-data.js` | Import platform data |
| `load-market-research.js` | Load market research data from files |
| `memory-cli.mjs` | CLI for memory system operations |
| `ask-gemini.mjs` | **Claude Code ↔ Gemini 3.1 Pro CLI bridge** (2026-04-08) |
| `seed-market-intelligence.js` | Seed market intelligence data |
| `analyze-data-flow.js` | Analyze application data flow |
| `generate-schema-docs.js` | Generate schema documentation |
| `generate-schema-docs.sh` | Schema docs generation shell script |
| `resolve-venue-addresses.js` | Resolve venue addresses via geocoding |
| `test-event-dedup.js` | Test event deduplication logic |
| `test-news-fetch.js` | Test news fetching functionality |
| `import-market-cities.js` | **Import market cities from JSON/CSV** (2026-02-01) |
| `fix-market-names.js` | Fix market name mismatches from research file |

## Claude Code ↔ Gemini Bridge

### ask-gemini.mjs (2026-04-08)

A one-shot / multi-turn CLI that lets **Claude Code** delegate tasks to **Gemini 3.1 Pro Preview** from the terminal. Claude Code calls it via its Bash tool and reads Gemini's reply from stdout.

**Why this exists.** Gemini 3.1 Pro has capabilities Claude Code's in-session toolset lacks:
- 1M-token input context (for whole-file or whole-directory analysis)
- Native Google Search grounding (live web knowledge beyond the training cutoff)
- Vision / multimodal input
- A true second opinion from a different model family

**Important:** this script calls `@google/genai` directly, **not** via `server/lib/ai/adapters/gemini-adapter.js`. The adapter auto-forces `responseMimeType='application/json'` whenever the word "json" appears in a prompt — fine for role-based in-app calls, but lethal for a conversational CLI. Direct SDK use gives deterministic mime-type control while reusing the same API key, safety settings, and thinking-level rules.

**Defaults** (tuned for Claude Code's delegation workflow):
- Model: `gemini-3.1-pro-preview`
- Thinking: `high` (Pro supports `low` / `high` only — `medium` is Flash-only)
- Google Search: **on** (disable with `--no-search`)
- Git diff: `git diff HEAD` auto-attached on first turn of a thread (disable with `--no-diff`)
- Max tokens: 8192
- Threads stored in `.gemini-threads/` (gitignored)

**Basic use:**
```bash
# One-shot question (Google Search enabled by default)
node scripts/ask-gemini.mjs "What's the current TomTom Traffic API v4 rate limit?"

# Give Gemini a file as context
node scripts/ask-gemini.mjs --file server/lib/ai/unified-ai-capabilities.js \
  "List every silent-failure pattern you see and rank by severity"

# Multi-turn conversation
node scripts/ask-gemini.mjs --thread refactor-auth "What's wrong with this approach?"
node scripts/ask-gemini.mjs --thread refactor-auth "OK, now how would you test it?"

# Cheap + fast classification (use Flash)
node scripts/ask-gemini.mjs --model gemini-3-flash-preview --think low --no-search \
  "Bug or feature? $(cat some-issue.txt)"

# Meta commands
node scripts/ask-gemini.mjs --list              # show all threads
node scripts/ask-gemini.mjs --show refactor-auth # print a thread's history
node scripts/ask-gemini.mjs --reset refactor-auth # delete a thread

# Full help
node scripts/ask-gemini.mjs --help
```

**Vision — screenshots of the app (2026-04-08):**
```bash
# Ask Gemini about a single screenshot
node scripts/ask-gemini.mjs --image ~/Desktop/dashboard.png \
  "What looks visually off in this dashboard? Focus on spacing, alignment, and color contrast."

# Before/after comparison
node scripts/ask-gemini.mjs --image before.png --image after.png \
  "Compare these two screenshots and list every visual change."

# Combine a screenshot with a code file for full context
node scripts/ask-gemini.mjs --image settings-page.png \
  --file client/src/pages/settings.tsx \
  "The designer says this doesn't match the mock. What's different between what's rendered and what the component should produce?"

# Thread mode: first turn attaches the image, later turns reference it in prose
node scripts/ask-gemini.mjs --thread ux-review --image schedule.png \
  "First pass — list everything you notice about this schedule view."
node scripts/ask-gemini.mjs --thread ux-review \
  "You mentioned the empty state. How would you redesign it?"   # no --image needed
```

**Vision limits and behavior:**
- Supported formats: `.png`, `.jpg/.jpeg`, `.webp`, `.gif`, `.heic`, `.heif`
- Hard cap: **15MB per image** (Gemini's inline data limit is ~20MB total request)
- Soft warning at 5MB — consider downscaling high-res retina screenshots
- In thread mode, an image is visible to Gemini **only on the turn it's attached**. Thread history files note the attachment by filename + size but don't store the base64 bytes (would bloat thread files to megabytes).
- Re-attach images on follow-up turns if you need Gemini to look at them again; otherwise let the prose history carry the context.

**Requires:** `GEMINI_API_KEY` in the environment.

**Design notes for future maintainers:**
- Thread history is appended as plain text into the user message (not Gemini's native multi-turn `contents[]`). This keeps debugging trivial — the exact prompt that was sent is visible in one place — and Gemini's 1M context makes the overhead negligible.
- Diagnostic output (`🤖 Calling...`, timing, thread save confirmation) goes to **stderr** so stdout stays pipe-clean with just Gemini's reply.
- No silent fallbacks: any API error, empty response, or I/O failure exits non-zero with a diagnostic. Matches repo-wide anti-silent-failure rule.

## Market Data Scripts

### import-market-cities.js (2026-02-01)

Import/update `market_cities` table (2026-02-17: renamed from `us_market_cities`, now with `market_slug` FK to `markets`) from JSON or CSV files with field names that match the schema exactly.

```bash
# Preview changes (dry run)
node scripts/import-market-cities.js path/to/markets.json --dry-run

# Import from JSON
node scripts/import-market-cities.js path/to/markets.json

# Import from CSV with updates
node scripts/import-market-cities.js path/to/markets.csv --upsert
```

**Supported formats:**
- **JSON**: See `platform-data/uber/research-findings/market-template.json` for template
- **CSV**: Header row with: `state_abbr,state,city,market_name,region_type`

### fix-market-names.js

One-time script to update market names from the legacy research-intel.txt format (CSV with `State,City,Market_Anchor,Region_Type`).

```bash
node scripts/fix-market-names.js
```

## Usage

Most scripts are run via npm:

```bash
npm run dev        # Development server
npm run build      # Production build
npm run db:push    # Push schema changes
npm run seed:dev   # Seed development data
```

## Connections

- **Called by:** `package.json` scripts
- **Related:** `server/scripts/` for server-specific scripts
