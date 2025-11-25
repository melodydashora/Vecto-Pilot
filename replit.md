# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed to maximize rideshare driver earnings. It provides real-time, data-driven strategic briefings by integrating diverse data sources (location, events, traffic, weather, air quality) and leveraging advanced AI and data analytics to generate actionable strategies for drivers.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application with a multi-service architecture, supporting both monolithic and split deployments, and features a model-agnostic AI configuration.

**Core Services**:
-   **Gateway Server**: Handles client traffic, serves the React SPA, routes requests, and manages child processes.
-   **SDK Server**: Provides business logic via a REST API for data services and the ML data pipeline.
-   **Agent Server**: Delivers workspace intelligence with secure, token-based access.

**AI Configuration**:
The platform utilizes a role-based, model-agnostic architecture with configurable AI models for its strategy generation pipeline. This pipeline is event-driven and comprises four components: Strategist, Briefer, Consolidator, and Holiday Checker. All AI models are configured via environment variables.

**Frontend Architecture**:
A React + TypeScript Single Page Application (SPA), built with Vite, utilizing Radix UI, TailwindCSS, and React Query. It features a Strategy Section, Smart Blocks for venue recommendations, an AI Strategy Coach, and a Rideshare Briefing Tab, including immutable strategy history with a retry workflow.

**Data Storage**:
A PostgreSQL Database (Replit built-in, Neon-backed) with Drizzle ORM stores snapshots, strategies, venue events, and ML training data. It uses unique indexes and JSONB for flexible storage. Replit automatically routes to development database during development and production database when published - no manual configuration needed.

**Authentication & Security**:
Employs JWT with RS256 Asymmetric Keys and security middleware for rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

**Deployment & Reliability**:
Supports Mono Mode and Split Mode, featuring health-gated entry points, unified port binding, proxy gating, WebSocket protection, and process discipline. An optional autoscale mode is optimized for Replit deployments.

**Environment Contract Architecture**:
A contract-driven environment system with mode-specific validation prevents configuration drift. `DEPLOY_MODE` (e.g., `webservice`, `worker`) dictates the loaded environment variables and enforces contracts.

**Connection Resilience**:
Includes a comprehensive Neon connection resilience pattern with `server/db/connection-manager.js` to wrap `pg.Pool`, detect admin-terminated connections, and implement auto-reconnect logic with exponential backoff. Health endpoints (`/health`, `/ready`) reflect database degradation status by returning 503 during outages.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic (Claude), OpenAI (GPT-5), Google (Gemini), Perplexity.
-   **Location & Mapping**: Google Places API, Google Routes API, Google Geocoding API.
-   **Weather and Air Quality**: Configurable via environment variables.

### Database
-   **PostgreSQL (Replit Built-in)**: Primary data store, managed by Drizzle ORM. Uses `DATABASE_URL` environment variable which Replit automatically configures for dev/prod separation. Features robust connection resilience with auto-reconnect logic and exponential backoff.

### Infrastructure
-   **Replit Platform**: Deployment and Nix environment.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.

## Database Schema - Snapshots Table

The **snapshots** table is the foundation for strategy generation and Coach context. Each snapshot captures a complete "moment in time" of driver location and environmental conditions.

### Location & Coordinates
| Field | Type | Purpose |
|-------|------|---------|
| `snapshot_id` | UUID | Primary key, unique identifier for each snapshot moment |
| `lat` | Float | Latitude coordinate from GPS or manual search |
| `lng` | Float | Longitude coordinate from GPS or manual search |
| `accuracy_m` | Float | GPS accuracy in meters (0.0-200.0m typical) |
| `coord_source` | Text | 'gps', 'manual_city_search', 'api', etc. |

### Location Names (Geocoded)
| Field | Type | Purpose |
|-------|------|---------|
| `city` | Text | City name (e.g., "Frisco") |
| `state` | Text | State code (e.g., "TX") |
| `country` | Text | Country code (e.g., "US") |
| `formatted_address` | Text | Full address (e.g., "Frisco, TX 75034, USA") |
| `timezone` | Text | IANA timezone (e.g., "America/Chicago") |
| `h3_r8` | Text | Hexagonal spatial index for grid-based analysis |

### Time Context
| Field | Type | Purpose |
|-------|------|---------|
| `local_iso` | Timestamp | Local time when snapshot created (no TZ) |
| `dow` | Integer | Day of week (0=Sunday, 1=Monday...6=Saturday) |
| `hour` | Integer | Hour of day (0-23) |
| `day_part_key` | Text | Time period label: 'early_morning' (5-9am), 'mid_morning' (9am-12pm), 'afternoon' (12-5pm), 'evening' (5-9pm), 'night' (9pm-5am) |

### Environmental Data (JSONB)
| Field | Type | Sample Structure | Coach Use |
|-------|------|------------------|-----------|
| `weather` | JSONB | `{temp: 63, condition: "Cloudy", windSpeed: 8}` | Context for surge patterns, outdoor vs airport demand |
| `air` | JSONB | `{aqi: 92, level: "Moderate", pollutants: {...}}` | Air quality context, pollution-related surge areas |
| `local_news` | JSONB | `{events: [...], incidents: [...]}` | Real-time disruptions Coach can discuss |
| `airport_context` | JSONB | `{nearestAirports: [...], delays: [...]}` | Airport activity for Q&A |

### Special Context
| Field | Type | Purpose |
|-------|------|---------|
| `holiday` | Text | Holiday name if applicable (e.g., "Thanksgiving", "Christmas") or null |
| `is_holiday` | Boolean | Quick flag for holiday surge detection |

### Metadata (JSONB)
| Field | Type | Purpose |
|-------|------|---------|
| `device` | JSONB | Device type, OS, app version |
| `permissions` | JSONB | GPS, location permissions status |
| `extras` | JSONB | Future extensibility fields |

### Timestamps
| Field | Type | Purpose |
|-------|------|---------|
| `created_at` | Timestamp | When snapshot was persisted to DB |
| `session_id` | UUID | Groups multiple snapshots in user session |
| `device_id` | UUID | Tracks unique device across sessions |
| `user_id` | UUID | Null if anonymous, references registered user |

## AI Coach Integration

**Early Engagement Model**: The Coach now shows **BEFORE strategy completes** using snapshot data as a backup plan for Q&A:

### Coach receives snapshot fields:
- **Location context**: `city`, `state`, `formatted_address`, `coordinates`
- **Time context**: `hour`, `dow` (day of week), `day_part_key` (time period)
- **Environmental data**: `weather` (temp, condition), `air` (AQI, pollution), `local_news` (events)
- **Holiday info**: `holiday` (name), `is_holiday` (boolean flag)
- **Timezone**: For displaying local time to driver

### Coach features snapshot-driven Q&A:
- "What's the weather affecting demand today?" → Uses `weather` field
- "What's the air quality?" → Uses `air.aqi`
- "What time of day is it?" → Uses `hour` + `day_part_key`
- "Are there events happening?" → Uses `local_news`, `airport_context`
- "Is today a holiday?" → Uses `holiday` + `is_holiday`

### API Endpoint
**GET `/api/snapshot/:snapshotId`** - Fetch snapshot for Coach context
- Returns all fields listed above
- Called automatically when snapshot is created
- Cached for 10 minutes to reduce database load
- Enables Coach to answer questions while strategy generates (35-50 second wait)