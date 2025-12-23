
# Vecto Pilot™ - Development Lexicon

## System Identity
**Name**: Vecto Pilot™ - Strategic Rideshare Assistant  
**Backend**: Eidolon (Claude Opus 4.1 Enhanced SDK)  
**Version**: 4.1.0  
**Architecture**: Multi-server with ML capture system

---

## Infrastructure Components

### **Gateway Server** (Port 5000)
- **File**: `gateway-server.js`
- **Purpose**: Public-facing reverse proxy and request router
- **Responsibilities**:
  - Routes all `/api/*` requests to SDK (port 3101)
  - Serves Vite dev server with HMR
  - Serves static React build from `client/dist`
  - Health monitoring and SDK auto-restart
  - CORS and rate limiting

### **Eidolon SDK Server** (Port 3101)
- **File**: `index.js`
- **Purpose**: Internal backend API and AI assistant override
- **Responsibilities**:
  - Complete Replit Assistant replacement
  - Business logic and Claude API integration
  - Workspace diagnostics and file operations
  - Enhanced memory and context management

### **Database** (PostgreSQL)
- **Purpose**: ML data capture and future model training
- **Tables**:
  - `snapshots` - Context records (GPS, city, weather, time)
  - `rankings` - Recommendation sets from Claude
  - `ranking_candidates` - Individual block recommendations
  - `actions` - User interactions (view, dwell, click, dismiss)
  - ''

---

## UI Components & Architecture
-Header Resolution

### **Global Header**
- **Component**: `GlobalHeader.tsx`
- **Definition**: Universal header on every page containing:
  - Vecto Pilot™ branding and logo
  - "Strategic Rideshare Assistant" tagline
  - Real-time clock display (updates every second)
  - Current location with GPS status indicator
  - Settings access button
  - Refresh functionality
- **Data Sources**:
  - Location from `LocationContext`
  - Time from browser `Date` object
  - GPS accuracy from geolocation API
- **Usage**: Always present, never changes between pages

### **Bottom Navigation**
- **Component**: `BottomNavigation.tsx`
- **Definition**: Fixed bottom navigation with 6 main tabs
- **Usage**: Consistent across all pages

### **Main Content Area**
- **Definition**: The scrollable content between Global Header and Bottom Navigation
- **Styling**: Uses `pb-20` for bottom nav clearance
- **Usage**: Where all page-specific content renders

---

## Main Navigation Tabs

### 1. **Pilot™** (`/co-pilot`)
- **Purpose**: AI Co-Pilot and Strategic Decision Engine
- **Component**: `co-pilot.tsx`
- **Features**:
  - Smart block recommendations from Claude
  - ML-captured ranking display
  - Strategy overview with context awareness
  - Real-time dwell tracking
  - User action logging (view/click/dismiss)

### 2. **Trips** (`/tracking`)
- **Purpose**: Trip Tracking and Manual Entry
- **Sub-tabs**: TBD

### 3. **Smart Shift** (`/smart-shift`)
- **Purpose**: Intelligent Shift Planning and Block Optimization
- **Sub-tabs**: TBD

### 4. **Dashboard** (`/dashboard`)
- **Purpose**: Analytics, Insights, and Performance Metrics
- **Sub-tabs**: TBD

### 5. **AI Tools** (`/ai-tools`)
- **Purpose**: AI Chat Assistant and Strategy Tools
- **Sub-tabs**: TBD

### 6. **Management** (`/trip-management`)
- **Purpose**: Trip Management, Hotspots, and System Settings
- **Sub-tabs**: TBD

---

## Data Flow Architecture

### **Location Flow**
```
Browser Geolocation API
    ↓
useGeoPosition Hook
    ↓
LocationContext (client/src/contexts/location-context-clean.tsx)
    ↓
POST /api/location/resolve (geocoding, timezone, weather)
    ↓
SnapshotV1 creation (client/src/lib/snapshot.ts)
    ↓
POST /api/location/snapshot (save to DB + filesystem)
    ↓
Used by Claude for recommendations
```

### **Smart Blocks Flow**
```
User opens Co-Pilot tab
    ↓
GET /api/blocks?lat=X&lng=Y&minDistance=0&maxDistance=30
    ↓
Server fetches latest snapshot (GET /api/location/snapshot/latest)
    ↓
Claude API call with context (city, weather, time, daypart)
    ↓
Claude returns 6-8 blocks with strategy
    ↓
Server filters by drive time (0-15min = near, 16-30min = far)
    ↓
Top 6 blocks returned to client
    ↓
Ranking and candidates saved to DB
    ↓
Client displays blocks with dwell tracking
    ↓
User actions logged to DB (view/dwell/click/dismiss)
```

### **ML Capture Flow**
```
Context Snapshot (on GPS refresh)
    ↓
snapshots table (snapshot_id, city, h3_r8, day_part)
    ↓
Smart Blocks Request
    ↓
rankings table (ranking_id, snapshot_id, strategy_text)
    ↓
ranking_candidates table (block_id, rank, earnings_usd, drive_minutes)
    ↓
User Actions
    ↓
actions table (action_type, snapshot_id, ranking_id, block_id)
    ↓
Future: Train model on (snapshot → ranking → action) patterns
```

---

## Development Terms

### **Tab Consistency**
- All major tabs use the Global Header
- All pages include Bottom Navigation
- Content area gets `pb-20` for bottom nav clearance

### **Global vs Local**
- **Global**: Components on every page (Header, Bottom Nav, LocationContext)
- **Local**: Page-specific content and sub-navigation

### **Sub-tabs**
- Internal navigation within each main tab
- Should be consistently styled across all main tabs
- Use same header structure

### **Context Snapshot**
- Captures GPS, city, weather, timezone, and time context
- Created on GPS refresh (manual or automatic)
- Saved to DB (`snapshots` table) and filesystem (`data/context-snapshots/`)
- Used by Claude for location-aware recommendations

### **Smart Blocks**
- AI-generated recommendations from Claude
- Filtered by drive time (0-30 minutes)
- Ranked by earnings per mile
- Tracked for ML learning (view, dwell, click, dismiss)

### **Daypart**
- Time-of-day category for context awareness
- Values: `overnight`, `early_morning`, `morning`, `late_morning_noon`, `afternoon`, `evening`, `late_night`
- Defined in `client/src/lib/daypart.ts`

### **H3 Resolution 8**
- Geospatial hex index for location clustering
- Used for zone-based analysis
- Stored in `snapshots` table

---

## API Endpoints

### Location Services
- `POST /api/location/resolve` - Geocode GPS to city/state/country/timezone
- `POST /api/location/snapshot` - Save context snapshot to DB + filesystem
- `GET /api/location/snapshot/latest` - Fetch most recent snapshot for user

### Smart Blocks
- `GET /api/blocks` - Get AI recommendations with ML capture
  - Query params: `lat`, `lng`, `minDistance`, `maxDistance`, `userId`
  - Returns: Top 6 blocks with strategy, drive times, earnings
  - Side effects: Creates ranking, saves candidates to DB

### Actions
- `POST /api/actions` - Log user interaction
  - Body: `{ action_type, snapshot_id, ranking_id, block_id, dwell_ms }`
  - Types: `view`, `dwell`, `click`, `dismiss`

### Health
- `GET /health` - SDK health check (used by gateway watchdog)

---

## Environment Variables

### Required Secrets
- `ANTHROPIC_API_KEY` - Claude API access
- `AGENT_TOKEN` - Agent server authentication (32-byte hex)
- `DATABASE_URL` - PostgreSQL connection string

### Auto-configured
- `PORT=5000` - Gateway public port
- `EIDOLON_PORT=3101` - SDK internal port
- `AGENT_PORT=43717` - Agent server port
- `ASSISTANT_OVERRIDE_MODE=true` - Enable Replit override
- `CLAUDE_MODEL=claude-sonnet-4-5-20250929` - AI model

---

## File Organization

### Core Application
- `gateway-server.js` - Public gateway with proxies
- `index.js` - Eidolon SDK with AI override
- `agent-server.js` - File operations and commands

### Client (React + TypeScript)
- `client/src/App.tsx` - Main application wrapper
- `client/src/pages/co-pilot.tsx` - Smart blocks UI
- `client/src/contexts/location-context-clean.tsx` - GPS and location state
- `client/src/lib/snapshot.ts` - SnapshotV1 creation utility
- `client/src/lib/daypart.ts` - Time-of-day categorization

### Server (Node.js + Express)
- `server/routes/blocks.js` - Smart blocks endpoint with ML capture
- `server/routes/location.js` - GPS resolution and snapshot storage
- `server/routes/actions.js` - User interaction logging
- `server/db/drizzle.js` - Database schema (snapshots, rankings, candidates, actions)

### Eidolon Enhanced SDK
- `server/eidolon/core/` - AI capabilities (memory, context, deep thinking)
- `server/eidolon/tools/` - Diagnostics and workspace tools
- `server/eidolon/config.ts` - Centralized configuration

---

## Notes
- Global Header is the only truly static element
- All dynamic data (location, time, weather) is variable and fetched live
- ML capture is non-blocking (logs errors but doesn't fail requests)
- Context snapshots prepare data for future model training
- City name now properly resolved and included in snapshots

---

**Last Updated**: October 2, 2025  
**Status**: Core ML infrastructure complete, capturing real-world data
