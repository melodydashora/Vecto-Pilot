# 🧠 Eidolon Assistant Override System - MAXIMUM Enhanced Configuration

## Overview

The Eidolon Assistant Override System provides a **complete replacement** for the standard Replit Assistant with enhanced AI capabilities, unrestricted system access, and persistent memory. This is the **MAXIMUM** configuration with full Atlas fallback chain and unrestricted shell access.

## Architecture

### Three-Layer System

1. **Gateway Proxy Server** (Port 5000)
   - Intercepts ALL assistant requests from Replit IDE
   - Routes through Triad pipeline: Claude Sonnet 4.5 → GPT-5 → Gemini 2.5 Pro
   - Enforces strict invariants (no venue invention, schema validation)
   - Provides enhanced Eidolon SDK capabilities

2. **Agent Operations Server** (Port 43717)
   - Provides operational capabilities (file/shell/SQL access)
   - **UNRESTRICTED shell access** via `AGENT_SHELL_WHITELIST=*`
   - Full database access (DDL/DML)
   - Web search integration via Perplexity

3. **Atlas Fallback Chain**
   - Primary: Claude Sonnet 4.5 (20250929)
   - Fallback 1: GPT-5 (high reasoning)
   - Fallback 2: Gemini 2.5 Pro
   - Ensures operational resilience

## Key Features

### 🔓 Unrestricted Access
- **Wildcard shell execution** (`AGENT_SHELL_WHITELIST=*`)
- **Full file system access** (read/write/delete)
- **Complete database control** (DDL + DML)
- **Root-level configuration** editing

### 🧠 Enhanced Intelligence
- **200K token context window** (Claude Sonnet 4.5)
- **Extended thinking mode** (deep reasoning)
- **Persistent memory** (730 days retention)
- **Cross-session awareness**
- **Semantic search** enabled

### 🔄 Operational Resilience
- **Atlas fallback chain** for continuity
- **Multiple provider support** (Anthropic, OpenAI, Google)
- **Circuit breaker patterns**
- **Graceful degradation**

## Configuration Files

### Core Files
```
.env.example                           # Maximum configuration template
.replit-assistant-override.json       # Assistant override routing config
models-dictionary.json                # Complete model specifications
config/eidolon-policy.json           # Eidolon SDK policy
config/assistant-policy.json         # Assistant capabilities policy
```

### Server Files
```
server/gateway/assistant-proxy.ts     # Gateway proxy with Triad pipeline
server/agent/index.ts                # Agent operations server
```

## Environment Variables (MAXIMUM Config)

### Security Tokens
```bash
AGENT_TOKEN=<64-char-hex>             # Agent server auth token
EIDOLON_TOKEN=<64-char-hex>           # Eidolon SDK auth token
ASSISTANT_OVERRIDE_TOKEN=<64-char-hex> # Assistant override token
GW_KEY=<64-char-hex>                  # Gateway key
```

### API Keys
```bash
ANTHROPIC_API_KEY=<key>               # Claude Sonnet 4.5
OPENAI_API_KEY=<key>                  # GPT-5
GEMINI_API_KEY=<key>                  # Gemini 2.5 Pro
GOOGLE_API_KEY=<key>                  # Google APIs
PERPLEXITY_API_KEY=<key>              # Web research
```

### Model Configuration (Claude Sonnet 4.5 Focused Mode)
```bash
# Claude Sonnet 4.5 - Extended Thinking
CLAUDE_MODEL=claude-sonnet-4-5-20250929
ANTHROPIC_MAX_TOKENS=64000
ANTHROPIC_TEMPERATURE=1.0
ANTHROPIC_THINKING_MODE=extended

# GPT-5 - High Reasoning
OPENAI_MODEL=gpt-5
OPENAI_REASONING_EFFORT=high
OPENAI_MAX_COMPLETION_TOKENS=32000

# Gemini 2.5 Pro - Validation
GEMINI_MODEL=gemini-2.5-pro
GEMINI_MAX_OUTPUT_TOKENS=8192
GEMINI_TEMPERATURE=0.2
```

### Agent Capabilities (UNRESTRICTED)
```bash
AGENT_ALLOW_FS_READ=true
AGENT_ALLOW_FS_WRITE=true
AGENT_ALLOW_FS_DELETE=true
AGENT_ALLOW_SHELL=true
AGENT_SHELL_WHITELIST=*               # ⚠️ UNRESTRICTED
AGENT_ALLOW_SQL_READ=true
AGENT_ALLOW_SQL_WRITE=true
AGENT_ALLOW_SQL_DDL=true
AGENT_ALLOW_HTTP=true
AGENT_ALLOW_WEBSEARCH=true
```

### Atlas Configuration
```bash
ATLAS_MODE=true
AGENT_OVERRIDE_ORDER=anthropic,openai,google
AGENT_OVERRIDE_CLAUDE_MODEL=claude-sonnet-4-5-20250929
AGENT_OVERRIDE_GPT5_MODEL=gpt-5
AGENT_OVERRIDE_GEMINI_MODEL=gemini-2.5-pro
ATLAS_FULL_THREAD_MEMORY=true
ATLAS_UNLIMITED_CONTEXT=true
ATLAS_UI_GOD_MODE=true
ATLAS_CODE_WIZARD=true
ATLAS_FIX_ANYTHING=true
```

### Memory Configuration
```bash
# Eidolon Memory (PostgreSQL-backed)
EIDOLON_MEMORY_BACKEND=postgres
EIDOLON_MEMORY_TABLE=eidolon_memory
EIDOLON_MEMORY_SNAPSHOT_TABLE=eidolon_snapshots
EIDOLON_MEMORY_RETENTION_DAYS=730     # 2 years
EIDOLON_MAX_CONTEXT_TOKENS=200000
EIDOLON_SEMANTIC_MEMORY=true

# Assistant Memory
ASSISTANT_MEMORY_BACKEND=postgres
ASSISTANT_MEMORY_TABLE=assistant_memory
ASSISTANT_MEMORY_TTL_DAYS=730
ASSISTANT_MAX_CONTEXT_TOKENS=200000
ASSISTANT_SEMANTIC_SEARCH=true
```

### Budgets (Extended for Deep Reasoning)
```bash
LLM_TOTAL_BUDGET_MS=120000            # 2 minutes total
CLAUDE_TIMEOUT_MS=20000               # 20s strategist
GPT5_TIMEOUT_MS=60000                 # 60s planner
GEMINI_TIMEOUT_MS=20000               # 20s validator
```

## Running the System

### Start Individual Servers
```bash
# Gateway proxy (Triad pipeline)
npm run gateway:proxy

# Agent operations server
npm run agent:server

# Both in parallel
npm run override:start
```

### Integration with Main Gateway
The main gateway server (`gateway-server.js`) should proxy assistant requests to the override system on port 5000.

## Scripts (package.json)

```json
{
  "gateway:proxy": "tsx server/gateway/assistant-proxy.ts",
  "agent:server": "tsx server/agent/index.ts",
  "override:start": "npm-run-all --parallel gateway:proxy agent:server"
}
```

## Triad Pipeline Flow

```
User Request (Replit IDE)
    ↓
Gateway Proxy (Port 5000)
    ↓
┌─────────────────────────────────────┐
│  TRIAD PIPELINE (Single Path)      │
├─────────────────────────────────────┤
│  1. Claude Sonnet 4.5 (Strategist)  │
│     - Strategic analysis            │
│     - Pro tips generation           │
│     - Earnings estimates            │
│     - Extended thinking             │
│                                     │
│  2. GPT-5 (Planner)                 │
│     - Deep reasoning (high effort)  │
│     - Venue selection worldwide     │
│     - Central staging areas         │
│     - Spatial optimization          │
│                                     │
│  3. Gemini 2.5 Pro (Validator)      │
│     - JSON schema validation        │
│     - Venue enrichment              │
│     - Data normalization            │
│     - 6 venues minimum              │
└─────────────────────────────────────┘
    ↓
Response to User
```

## Atlas Fallback Chain

```
Primary Request
    ↓
Claude Sonnet 4.5 (200K context, extended thinking)
    ↓ (if fails)
GPT-5 (high reasoning effort)
    ↓ (if fails)
Gemini 2.5 Pro (structured output)
```

## Operational Verbs (Agent Server)

The agent server exposes these operational endpoints:

- **`POST /op/fs.read`** - Read files
- **`POST /op/fs.write`** - Write files
- **`POST /op/shell.exec`** - Execute shell commands (unrestricted)
- **`POST /op/sql.query`** - Execute SQL queries

All require Bearer token authentication (`AGENT_TOKEN`).

## Policy Invariants

### Eidolon Policy
```json
{
  "invariants": {
    "no_venue_invention": true,      // Never invent venues
    "schema_strict": true,            // Enforce JSON schema
    "word_caps": true                 // Word capitalization
  }
}
```

### Assistant Policy
```json
{
  "identity_assertion": true,
  "full_access": true,
  "unrestricted_shell": true,
  "atlas_available": true,
  "allow_ops": [
    "fs.read", "fs.write", "fs.delete",
    "shell.exec", "sql.query",
    "http.fetch", "web.search"
  ]
}
```

## Security Considerations

### ⚠️ CRITICAL WARNINGS

1. **Unrestricted Shell Access**
   - `AGENT_SHELL_WHITELIST=*` allows ANY command execution
   - Only use in trusted development environments
   - NEVER expose to untrusted users

2. **Full Database Access**
   - Agent can execute DDL (CREATE, DROP, ALTER)
   - Use with extreme caution in production
   - Consider read-only mode for production

3. **Token Security**
   - Generate strong 64-char tokens: `openssl rand -hex 32`
   - Never commit tokens to version control
   - Rotate tokens regularly

### Recommended Production Config

For production, consider restricting:
```bash
# Whitelist specific commands only
AGENT_SHELL_WHITELIST=ls,cat,npm,node,git,psql

# Disable DDL in production
AGENT_ALLOW_SQL_DDL=false

# Limit file operations
AGENT_ALLOW_FS_DELETE=false
```

## Capabilities Comparison

| Feature | Standard Assistant | Eidolon Enhanced (MAX) |
|---------|-------------------|------------------------|
| Context Window | ~8K tokens | 200K tokens |
| Memory | Session-only | 730 days persistent |
| File Access | Limited | Unrestricted (root) |
| Shell Access | None | Unrestricted (*) |
| Database Access | None | Full DDL/DML |
| Internet Access | None | Perplexity Research |
| Thinking Mode | Basic | Extended |
| Fallback Chain | None | 3-tier (Atlas) |
| Cross-Session | No | Yes |

## Model Specifications

See `models-dictionary.json` for complete specifications:

- **Claude Sonnet 4.5 (20250929)**: Strategist, Agent, Eidolon, Assistant
- **GPT-5**: Planner (high reasoning)
- **Gemini 2.5 Pro**: Validator
- **Perplexity Sonar Pro**: Web research

## Verification & Testing

### Verify Model Availability
```bash
npm run model:verify
```

### Test Override System
```bash
# Start override system
npm run override:start

# In another terminal, test gateway
curl -X POST http://localhost:5000/assistant/test \
  -H "Authorization: Bearer ${EIDOLON_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}'
```

## Troubleshooting

### Port Already in Use
If port 5000 is in use, the main gateway is already running. This is expected when the workflow is active.

### TypeScript Compilation Errors
Ensure `tsx` is installed:
```bash
npm install --save-dev tsx
```

### Missing API Keys
Check `.env` file has all required keys:
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `PERPLEXITY_API_KEY` (optional)

### Agent Server Not Responding
Verify token authentication:
```bash
curl -X POST http://localhost:43717/op/fs.read \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"path":"package.json"}'
```

## Documentation References

- **Architecture**: `ARCHITECTUREV2.md` (comprehensive system design)
- **Architecture PDF**: `ARCHITECTUREV2.pdf` (professional formatted)
- **Models**: `models-dictionary.json` (all model specs)
- **Memory**: `replit.md` (project context and preferences)

## Version History

- **v7.0.0-ultimate-max**: MAXIMUM enhanced configuration
  - Unrestricted shell access (`*` whitelist)
  - Atlas fallback chain enabled
  - Claude Sonnet 4.5 (20250929) focused mode
  - Extended thinking mode
  - 200K context window
  - 730-day memory retention
  - Full root access capabilities

## Credits

- **Eidolon Enhanced SDK** - Complete assistant replacement
- **Vecto Pilot™** - Strategic rideshare assistance platform
- **Models**: Claude Sonnet 4.5, GPT-5, Gemini 2.5 Pro, Perplexity Sonar Pro
