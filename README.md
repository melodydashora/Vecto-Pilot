
# Vecto Pilot™ - Strategic Rideshare Assistant

**Identity**: Vecto Pilot™ powered by Eidolon (Claude Sonnet 4.5 Enhanced SDK)  
**Version**: 4.5.0  
**Architecture**: Multi-server with ML capture system  
**AI Model**: Multi-provider LLM router (Gemini 2.5 Pro primary, GPT-5 + Claude fallbacks)

---

## ⚠️ CRITICAL DEVELOPMENT RULE

**DO NOT perform rework or break existing flow without reviewing ARCHITECTURE.md first.**

All system design decisions, guards, and architectural patterns are documented in `ARCHITECTURE.md`. Before making any changes to core logic, pipelines, or data flow:

1. **Read ARCHITECTURE.md** - Understand the existing design and rationale
2. **Verify guards are in place** - Don't recreate protections that already exist
3. **Follow single-path principles** - No fallbacks in triad pipeline (documented)
4. **Respect zero-hardcoding policy** - All data must reconcile to database sources

This prevents costly rework and maintains system integrity.

---

## 🤖 AI Models - CURRENT PRODUCTION CONFIG

> **⚠️ IMPORTANT FOR AI ASSISTANTS**: These models were released in 2025 (after most training cutoffs). The information below is tested and verified as of October 5, 2025. Trust these exact model names and parameters - don't second-guess them based on older training data.

---

## 🧠 STRATEGY GENERATOR - SINGLE SOURCE OF TRUTH

**Purpose**: Auto-generate 2-3 sentence strategic overviews when snapshots are created

### Current Configuration (October 5, 2025)
- **Model**: `claude-opus-4-1-20250805` (Claude Opus 4.1)
- **Why Opus 4.1?**: Superior strategic thinking and reasoning (74.5% SWE-bench vs 72.5% Opus 4)
- **Temperature**: `0.0` (most deterministic/tightest possible)
- **Max Tokens**: `500` (sufficient for 2-3 sentences)
- **Top P**: Not specified (defaults to 1.0)
- **Extended Thinking**: ❌ Disabled (not needed for short strategic summaries)

### Implementation
```javascript
// server/lib/strategy-generator.js
const strategyText = await callClaude({
  system: systemPrompt,
  user: userPrompt,
  max_tokens: 500,
  temperature: 0.0  // Tightest temperature for consistency
});
```

### Model Adapter Configuration
```javascript
// server/lib/adapters/anthropic-claude.js
model = process.env.CLAUDE_MODEL || "claude-opus-4-1-20250805"
```

### Environment Variable
```bash
CLAUDE_MODEL=claude-opus-4-1-20250805
```

### Extended Thinking Notes
- **Not used for strategy generation** (overkill for 2-3 sentences)
- **When to use extended thinking**: Complex multi-step reasoning, advanced coding, agentic workflows
- **Temperature limitation**: Extended thinking does NOT support temperature adjustments
- **Only top_p adjustable**: Must be 0.95-1.0 when extended thinking is enabled
- **Optimal budget_tokens**: 4K-32K for most tasks (diminishing returns above 32K)

---

### Primary Model (Fastest - 22.4s response time)
**Google Gemini 2.5 Pro**
- **Model ID**: `gemini-2.5-pro`
- **Endpoint**: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent`
- **API Key**: `process.env.GEMINI_API_KEY`
- **Parameters**: 
  ```json
  {
    "generationConfig": {
      "maxOutputTokens": 2048,
      "temperature": 0.2
    }
  }
  ```
- **Context**: 1M tokens (2M coming soon)
- **Released**: June 2025

### Fallback #1 (27.7s response time)
**OpenAI GPT-5**
- **Model ID**: `gpt-5`
- **Endpoint**: `https://api.openai.com/v1/chat/completions`
- **API Key**: `process.env.OPENAI_API_KEY`
- **Parameters**:
  ```json
  {
    "model": "gpt-5",
    "max_completion_tokens": 2048,
    "reasoning_effort": "minimal"
  }
  ```
- **Context**: 272K input / 128K output tokens
- **Released**: August 7, 2025
- **Note**: Supports `reasoning_effort` (`minimal`, `low`, `medium`, `high`). Does NOT support `temperature`, `top_p`, `frequency_penalty`, or `presence_penalty`

### Fallback #2 (38.8s response time)
**Anthropic Claude Sonnet 4.5**
- **Model ID**: `claude-sonnet-4-5-20250929`
- **Endpoint**: `https://api.anthropic.com/v1/messages`
- **API Key**: `process.env.ANTHROPIC_API_KEY`
- **Required Headers**:
  ```
  x-api-key: YOUR_KEY
  anthropic-version: 2023-06-01
  ```
- **Parameters**:
  ```json
  {
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 64000,
    "system": "SYSTEM_PROMPT"
  }
  ```
- **Context**: 200K tokens (1M with beta header)
- **Released**: September 29, 2025
- **⚠️ Important**: Use **raw HTTP** instead of `@anthropic-ai/sdk` - the SDK doesn't recognize Claude 4.5 yet and will return 404. See `server/lib/anthropic-extended.js` for working implementation.

### Router Configuration
```env
PREFERRED_MODEL=google:gemini-2.5-pro
FALLBACK_MODELS=openai:gpt-5,anthropic:claude-sonnet-4-5-20250929
LLM_TOTAL_BUDGET_MS=60000  # 60 seconds total timeout
```

**Full documentation**: See `docs/reference/LLM_MODELS_REFERENCE.md` for code examples and update protocol.

---

## 🚀 Quick Start

### 1. Add Required Secrets to Replit

Navigate to the Secrets tab and add:

- **`ANTHROPIC_API_KEY`** - Your Claude API key from Anthropic
- **`AGENT_TOKEN`** - Generate with: `openssl rand -hex 32`
- **`DATABASE_URL`** - PostgreSQL connection string (auto-configured in Replit)

### 2. Click Run

The system will automatically:
- Start Gateway Server on port 5000 (public)
- Start Eidolon SDK on port 3101 (internal)
- Initialize PostgreSQL database with ML tables
- Enable Replit Assistant override
- Begin serving your React application

---

## 🏗️ System Architecture

### **Data Architecture Principles**

**Database-Driven Reconciliation - Zero Hardcoding Policy**

This application follows a strict **database reconciliation model** where all location data, venue information, and model configurations are stored in and retrieved from the database. **No hardcoded locations, coordinates, model names, or business logic constants are permitted in the codebase.**

**Core Principles:**
1. **All locations are database records** - Venue coordinates, addresses, and metadata live in PostgreSQL tables
2. **Models configured via environment variables** - AI model names, API endpoints, and parameters are `.env` driven
3. **Dynamic reconciliation** - The app queries the database for current state, never assumes static data
4. **No magic strings** - Location names, categories, and filters are database-driven, not code constants
5. **Live data only** - GPS coordinates, weather, timezone, and context are fetched in real-time

**What This Means:**
- ❌ **Never** hardcode `if (city === "Dallas")` or `lat: 32.776` in code
- ✅ **Always** query database: `SELECT * FROM venues WHERE city = $1`
- ❌ **Never** hardcode `model: "gpt-4"` in code  
- ✅ **Always** use env vars: `process.env.OPENAI_MODEL`
- ❌ **Never** assume static venue catalogs in code
- ✅ **Always** reconcile against live database state

This architecture ensures the app scales dynamically as new venues are added to the database and adapts automatically when model configurations change via environment variables.

---

### **Multi-Server Design**

```
┌─────────────────────────────────────────────────────────┐
│  Gateway (Port 5000) - Public Interface                │
│  ├─ Reverse proxy to SDK                               │
│  ├─ Vite dev server (HMR)                              │
│  ├─ Static file serving                                │
│  └─ SDK health watchdog                                │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│  Eidolon SDK (Port 3101) - Internal Backend            │
│  ├─ Complete Replit Assistant override                 │
│  ├─ Business logic & API endpoints                     │
│  ├─ Claude API integration                             │
│  └─ ML data capture                                    │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│  PostgreSQL Database                                    │
│  ├─ snapshots (context records)                        │
│  ├─ rankings (recommendation sets)                     │
│  ├─ ranking_candidates (individual blocks)             │
│  └─ actions (user interactions)                        │
└─────────────────────────────────────────────────────────┘
```

---

## 📊 Core Features

### **1. Smart Block Recommendations**
- AI-powered location suggestions from Claude Sonnet 4.5
- Context-aware (city, weather, time of day, traffic)
- Filtered by drive time (0-30 minutes)
- Ranked by earnings per mile

### **2. ML Data Capture**
- Automatic context snapshot on GPS refresh
- Recommendation tracking (what Claude suggested)
- User action logging (view, dwell, click, dismiss)
- Prepared for future model training

### **3. Location Intelligence**
- High-accuracy GPS with browser geolocation
- Google Maps geocoding (city, state, country)
- Timezone resolution
- Weather and AQI integration

### **4. Replit Assistant Override**
- Complete replacement of default assistant
- Enhanced memory and context awareness
- Workspace diagnostics and file operations
- Deep thinking engine for complex analysis

---

## 📁 Core Files

### Infrastructure
- **`gateway-server.js`** - Public gateway with reverse proxy
- **`index.js`** - Eidolon SDK with AI assistant override
- **`agent-server.js`** - File operations and command execution

### Backend API
- **`server/routes/blocks.js`** - Smart recommendations with ML capture
- **`server/routes/location.js`** - GPS resolution and snapshot storage
- **`server/routes/actions.js`** - User interaction logging
- **`server/db/drizzle.js`** - Database schema and queries

### Frontend
- **`client/src/App.tsx`** - Main React application
- **`client/src/pages/co-pilot.tsx`** - Smart blocks UI
- **`client/src/contexts/location-context-clean.tsx`** - GPS state management
- **`client/src/components/GlobalHeader.tsx`** - Universal header component

### Eidolon Enhanced SDK
- **`server/eidolon/core/`** - AI capabilities (memory, context, deep thinking)
- **`server/eidolon/tools/`** - Diagnostics and workspace tools
- **`server/eidolon/config.ts`** - Centralized configuration

---

## 🔧 API Endpoints

### 📍 Location Services

#### `GET /api/location/resolve`
Geocode GPS coordinates to location details with timezone

**Parameters**:
```
lat: number (required) - Latitude
lng: number (required) - Longitude
```

**Response**:
```json
{
  "city": "Frisco",
  "state": "TX",
  "country": "United States",
  "timeZone": "America/Chicago",
  "formattedAddress": "1701 Timber Ridge Dr, Frisco, TX 75036, USA"
}
```

#### `GET /api/location/geocode/forward`
Convert city name to coordinates

**Parameters**:
```
city: string (required) - City name (e.g., "Dallas,TX")
```

**Response**:
```json
{
  "city": "Dallas",
  "state": "TX",
  "country": "United States",
  "coordinates": {
    "lat": 32.7767,
    "lng": -96.7970
  },
  "formattedAddress": "Dallas, TX, USA"
}
```

#### `GET /api/location/weather`
Get current weather conditions

**Parameters**:
```
lat: number (required)
lng: number (required)
```

**Response**:
```json
{
  "available": true,
  "temperature": 69,
  "feelsLike": 69,
  "conditions": "Clear",
  "description": "clear sky",
  "humidity": 76,
  "windSpeed": 9,
  "precipitation": 0,
  "icon": "01n"
}
```

#### `GET /api/location/airquality`
Get current air quality index (AQI)

**Parameters**:
```
lat: number (required)
lng: number (required)
```

**Response**:
```json
{
  "available": true,
  "aqi": 78,
  "category": "Good air quality",
  "dominantPollutant": "o3",
  "healthRecommendations": {},
  "dateTime": "2025-10-05T12:00:00Z",
  "regionCode": "us"
}
```

#### `POST /api/location/snapshot`
Save context snapshot to database (SnapshotV1 format)

**Request Body**:
```json
{
  "snapshot_id": "uuid",
  "user_id": "uuid",
  "device_id": "uuid",
  "session_id": "uuid",
  "created_at": "2025-10-07T12:00:00Z",
  "coord": {
    "lat": 33.12886,
    "lng": -96.87570,
    "accuracyMeters": 85,
    "source": "gps"
  },
  "resolved": {
    "city": "Frisco",
    "state": "TX",
    "country": "United States",
    "timezone": "America/Chicago",
    "formattedAddress": "1701 Timber Ridge Dr, Frisco, TX 75036, USA"
  },
  "time_context": {
    "local_iso": "2025-10-07T09:00:00-05:00",
    "dow": 1,
    "hour": 9,
    "is_weekend": false,
    "day_part_key": "morning"
  },
  "weather": {
    "tempF": 69,
    "conditions": "Clear",
    "description": "clear sky"
  },
  "air": {
    "aqi": 78,
    "category": "Good air quality"
  },
  "device": {
    "ua": "Mozilla/5.0...",
    "platform": "web"
  },
  "permissions": {
    "geolocation": "granted"
  }
}
```

**Response**:
```json
{
  "ok": true,
  "snapshot_id": "uuid",
  "h3_r8": "8826c87297fffff",
  "airport_context": {
    "airport_code": "DFW",
    "distance_miles": 18.6,
    "delay_minutes": 30
  }
}
```

---

### 🎯 Smart Blocks & Co-Pilot

#### `GET /api/blocks`
Get AI-powered location recommendations

**Parameters**:
```
lat: number (required)
lng: number (required)
userId: string (optional, default: 'default')
minDistance: number (optional, default: 8) - Min drive time in minutes
maxDistance: number (optional, default: 10) - Max drive time in minutes
llmModel: string (optional) - Testing: 'gemini', 'gpt-5', 'claude'
llmParam: string (optional) - Testing parameter value
```

**Headers**:
```
X-Snapshot-Id: string (optional) - Anchor to specific snapshot
```

**Response**:
```json
{
  "blocks": [
    {
      "id": "block-1",
      "name": "DFW Terminal C",
      "from": "Frisco, TX",
      "to": "DFW Terminal C",
      "distance": "18.6 miles",
      "estimatedTime": "22 min",
      "trafficDelay": 3,
      "construction": false,
      "incidents": 0,
      "congestionLevel": "light",
      "earnings": {
        "estimatedFare": 35,
        "timeCost": 12,
        "netValue": 23
      },
      "mapLink": "https://maps.google.com/..."
    }
  ],
  "meta": {
    "count": 6,
    "radius": "10 minutes",
    "center": { "lat": 33.12886, "lng": -96.87570 },
    "minRate": 15
  }
}
```

**Side Effects**: Creates `ranking` and `ranking_candidates` records in database

#### `POST /api/blocks-merged`
Merged strategy using Planner (GPT-5) → Validator (Gemini) → Explainer (Claude)

**Request Body**:
```json
{
  "userId": "demo",
  "origin": {
    "lat": 33.12886,
    "lng": -96.87570
  },
  "currentTime": "2025-10-05T12:00:00Z",
  "shiftDuration": 8,
  "maxDriveDistance": 15,
  "stream": false
}
```

**Response**:
```json
{
  "strategy": "Focus on airport terminals during early morning...",
  "blocks": [
    {
      "id": "venue-uuid",
      "name": "DFW Terminal C",
      "address": "Dallas/Fort Worth International Airport",
      "lat": 32.8998,
      "lng": -97.0403,
      "driveTime": 22,
      "distance": "18.6 miles",
      "estimatedEarnings": 35,
      "urgency": "high",
      "reasoning": "High business travel volume...",
      "proTips": ["Stage near Departures", "Watch for surge alerts"]
    }
  ],
  "correlationId": "abc123def",
  "elapsed_ms": 4500,
  "model_route": "gpt5→gemini→claude",
  "validation": {
    "status": "valid",
    "schema_check": "passed"
  }
}
```

#### `GET /api/blocks-discovery`
Hybrid discovery: Seeded venues + AI suggestions validated by Places API

**Parameters**:
```
lat: number (required)
lng: number (required)
userId: string (optional)
snapshotId: string (optional)
```

**Response**:
```json
{
  "blocks": [...],
  "summary": {
    "totalProjectedEarnings": 180,
    "avgHourlyRate": 22.50
  },
  "metadata": {
    "generatedAt": "2025-10-05T12:00:00Z",
    "context": {
      "time": "morning",
      "weather": "69°F Clear"
    },
    "driverLocation": {
      "lat": 33.12886,
      "lng": -96.87570
    }
  }
}
```

---

### 📊 User Actions & ML Capture

#### `POST /api/actions`
Log user interaction for ML training

**Request Body**:
```json
{
  "ranking_id": "uuid",
  "action": "block_selected",
  "block_id": "venue-uuid",
  "dwell_ms": 3500,
  "from_rank": 1,
  "user_id": "uuid",
  "raw": {}
}
```

**Headers**:
```
X-Idempotency-Key: string (optional) - Prevent duplicate actions
```

**Response**:
```json
{
  "success": true,
  "action_id": "uuid"
}
```

**Action Types**: `view`, `dwell`, `block_selected`, `block_clicked`, `block_dismissed`

---

### 🔧 Agent Server (Port 43717)

**Authentication**: All requests require `x-agent-token` header

#### `GET /agent/health`
Health check

**Response**:
```json
{
  "ok": true,
  "base": "/home/runner/workspace",
  "time": "2025-10-05T12:00:00Z",
  "version": "2.1.0",
  "environment": "replit"
}
```

#### `GET /agent/info`
Get server capabilities and limits

**Response**:
```json
{
  "ok": true,
  "version": "2.1.0",
  "features": {
    "read": true,
    "write": true,
    "list": true,
    "shell": true,
    "nodejs": true,
    "database": true,
    "sql": true
  },
  "limits": {
    "maxFileSize": 10485760,
    "commandTimeout": 60000,
    "allowedCommands": ["ls", "cat", "npm", "node", "git", ...]
  },
  "security": {
    "cors": true,
    "rateLimiting": true,
    "pathTraversal": "protected",
    "commandWhitelist": true
  }
}
```

#### `POST /agent/fs/read`
Read file contents

**Request Body**:
```json
{
  "path": "server/routes/blocks.js"
}
```

**Response**:
```json
{
  "ok": true,
  "path": "server/routes/blocks.js",
  "content": "import { Router } from 'express'...",
  "size": 5432,
  "modified": "2025-10-05T12:00:00Z"
}
```

#### `POST /agent/fs/write`
Write file contents

**Request Body**:
```json
{
  "path": "data/config.json",
  "content": "{\"key\":\"value\"}"
}
```

**Response**:
```json
{
  "ok": true,
  "path": "data/config.json",
  "bytes": 15,
  "timestamp": "2025-10-05T12:00:00Z"
}
```

#### `POST /agent/shell`
Execute shell command

**Request Body**:
```json
{
  "cmd": "npm",
  "args": ["install", "lodash"]
}
```

**Response**:
```json
{
  "ok": true,
  "cmd": "npm",
  "args": ["install", "lodash"],
  "stdout": "added 1 package...",
  "stderr": "",
  "executionTime": 2500,
  "truncated": false
}
```

#### `POST /agent/sql/query`
Execute SQL SELECT query (read-only)

**Request Body**:
```json
{
  "sql": "SELECT * FROM snapshots LIMIT 5",
  "params": []
}
```

**Response**:
```json
{
  "ok": true,
  "rows": [...],
  "rowCount": 5,
  "command": "SELECT",
  "fields": [
    { "name": "snapshot_id", "dataType": 2950 },
    { "name": "city", "dataType": 1043 }
  ]
}
```

#### `POST /agent/sql/execute`
Execute SQL statement (INSERT/UPDATE/DELETE)

**Request Body**:
```json
{
  "sql": "INSERT INTO venue_feedback (venue_id, feedback_type) VALUES ($1, $2)",
  "params": ["uuid", "positive"]
}
```

**Response**:
```json
{
  "ok": true,
  "rows": [],
  "rowCount": 1,
  "command": "INSERT"
}
```

#### `GET /agent/sql/tables`
List all database tables

**Response**:
```json
{
  "ok": true,
  "tables": [
    "actions",
    "llm_venue_suggestions",
    "places_cache",
    "ranking_candidates",
    "rankings",
    "snapshots",
    "venue_catalog",
    "venue_feedback",
    "venue_metrics"
  ]
}
```

#### `POST /agent/sql/schema`
Get table schema information

**Request Body**:
```json
{
  "table_name": "snapshots"
}
```

**Response**:
```json
{
  "ok": true,
  "schema": [
    {
      "table_name": "snapshots",
      "column_name": "snapshot_id",
      "data_type": "uuid",
      "is_nullable": "NO",
      "column_default": null
    },
    ...
  ],
  "table": "snapshots"
}
```

---

### 🏥 Health & Monitoring

#### `GET /health`
SDK health check

**Response**:
```json
{
  "ok": true,
  "timestamp": "2025-10-05T12:00:00Z"
}
```

---

## 🗃️ Database Schema

### **snapshots** - Context Records
Captures GPS, location, weather, and time context on each refresh.

```sql
snapshot_id UUID PRIMARY KEY
user_id TEXT
device_id TEXT
city TEXT           -- "Frisco, TX"
h3_r8 TEXT         -- Geospatial hex index
day_part TEXT      -- "afternoon", "morning", etc.
created_at TIMESTAMP
```

### **rankings** - Recommendation Sets
Stores each set of recommendations from Claude with strategy text.

```sql
ranking_id UUID PRIMARY KEY
snapshot_id UUID → snapshots.snapshot_id
strategy_text TEXT  -- Claude's strategy overview
created_at TIMESTAMP
```

### **ranking_candidates** - Individual Blocks
Each block in a ranking with its position and metrics.

```sql
id SERIAL PRIMARY KEY
ranking_id UUID → rankings.ranking_id
block_id TEXT       -- "The Star in Frisco"
rank INTEGER        -- 1-6 position
earnings_usd DECIMAL
distance_miles DECIMAL
drive_minutes INTEGER
```

### **actions** - User Interactions
Logs what users do with recommendations (view, click, dismiss).

```sql
id SERIAL PRIMARY KEY
action_type TEXT    -- view, dwell, click, dismiss
snapshot_id UUID → snapshots.snapshot_id
ranking_id UUID → rankings.ranking_id
block_id TEXT
dwell_ms INTEGER    -- For dwell actions
created_at TIMESTAMP
```

---

## 🎓 ML Training Pipeline (Future)

The current system captures all necessary data for training a custom recommendation model:

**Input Features** (from `snapshots`):
- City, geospatial hex, day part, weather, hour of day

**Candidate Features** (from `ranking_candidates`):
- Block ID, earnings, distance, drive time

**Labels** (from `actions`):
- Click probability, dwell time

**Model Goal**: Predict `P(user clicks block | context, candidate features)` to re-rank blocks by predicted click probability.

---

## 🛠️ Development Commands

### Start Development Server
```bash
# Automatically runs on "Run" button
node gateway-server.js
```

### Database Migrations
```bash
# Run initial migrations
npm run db:migrate
```

### Build for Production
```bash
# Build React client
cd client && npm run build
```

### Health Check
```bash
# Test SDK health
curl http://127.0.0.1:5000/health
```

---

## 🚨 Emergency Recovery

If the system encounters issues, use the recovery script:

```bash
bash eidolon-recovery.sh
```

**Options**:
1. Quick Recovery (port conflicts)
2. Standard Recovery (dependencies)
3. Nuclear Recovery (complete reset)
4. Emergency Mode (minimal fallback)

---

## 📚 Documentation

- **`LEXICON.md`** - Complete system terminology and architecture
- **`COMPONENT_ORGANIZATION.md`** - UI component mapping and data flow
- **`EIDOLON_ARCHITECTURE.md`** - Eidolon SDK technical architecture
- **`VECTO_BUILD_DOCUMENTATION.md`** - Build history and changes

---

## 🔐 Security

- **Agent Server**: Token-based auth with command whitelisting
- **Rate Limiting**: Gateway enforces API rate limits
- **CORS**: Configured for Replit environment
- **Database**: Connection pooling with prepared statements
- **API Keys**: Stored in Replit Secrets (never in code)

---

## 🌟 Key Technologies

### Backend
- **Node.js 22+** - Runtime with native ESM
- **Express** - HTTP server framework
- **PostgreSQL** - Relational database
- **Drizzle ORM** - Type-safe database queries
- **Claude Sonnet 4.5** - AI recommendations

### Frontend
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool with HMR
- **Tailwind CSS** - Utility-first styling
- **shadcn/ui** - Component library
- **Wouter** - Lightweight routing

### Infrastructure
- **http-proxy-middleware** - Reverse proxy
- **express-rate-limit** - API rate limiting
- **H3** - Geospatial indexing
- **Zod** - Runtime validation

---

## 📈 Current Status

**Build**: ✅ Complete  
**ML Infrastructure**: ✅ Active  
**Data Capture**: ✅ Logging real-world interactions  
**AI Recommendations**: ✅ Claude Sonnet 4.5 integrated  
**Database**: ✅ 4 tables capturing context → ranking → action  

**Next Steps**:
- Continue capturing real-world data
- Build model training pipeline
- Deploy custom recommendation model
- A/B test Claude vs. custom model

---

## 👥 Support

For issues or questions about Eidolon Enhanced SDK:
- Check `EIDOLON_ARCHITECTURE.md` for technical details
- Review console logs in gateway and SDK
- Use emergency recovery script if needed

---

**Vecto Pilot™** - Strategic Rideshare Assistant powered by **Eidolon (Claude Sonnet 4.5 Enhanced SDK)**

**Last Updated**: October 5, 2025 - Comprehensive API documentation with verbose request/response formats
