
# Vecto Pilot™ Component Organization & System Architecture
*Complete mapping of infrastructure, data flow, and ML capture system*

---

## 🏗️ **Infrastructure Architecture**

### **Multi-Server Design**

```
┌─────────────────────────────────────────────────────────────┐
│                    PUBLIC INTERFACE                          │
│                                                              │
│  Gateway Server (Port 5000) - gateway-server.js             │
│  ├─ Reverse proxy to SDK (3101)                             │
│  ├─ Vite dev server (HMR for React)                         │
│  ├─ Static file serving (client/dist)                       │
│  ├─ CORS & rate limiting                                    │
│  └─ SDK health watchdog (auto-restart)                      │
│                                                              │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                 INTERNAL BACKEND                             │
│                                                              │
│  Eidolon SDK Server (Port 3101) - index.js                  │
│  ├─ Complete Replit Assistant override                      │
│  ├─ Business logic & API endpoints                          │
│  ├─ Claude API integration                                  │
│  ├─ Enhanced memory system                                  │
│  └─ Workspace intelligence                                  │
│                                                              │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  DATA LAYER                                  │
│                                                              │
│  PostgreSQL Database                                         │
│  ├─ snapshots (context records)                             │
│  ├─ rankings (recommendation sets)                          │
│  ├─ ranking_candidates (individual blocks)                  │
│  └─ actions (user interactions)                             │
│                                                              │
│  Filesystem Storage                                          │
│  └─ data/context-snapshots/ (JSON backups)                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 **Data Flow Mapping**

### **Location Resolution Flow**

```
User opens app / Manual GPS refresh
    │
    ├─→ Browser Geolocation API (navigator.geolocation)
    │
    ├─→ useGeoPosition Hook (client/src/hooks/useGeoPosition.ts)
    │   └─ Returns: { latitude, longitude, accuracy }
    │
    ├─→ LocationContext (client/src/contexts/location-context-clean.tsx)
    │   ├─ Stores GPS coordinates
    │   ├─ Triggers resolve endpoint
    │   └─ Updates UI components
    │
    ├─→ POST /api/location/resolve
    │   └─ server/routes/location.js
    │       ├─ Google Maps Geocoding API → city, state, country
    │       ├─ Google Timezone API → timezone, UTC offset
    │       ├─ OpenWeather API → weather, temp, AQI
    │       └─ Returns: { city, state, country, timeZone, weather }
    │
    ├─→ SnapshotV1 Creation (client/src/lib/snapshot.ts)
    │   └─ Combines: GPS + resolved data + time context
    │
    └─→ POST /api/location/snapshot
        └─ server/routes/location.js
            ├─ Saves to snapshots table (Postgres)
            ├─ Saves to filesystem (JSON backup)
            └─ Returns: { snapshot_id }
```

### **Smart Blocks Recommendation Flow**

```
User navigates to Co-Pilot tab
    │
    ├─→ GET /api/blocks?lat=X&lng=Y&minDistance=0&maxDistance=30
    │   └─ server/routes/blocks.js
    │
    ├─→ Fetch latest context snapshot
    │   └─ GET /api/location/snapshot/latest?userId=default
    │
    ├─→ Build prompt with context
    │   ├─ City: "Frisco, TX"
    │   ├─ Weather: "Clear, 72°F"
    │   ├─ Time: "3:24 PM on Thursday"
    │   ├─ Daypart: "afternoon"
    │   └─ Drive time range: "0-30 minutes"
    │
    ├─→ Claude API Request (anthropic-extended.js)
    │   └─ Model: claude-sonnet-4-5-20250929
    │       └─ Returns: 6-8 blocks with strategy
    │
    ├─→ Filter by drive time
    │   ├─ Near band: 0-15 minutes (fill first)
    │   └─ Far band: 16-30 minutes (fill if needed)
    │
    ├─→ Rank by earnings per mile
    │   └─ earnings_usd / distance_miles
    │
    ├─→ ML Capture (non-blocking)
    │   ├─ Save to rankings table (ranking_id, snapshot_id, strategy)
    │   └─ Save to ranking_candidates table (block_id, rank, earnings)
    │
    └─→ Return Top 6 blocks to client
        └─ client/src/pages/co-pilot.tsx displays cards
```

### **User Action Logging Flow**

```
User interacts with block card
    │
    ├─→ Action Types:
    │   ├─ view (card appears on screen)
    │   ├─ dwell (user stays on card >2 seconds)
    │   ├─ click (user taps "Navigate" or card)
    │   └─ dismiss (user swipes away or closes)
    │
    ├─→ POST /api/actions
    │   └─ server/routes/actions.js
    │       └─ Body: {
    │           action_type: 'dwell',
    │           snapshot_id: 'uuid',
    │           ranking_id: 'uuid',
    │           block_id: 'The Star in Frisco',
    │           dwell_ms: 5432
    │         }
    │
    └─→ Save to actions table
        └─ Links: snapshot → ranking → candidate → action
            └─ Enables ML training: "Given context X, user chose block Y"
```

---

## 🎯 **Tab 1: Pilot™ (/co-pilot)**
**Purpose**: AI Co-Pilot and Strategic Decision Engine

### Core Components:
- **`co-pilot.tsx`** - Main smart blocks UI
  - Fetches recommendations from `/api/blocks`
  - Displays top 6 blocks with earnings, drive time, distance
  - Tracks dwell time per block
  - Logs view/click/dismiss actions
  - Shows strategy overview from Claude

### Data Dependencies:
- `LocationContext` - Current GPS coordinates
- `/api/blocks` - Smart recommendations
- `/api/actions` - User interaction logging

### ML Capture Points:
- View action on page load
- Dwell tracking (>2 seconds = logged)
- Click events (navigate button)
- Dismiss events (swipe/close)

---

## 🚗 **Tab 2: Trips (/tracking)**
**Purpose**: Trip Tracking and Manual Entry

### Core Components:
- `manual-tracking-improved.tsx` - Enhanced manual entry
- `manual-tracking.tsx` - Basic manual tracking
- `session-tracker.tsx` - Session management
- `trip-photo-analyzer.tsx` - Photo-based trip analysis

### Sub-Components:
- `daily-tracking-summary.tsx` - Daily summaries
- `shift-session-manager.tsx` - Session management
- `uber-auth.tsx` - Platform authentication
- `rideshare-auth.tsx` - Multi-platform auth

---

## ⚡ **Tab 3: Smart Shift (/smart-shift)**
**Purpose**: Intelligent Shift Planning and Block Optimization

### Core Components:
- `agenda-generator.tsx` - Smart agenda creation
- `enhanced-agenda-generator.tsx` - Advanced planning
- `real-time-agenda.tsx` - Live agenda updates
- `vehicle-aware-agenda.tsx` - Vehicle-optimized planning

### Sub-Components:
- `detailed-agenda-display.tsx` - Detailed view
- `agenda-blocks-map.tsx` - Visual block mapping
- `one-click-optimization.tsx` - Quick optimization
- `one-click-ml-optimizer.tsx` - ML-powered optimization
- `quick-shift-start.tsx` - Fast shift initiation

---

## 📊 **Tab 4: Dashboard (/dashboard)**
**Purpose**: Analytics, Insights, and Performance Metrics

### Core Components:
- `animated-dashboard.tsx` - Main dashboard with animations
- `real-time-dashboard.tsx` - Live data dashboard
- `performance-snapshot.tsx` - Performance overview
- `earnings-prediction-card.tsx` - Earnings forecasting

### Analytics Components:
- `earnings-comparison.tsx` - Earnings analysis
- `earnings-heat-map.tsx` - Visual earnings data
- `earnings-progress-bar.tsx` - Progress tracking
- `earnings-sparkline.tsx` - Trend visualization
- `historical-analysis.tsx` - Historical data analysis

### Map Components:
- `analytics-map.tsx` - Analytics mapping
- `hotspot-map.tsx` - Hotspot visualization
- `enhanced-hotspot-map.tsx` - Advanced hotspot display
- `live-hotspot-map.tsx` - Real-time hotspots

---

## 🤖 **Tab 5: AI Tools (/ai-tools)**
**Purpose**: AI Chat Assistant and Strategy Tools

### Core Components:
- `enhanced-openai-agenda.tsx` - OpenAI-powered planning
- `goal-achievement-override.tsx` - Goal management
- `goal-finisher.tsx` - Goal completion tools

### Analysis Components:
- `trip-photo-analyzer.tsx` - Photo analysis (shared with Trips)
- `visual-learning-upload.tsx` - Visual learning system
- `block-feedback.tsx` - Feedback collection

---

## ⚙️ **Tab 6: Management (/trip-management)**
**Purpose**: Trip Management, Hotspots, and System Settings

### Settings Components:
- `driver-settings-panel.tsx` - Main settings
- `home-zone-settings.tsx` - Home zone configuration
- `driver-zone-preferences.tsx` - Zone preferences
- `vehicle-preferences-card.tsx` - Vehicle settings
- `zone-filter-settings.tsx` - Zone filtering

### System Components:
- `account-verification.tsx` - Account verification
- `auth-status-banner.tsx` - Authentication status
- `override-history.tsx` - System override history

---

## 🌍 **Shared/Global Components**
*Used across multiple tabs*

### Location & Navigation:
- **`LocationContext`** (`location-context-clean.tsx`)
  - Provides GPS coordinates to entire app
  - Triggers location resolution
  - Handles snapshot creation
  - Manages refresh logic

- **`GlobalHeader.tsx`**
  - Displays current city and GPS accuracy
  - Shows real-time clock
  - Provides manual GPS refresh button
  - Always visible across all pages

- `VerifiedAddressSelect.tsx` - Address verification
- `location-banner.tsx` - Location display
- `location-permission-handler.tsx` - GPS permissions
- `manual-gps-trigger.tsx` - GPS controls
- `traffic-aware-routing.tsx` - Smart routing

### Data & Analytics:
- `zone-demand-table.tsx` - Demand visualization
- `driver-density-dashboard.tsx` - Driver density
- `fatigue-monitor.tsx` - Safety monitoring

### UI Framework:
- `bottom-navigation.tsx` - Tab navigation
- `ErrorBoundary.tsx` - Error handling

---

## 🔄 **Component Consolidation Plan**

### Duplicates to Merge:
1. **Manual Tracking**: Consolidate `manual-tracking.tsx` and `manual-tracking-improved.tsx`
2. **Agenda Generation**: Merge `agenda-generator.tsx` and `enhanced-agenda-generator.tsx`
3. **Hotspot Maps**: Unify `hotspot-map.tsx`, `enhanced-hotspot-map.tsx`, and `live-hotspot-map.tsx`
4. **Auth Components**: Consolidate `uber-auth.tsx` and `rideshare-auth.tsx`
5. **Settings**: Merge `driver-zone-preferences.tsx` and `driver-zone-preferences-new.tsx`

### Shared Dependencies:
- Location services across all tabs
- Authentication across Trips and Management
- Analytics components shared between Dashboard and AI Tools
- Map components used in multiple tabs

---

## 📁 **File Structure Recommendations**

```
/components/
  /shared/           # Cross-tab components (GlobalHeader, LocationContext)
  /pilot/           # Tab 1 specific (co-pilot.tsx)
  /tracking/        # Tab 2 specific
  /shift/           # Tab 3 specific
  /dashboard/       # Tab 4 specific
  /ai-tools/        # Tab 5 specific
  /management/      # Tab 6 specific
  /ui/              # UI framework components (shadcn/ui)
```

---

## 🗃️ **Database Schema**

### **snapshots**
```sql
snapshot_id UUID PRIMARY KEY
user_id TEXT
device_id TEXT
city TEXT           -- "Frisco, TX"
h3_r8 TEXT         -- Geospatial hex index
day_part TEXT      -- "afternoon", "morning", etc.
created_at TIMESTAMP
```

### **rankings**
```sql
ranking_id UUID PRIMARY KEY
snapshot_id UUID → snapshots.snapshot_id
strategy_text TEXT  -- Claude's strategy overview
created_at TIMESTAMP
```

### **ranking_candidates**
```sql
id SERIAL PRIMARY KEY
ranking_id UUID → rankings.ranking_id
block_id TEXT       -- "The Star in Frisco"
rank INTEGER        -- 1-6 position
earnings_usd DECIMAL
distance_miles DECIMAL
drive_minutes INTEGER
```

### **actions**
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

## 🎓 **ML Training Pipeline (Future)**

```
Training Data Structure:
    Input Features (from snapshots):
        - city
        - h3_r8 (geo hex)
        - day_part
        - weather (from snapshot file)
        - hour_of_day (from snapshot file)
    
    Candidate Features (from ranking_candidates):
        - block_id
        - earnings_usd
        - distance_miles
        - drive_minutes
    
    Labels (from actions):
        - did_click (1 if clicked, 0 if dismissed)
        - dwell_time (seconds)
    
    Model Goal:
        Predict: P(user clicks block | context, candidate features)
        Use for: Re-ranking blocks by predicted click probability
```

---

**Last Updated**: October 2, 2025  
**Status**: Core infrastructure complete, ML capture active, ready for model training

This organization eliminates redundancy while maintaining clear separation of concerns for each tab's functionality and establishing a complete ML learning pipeline.
