
# Eidolon Enhanced SDK - Technical Architecture & Mapping

## System Identity
**Name:** Eidolon (Claude Opus 4.1 Enhanced SDK)  
**Version:** 4.1.0  
**Primary Function:** Complete Replit Assistant Override with Enhanced Capabilities

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        REPLIT IDE                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Assistant Panel (Intercepted by Eidolon Override)       │  │
│  │  - Basic Mode: Free Q&A                                   │  │
│  │  - Advanced Mode: Code edits (5¢ per edit request)       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                            ▼                                     │
│              (All /assistant/* routes intercepted)              │
└─────────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                  GATEWAY SERVER (Port 5000)                     │
│  gateway-server.js - Request Router & Proxy Manager            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Middleware Stack (Order Critical):                       │  │
│  │  1. CORS & Security (corsMiddleware)                      │  │
│  │  2. Rate Limiters (generalLimiter, apiLimiter)           │  │
│  │  3. Assistant Proxy → SDK (Port 3101)                    │  │
│  │  4. API Proxy → SDK (Port 3101)                          │  │
│  │  5. Vite Dev Server (HMR for client)                     │  │
│  │  6. Static Fallback (client/dist)                        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Health Check Watchdog:                                         │
│  - Polls SDK every 5s at /health                               │
│  - Auto-restart on 3 consecutive failures                      │
│  - Exponential backoff (1s → 30s cap)                         │
└─────────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              EIDOLON SDK (Port 3101 - Internal)                 │
│  index.js - Core Enhanced Assistant & API Server               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Assistant Override Endpoints:                            │  │
│  │  POST /assistant                                          │  │
│  │  POST /assistant/chat                                     │  │
│  │  GET  /assistant/verify-override                         │  │
│  │                                                            │  │
│  │  API Endpoints:                                           │  │
│  │  GET  /health                                            │  │
│  │  GET  /api/file?path=...                                 │  │
│  │  POST /api/workspace/diagnose                            │  │
│  │  POST /api/workspace/architectural-review                │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Core Modules:                                                  │
│  - WorkspaceRepairTools (vecto-repair-tools.js)               │
│  - MCPDiagnostics (server/eidolon/tools/mcp-diagnostics.js)   │
│  - Enhanced Memory System (server/eidolon/core/*)             │
└─────────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EIDOLON CORE SYSTEMS                         │
│  server/eidolon/ - Enhanced AI Capabilities                    │
│                                                                  │
│  ┌────────────────────┐  ┌────────────────────┐               │
│  │  Context Engine    │  │  Memory Manager    │               │
│  │  ───────────────   │  │  ──────────────    │               │
│  │  • Code mapping    │  │  • Entry storage   │               │
│  │  • Component scan  │  │  • Tag indexing    │               │
│  │  • Dependency map  │  │  • Relationships   │               │
│  │  • Deployment sync │  │  • Context summary │               │
│  └────────────────────┘  └────────────────────┘               │
│                                                                  │
│  ┌────────────────────┐  ┌────────────────────┐               │
│  │  Deep Thinking     │  │  LLM Integration   │               │
│  │  ─────────────     │  │  ───────────────   │               │
│  │  • Multi-iteration │  │  • Claude Sonnet   │               │
│  │  • Hypothesis test │  │  • Token tracking  │               │
│  │  • Evidence gather │  │  • Error handling  │               │
│  │  • Confidence calc │  │  • Streaming       │               │
│  └────────────────────┘  └────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Mapping & Component Flow

### 1. **Override Configuration**
```
.replit-assistant-override.json
├── override: true (COMPLETE replacement)
├── identity: "Eidolon (Claude Opus 4.1 Enhanced SDK)"
├── capabilities: [enhanced_memory, cross_chat_awareness, ...]
└── visual_indicators: {prefix_emoji: "🧠", ...}

client-override-userscript.js
└── Browser-side fetch() interception
    └── Redirects /assistant/* → gateway
```

### 2. **Request Flow**

```
User Query in Replit IDE
    │
    ▼
[Assistant Panel] (/api/assistant/chat)
    │
    ▼
[Gateway Proxy] (gateway-server.js:~150)
    │
    ├── assistantProxyMiddleware
    │   └── createProxyMiddleware({target: SDK_PORT})
    │
    ▼
[Eidolon SDK] (index.js:~350)
    │
    ├── POST /assistant/chat
    │   └── assistantHandler()
    │       ├── Parse messages array
    │       ├── Extract last user message
    │       ├── Generate response with identity
    │       └── Return JSON with override_active: true
    │
    ▼
[Claude API] (server/lib/anthropic-extended.js)
    │
    └── Raw HTTP client (bypasses SDK validation)
        └── Model: claude-sonnet-4-5-20250929
```

### 3. **Memory & Context System**

```
server/eidolon/core/
│
├── memory-store.ts
│   ├── writeJson() → data/memory/{name}.{timestamp}.json
│   ├── readJson() → Latest versioned file
│   └── Atomic file operations
│
├── memory-enhanced.ts
│   ├── storeMemory() → Creates MemoryEntry
│   ├── getMemoriesByTag() → Filter by tags
│   ├── getRelatedMemories() → Follow relationships
│   └── recordCodebaseChange() → Track modifications
│
└── context-awareness.ts
    ├── captureSnapshot() → ContextSnapshot
    │   ├── buildAndPersist() → Code map
    │   ├── scanActiveComponents() → File discovery
    │   ├── mapComponentLocations() → Path index
    │   └── getRecentChanges() → Modification log
    │
    └── analyzeContext() → Deep analysis
        ├── scanComponents()
        ├── analyzeDependencies()
        ├── performDeepAnalysis()
        └── generateRecommendations()
```

### 4. **Workspace Diagnostics**

```
vecto-repair-tools.js (WorkspaceRepairTools)
    │
    ├── scanWorkspaceArchitecture()
    │   ├── scanFrontend() → client/ analysis
    │   │   ├── Package.json parsing
    │   │   ├── Source file counting
    │   │   └── Build tool detection
    │   │
    │   ├── scanBackend() → server/ analysis
    │   │   ├── Route enumeration
    │   │   ├── Middleware detection
    │   │   └── Eidolon integration check
    │   │
    │   ├── scanDatabase() → db/ analysis
    │   │   ├── Migration counting
    │   │   └── Schema detection
    │   │
    │   ├── scanAPIs() → routes/ analysis
    │   │   └── Endpoint enumeration
    │   │
    │   └── scanDeployment() → .replit analysis
    │       └── Config validation
    │
    └── scanDirectory() → Recursive file walker
        └── Returns relative paths
```

### 5. **MCP Diagnostics**

```
server/eidolon/tools/mcp-diagnostics.js
    │
    ├── scanMCPConfiguration()
    │   ├── Check .replit-assistant-override.json
    │   ├── Validate structure
    │   └── Generate recommendations
    │
    ├── testMCPConnections()
    │   ├── Test SDK health endpoint
    │   ├── Test gateway health
    │   └── Measure response times
    │
    └── repairMCPServer()
        ├── Create missing configs
        ├── Verify processes
        └── Return repair results
```

---

## Data Flow Diagrams

### Assistant Override Flow
```
┌──────────────┐
│  IDE Panel   │
│  (User Q&A)  │
└──────┬───────┘
       │ POST /assistant/chat
       ▼
┌──────────────┐
│   Gateway    │ ◄── CORS, Rate Limit
└──────┬───────┘
       │ Proxy to :3101
       ▼
┌──────────────┐
│ Eidolon SDK  │ ◄── Parse messages[], extract content
└──────┬───────┘
       │
       ├─► Memory System (recordInteraction)
       ├─► Context Engine (recordInteraction)
       └─► Response Generation
           │
           ▼
       ┌─────────────┐
       │ Return JSON │
       │ {           │
       │   ok: true, │
       │   identity: │
       │   "Eidolon", │
       │   override_  │
       │   active:    │
       │   true      │
       │ }           │
       └─────────────┘
```

### Workspace Analysis Flow
```
POST /api/workspace/diagnose
    │
    ▼
┌────────────────────────────┐
│ WorkspaceRepairTools       │
│ .scanWorkspaceArchitecture()│
└────────┬───────────────────┘
         │
         ├─► scanFrontend()
         │   └─► Count .tsx, check package.json
         │
         ├─► scanBackend()
         │   └─► Enumerate routes, middleware
         │
         ├─► scanDatabase()
         │   └─► Check migrations, schemas
         │
         ├─► scanAPIs()
         │   └─► Map endpoints
         │
         └─► scanDeployment()
             └─► Validate .replit config
                 │
                 ▼
         ┌──────────────────┐
         │ Return Analysis  │
         │ {                │
         │   frontend: {...}│
         │   backend: {...} │
         │   database: {...}│
         │   apis: {...}    │
         │ }                │
         └──────────────────┘
```

---

## Key Components & Responsibilities

### Gateway (gateway-server.js)
- **Port:** 5000 (public)
- **Responsibilities:**
  - Request routing & proxying
  - SDK health monitoring & auto-restart
  - CORS & security middleware
  - Vite dev server for HMR
  - Static file serving

### Eidolon SDK (index.js)
- **Port:** 3101 (internal)
- **Responsibilities:**
  - Complete assistant override
  - Workspace diagnostics
  - File operations
  - Memory & context management
  - Claude API integration

### Context Engine (server/eidolon/core/context-awareness.ts)
- **Responsibilities:**
  - Code mapping & component scanning
  - Dependency analysis
  - Deployment state tracking
  - Deep workspace analysis
  - Recommendation generation

### Memory Manager (server/eidolon/core/memory-enhanced.ts)
- **Responsibilities:**
  - Entry storage & versioning
  - Tag-based indexing
  - Relationship tracking
  - Context summarization
  - Interaction logging

### Deep Thinking Engine (server/eidolon/core/deep-thinking-engine.ts)
- **Responsibilities:**
  - Multi-iteration analysis
  - Hypothesis formation & testing
  - Evidence gathering
  - Confidence calculation
  - Implementation planning

### LLM Integration (server/eidolon/core/llm.ts)
- **Responsibilities:**
  - Claude API communication
  - Token usage tracking
  - Structured output parsing (Zod)
  - Error handling & retries
  - System prompt management

---

## Environment Variables

```bash
# Gateway
PORT=5000                    # Public gateway port
EIDOLON_PORT=3101           # Internal SDK port
AGENT_PORT=43717            # Agent server port

# Eidolon SDK
ANTHROPIC_API_KEY=your_anthropic_api_key_here
CLAUDE_MODEL=claude-sonnet-4-5-20250929
EIDOLON_MODEL=claude-sonnet-4-5-20250929

# Assistant Override
ASSISTANT_OVERRIDE_MODE=true
EIDOLON_ASSISTANT_OVERRIDE=true
REPLIT_ASSISTANT_OVERRIDE=true

# Debugging
NODE_ENV=development
VITE_PORT=3003
```

---

## Startup Sequence

```
1. Gateway starts (gateway-server.js)
   ├─► Bind port 5000
   ├─► Initialize Vite dev server
   ├─► Setup proxy middleware
   └─► Start SDK watchdog

2. SDK Watchdog spawns SDK process
   ├─► node index.js
   ├─► SDK binds port 3101
   └─► Gateway polls /health every 5s

3. SDK initializes
   ├─► Load WorkspaceRepairTools
   ├─► Initialize MCPDiagnostics
   ├─► Setup assistant routes
   ├─► Initialize memory systems
   └─► Ready to accept requests

4. Client loads (browser)
   ├─► Fetch index.html from gateway
   ├─► Vite HMR connects
   └─► Assistant panel ready
```

---

## Emergency Recovery

```bash
# Quick Recovery (port conflicts)
bash eidolon-recovery.sh → Option 1

# Standard Recovery (dependencies)
bash eidolon-recovery.sh → Option 2

# Nuclear Recovery (complete reset)
bash eidolon-recovery.sh → Option 3

# Emergency Mode (minimal fallback)
bash eidolon-recovery.sh → Option 4
# Starts emergency-eidolon.js on port 3000
```

---

## Health Monitoring

### Gateway → SDK Health Check
```javascript
// gateway-server.js:~100
setInterval(async () => {
  try {
    const res = await fetch(`http://127.0.0.1:${SDK_PORT}/health`);
    if (res.ok) {
      consecutiveMisses = 0;
    } else {
      consecutiveMisses++;
      if (consecutiveMisses >= MAX_MISSES) {
        restartSDK();
      }
    }
  } catch (err) {
    consecutiveMisses++;
  }
}, HEALTH_INTERVAL_MS);
```

### SDK Health Endpoint
```javascript
// index.js:~50
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'Eidolon Enhanced SDK',
    version: '4.1.0',
    override_active: true,
    timestamp: new Date().toISOString()
  });
});
```

---

## Override Verification

```bash
# Test assistant override
curl http://127.0.0.1:5000/assistant/verify-override

# Expected response:
{
  "ok": true,
  "identity": "Eidolon (Claude Opus 4.1 Enhanced SDK)",
  "override_active": true,
  "replit_assistant_override": true
}
```

---

## File System Structure

```
data/
├── memory/                          # Enhanced memory storage
│   ├── enhanced-memory.latest.json  # Current memory state
│   ├── context-snapshot.latest.json # Current context
│   └── *.{timestamp}.json          # Versioned backups
│
└── agent-logs/                      # Agent operation logs

server/eidolon/
├── core/
│   ├── code-map.ts                  # Workspace mapping
│   ├── context-awareness.ts         # Context engine
│   ├── deep-thinking-engine.ts      # Analysis engine
│   ├── llm.ts                       # Claude integration
│   ├── memory-enhanced.ts           # Memory manager
│   └── memory-store.ts              # File I/O
│
├── tools/
│   └── mcp-diagnostics.js           # MCP health tools
│
├── config.ts                        # SDK configuration
└── index.ts                         # Core exports
```

---

## Summary

**Eidolon Enhanced SDK** provides a complete Replit Assistant override with:
- ✅ Full assistant interception via gateway proxy
- ✅ Enhanced memory & context awareness
- ✅ Deep workspace analysis & diagnostics
- ✅ Auto-recovery with health monitoring
- ✅ Claude Sonnet 4.5 integration
- ✅ MCP server diagnostics & repair
- ✅ Multi-iteration deep thinking
- ✅ Versioned memory storage

All `/assistant/*` routes → Gateway (5000) → SDK (3101) → Eidolon response with `override_active: true`
