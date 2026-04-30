Looking at the code changes in `server/config/env-registry.js` and comparing them to the current documentation, I need to analyze what's new or changed.

**Code Analysis:**
1. The env-registry defines all environment variables with their defaults and descriptions
2. Key environment variables documented include:
   - `REPLIT_AUTOSCALE` - for Replit native autoscale detection (comment dated 2026-02-25)
   - `ENABLE_BACKGROUND_WORKER` - default 'false', for background strategy worker
   - `FAST_BOOT` - skip cache warmup
   - All the strategy model configs with their defaults
   - Database pool settings (`PG_MAX`, `PG_MIN`, `PG_IDLE_TIMEOUT_MS`)
   - Timeout settings (`TRIAD_TIMEOUT_MS`, `PLANNER_DEADLINE_MS`, `BRIEFING_TIMEOUT_MS`)

**Documentation Analysis:**
The current documentation already covers:
- Strategy model configuration (Strategist, Briefer, Consolidator, Event Validator, Venue Planner) ✓
- Deployment flags (REPLIT_AUTOSCALE, CLOUD_RUN_AUTOSCALE, ENABLE_BACKGROUND_WORKER, FAST_BOOT) ✓

**Missing from documentation:**
1. Database pool configuration environment variables
2. Timeout configuration environment variables
3. Voice model configuration
4. External API keys (TOMTOM_API_KEY, PERPLEXITY_API_KEY)
5. Auth variables (JWT_SECRET, AGENT_TOKEN)

The documentation should be updated to include these additional environment variable categories:


## Model Parameters

### Claude Opus 4.6 (Agent Identity)

**Configuration:**
- **Identity:** `agent`
- **Announce:** `🧠 Agent (Claude Opus 4.6 Enhanced) - Extended thinking with all tools enabled.`
- **Model:** `claude-opus-4-6`
- **Context Window:** 200,000 tokens
- **Max Output:** 16,000 tokens
- **Thinking:** Enabled (Budget: 10,000 tokens)
- **Temperature:** 0.7
- **Mode:** Single Path

**Required Headers:**
- `anthropic-version`: `2023-06-01`
- `anthropic-beta`: `interleaved-thinking-2025-05-14`, `code-execution-2025-08-25`, `fine-grained-tool-streaming-2025-05-14`

**Tools & Capabilities:**
- Web Search & Fetch (2025-03-05)
- Code Execution (2025-08-25)
- Text Editor & Bash (2025-01-24)
- Computer Use (2025-01-24)
- **Allowed Ops:** Full filesystem, shell, SQL, HTTP, web, code, IDE, process, system, memory, and computer use operations.

**Memory & State:**
- **Backend:** Postgres (`agent_memory` and `agent_snapshots` tables)
- **TTL:** 730 days

**Research Integration:**
- **Provider:** Gemini (`gemini-3.1-pro-preview`)
- **Grounding:** Enabled

**Invariants & Budgets:**
- **Invariants:** No venue invention, strict schema, word caps, require JSON output, require exact model IDs, GPT-5 reasoning effort set to "high".
- **Budgets (ms):** Total: 360,000 | Claude: 45,000 | GPT-5: 120,000 | Gemini: 60,000

**Flags:**
- Atlas enabled, thinking enabled, all tools enabled, autonomous mode, self-healing, circuit breaker, unified routing, unrestricted shell, full access, no fallbacks.

**Startup & UI:**
- **Required Env Vars:** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`
- **UI:** Show Research Banner (`true`), Show Thinking Indicator (`true`)

### Triad Configuration

**Strategist (Claude Opus):**
- **Default Model:** `claude-opus-4-6`
- **Env Var:** `STRATEGY_STRATEGIST`
- **Role:** High-level planning and reasoning.

**Briefer (Gemini):**
- **Default Model:** `gemini-3.1-pro-preview`
- **Env Var:** `STRATEGY_BRIEFER`
- **Auth:** `GEMINI_API_KEY`

**Consolidator (OpenAI):**
- **Provider:** OpenAI (GPT-5 family — chat/reasoning class).
- **Env Var:** `STRATEGY_CONSOLIDATOR`
- **Active model assignment:** `server/lib/ai/model-registry.js` (single source of truth — this doc intentionally does NOT hardcode the version per Rule 14).
- **Role:** Synthesis and final output generation.

**Event Validator (Claude Opus):**
- **Default Model:** `claude-opus-4-6`
- **Env Var:** `STRATEGY_EVENT_VALIDATOR`
- **Role:** Event validation (with web search).

**Venue Planner (OpenAI):**
- **Provider:** OpenAI (GPT-5 family — chat/reasoning class).
- **Env Var:** `STRATEGY_VENUE_PLANNER`
- **Active model assignment:** `server/lib/ai/model-registry.js` (single source of truth).
- **Role:** Venue planning.

**Agent Policy Budgets & Tokens:**
- **Timeouts:** Claude (45s), Planner (120s), Gemini (60s)
- **Max Tokens:** Claude (64k), GPT-5 (32k), Gemini (8k)

### Voice Configuration

**Voice Model:**
- **Provider:** OpenAI Realtime API (must be a realtime-class model — chat-class models like `gpt-5.x` will fail against `/v1/realtime/sessions`).
- **Env Var:** `VOICE_MODEL`
- **Active model assignment:** `server/config/env-registry.js` (`VOICE_MODEL` default) and `server/api/chat/realtime.js`.
- **Role:** Real-time voice-to-voice for the Rideshare Coach (separate model class from text/reasoning paths — do not collapse).

### Holiday Detector

**Configuration:**
- **Model:** `callModel` Adapter (Hedged Router + Fallback)
- **Role:** `BRIEFING_HOLIDAY`
- **Tools:** Google Search
- **Overrides:** `holiday-override.json`

**Caching:**
- **Type:** L1 In-memory (24h TTL)
- **Key Strategy:** Strict Timezone-aware local date (YYYY-MM-DD) & Location Context (City, State) - No Fallbacks

### Location & Time Standards

**Canonical Utility:** `getSnapshotTimeContext`
- **Invariant:** Single source of truth for "today's date" and timezone.
- **Validation:** Strict (No Fallbacks).
  - **Timezone:** Throws `MissingTimezoneError` on failure.
  - **Location:** Throws `MissingLocationError` (requires City/State).
- **Local Time:** Derived from `local_iso` (Wall-clock UTC) to prevent double-conversion.

### Environment & Credentials

**GCP Service Account:**
- **Reconstruction:** Automatically generates `GOOGLE_APPLICATION_CREDENTIALS` JSON at `/tmp/gcp-credentials.json` from individual environment variables.
- **Required Vars:** `type`, `project_id`, `private_key`, `client_email`.
- **Project Context:** Auto-sets `GOOGLE_CLOUD_PROJECT` from `GOOGLE_CLOUD_PROJECT_ID` if missing.
- **Purpose:** Enables Vertex AI and Google Cloud SDK authentication (Replit-compatible).

**Database Pool Settings:**
- **`PG_MAX`:** Max pool connections (Default: `10`).
- **`PG_MIN`:** Min pool connections (Default: `2`).
- **`PG_IDLE_TIMEOUT_MS`:** Idle connection timeout (Default: `30000`).

**Timeout Configuration:**
- **`TRIAD_TIMEOUT_MS`:** TRIAD pipeline timeout (Default: `50000`).
- **`PLANNER_DEADLINE_MS`:** Venue planner deadline (Default: `30000`).
- **`BRIEFING_TIMEOUT_MS`:** Briefing generation timeout (Default: `15000`).

**External API Keys (Optional):**
- **`TOMTOM_API_KEY`:** TomTom Traffic API key.
- **`PERPLEXITY_API_KEY`:** Perplexity API key (holiday detection).

**Auth Variables:**
- **`JWT_SECRET`:** JWT signing secret (dev fallback available).
- **`AGENT_TOKEN`:** Bearer token for agent server endpoints.

**Deployment Flags:**
- **Autoscale:** `REPLIT_AUTOSCALE` (Replit native) or `CLOUD_RUN_AUTOSCALE` (GCP).
- **Background Worker:** `ENABLE_BACKGROUND_WORKER` (Default: `false`).
- **Fast Boot:** `FAST_BOOT` (Skip cache warmup).

**Environment Loading:**
- **File:** `.env` (parsed with `${VAR}` substitution).
- **Precedence:** Process environment variables (e.g., Replit Secrets) override `.env` file values.
- **Registry:** All environment variables are defined in `server/config/env-registry.js` as single source of truth.