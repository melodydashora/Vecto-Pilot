# Strategy Component Framework

The complete recommendation pipeline with 13 components in workflow order.

## Overview: The Recommendation Pipeline

Every block recommendation flows through 13 strategic components in sequence. Each component builds on the previous, ensuring accuracy, context-awareness, and driver value optimization.

## Component Architecture

### 0. Header Strategy (Context Capture)

**What**: Complete environmental snapshot capturing GPS, weather, time, and contextual data
**Why**: Foundation for all downstream decisions; incomplete context corrupts ML training
**When**: On every recommendation request before any AI processing
**How**: Browser Geolocation → Geocoding → Timezone detection → Weather/AQI APIs → H3 geospatial indexing → Airport proximity check

**Data Storage**: `snapshots` table
- **Key Fields**: `snapshot_id` (UUID PK), `lat/lng` (GPS), `city/state/timezone` (geocoded), `dow/hour/day_part_key` (temporal), `h3_r8` (geospatial), `weather/air/airport_context` (JSONB context), `trigger_reason` (why snapshot created)
- **Linkage**: Foreign key for `strategies`, `rankings`, `actions` tables

**System Impact**: Gates entire pipeline; missing fields abort processing with clear error

**ML Impact**:
- Every field becomes model input; incomplete snapshots excluded from training
- `dow` enables weekend pattern learning, `h3_r8` enables geo-clustering
- `trigger_reason` tracks why snapshot created (location change, time shift, manual)
- `accuracy_m` (GPS precision), `coord_source` logged for reliability analysis

**Accuracy Foundation**: "Complete Snapshot Gating" invariant enforced; no partial context sent to LLMs

---

### 1. Strategic Overview (Triad Intelligence)

**What**: 2-3 sentence AI narrative synthesizing conditions into actionable insights
**Why**: Provides contextual frame for all downstream decisions
**When**: Location change >2mi, time transition, manual refresh, or 30min inactivity
**How**: Claude Sonnet 4.5 analyzes complete snapshot at T=0.0 with 12s timeout

**Data Storage**: `strategies` table
- **Key Fields**: `id` (UUID PK), `snapshot_id` (FK to snapshots, CASCADE), `strategy` (AI text), `status` (pending/ok/failed), `error_code/error_message` (failure tracking), `attempt` (retry count), `latency_ms` (performance), `tokens` (cost tracking)
- **Caching**: ETag-based HTTP cache for duplicate requests

**System Impact**: Gates entire triad pipeline; failure aborts all downstream processing

**ML Impact**:
- Every strategy linked to snapshot_id for context correlation
- `latency_ms` identifies slow Claude calls for optimization
- `tokens` field enables cost per recommendation analysis
- `attempt` count measures retry frequency; high retries indicate model instability
- `error_code` enables failure pattern analysis (timeout vs API error vs validation)

**Accuracy Foundation**: Complete snapshot gating ensures no strategy without GPS/weather/AQI/timezone

---

### 2. Venue Discovery (Catalog + Exploration)

**What**: Candidate selection from curated catalog + 20% AI-discovered new venues
**Why**: Prevents hallucinations while enabling exploration of emerging hotspots
**When**: On every recommendation request after strategic overview
**How**: H3 geospatial filtering + deterministic scoring + Gemini exploration (20% budget)

**Key Discipline**: Every venue entering the pipeline must carry a stable merge key (place_id preferred; name fallback). Validators must echo the same key unchanged. Any response missing the key is rejected and logged.

**Data Storage**: `venue_catalog` + `llm_venue_suggestions` + `venue_metrics` tables
- **venue_catalog**: `venue_id` (UUID PK), `place_id` (Google Places unique ID), `name/address/category`, `lat/lng`, `dayparts[]` (text array), `staging_notes/business_hours` (JSONB), `discovery_source` (seed/llm/driver), `validated_at`
- **llm_venue_suggestions**: `suggestion_id` (UUID PK), `model_name`, `ranking_id` (FK), `venue_name`, `validation_status` (pending/valid/rejected), `place_id_found`, `rejection_reason`
- **venue_metrics**: `venue_id` (FK to catalog), `times_recommended/times_chosen` (counters), `positive_feedback/negative_feedback`, `reliability_score` (0.0-1.0)

**System Impact**: Single source of truth from venues table prevents non-existent locations

**ML Impact**:
- `discovery_source` field enables "seed vs LLM vs driver" performance comparison
- `validation_status` tracks AI recommendation success rate
- `reliability_score` refined from feedback ratio
- H3 distance calculations enable geo-clustering analysis
- `dayparts[]` enables time-of-day recommendation optimization

**Accuracy Foundation**: Only Google Places-validated venues enter consideration set

---

### 3. Venue Hours (Accuracy-First)

**What**: Risk-gated validation ensuring "unknown" never presented as "open"
**Why**: Closure status materially affects driver income and trust
**When**: Closure risk >0.3 triggers validation; <0.1 uses estimates with badge
**How**: Closure risk calculation → Google Places API validation → cache 24h → substitute if unknown

**DB-first Policy**: For any known place_id, read address, lat/lng, and the last known open/closed metadata from our places cache before calling external APIs. `coords_verified_at` is authoritative for coordinates; `hours_last_checked` is authoritative for open/closed metadata. If both are within policy, skip the external call.

**Data Storage**: `places_cache` table + `venue_feedback` table
- **places_cache**: `place_id` (PK), `formatted_hours` (JSONB), `cached_at`, `access_count` (48h TTL constraint)
- **venue_feedback**: `id` (UUID PK), `venue_id` (FK), `driver_user_id`, `feedback_type` (hours_wrong/closed_when_open), `comment`, `reported_at`
- **Outcome Logging**: Each recommendation tagged with `open_confirmed/closed_confirmed/estimated_open/unknown_substituted` in rankings

**System Impact**: 24h metadata caching prevents quota exhaustion while ensuring accuracy

**ML Impact**:
- Closure risk predictions refined from actual outcomes
- Cost/accuracy tradeoffs measured for threshold optimization
- Driver feedback reports improve risk calculations
- `access_count` tracks cache hit rate (cost savings metric)
- Tracks when high-risk venues replaced vs validated

**Accuracy Foundation**: Prioritizes correctness over cost when driver earnings affected

---

### 4. Distance & ETA (Traffic-Aware)

**What**: Real-time traffic-aware distance and drive time calculations
**Why**: Straight-line estimates underestimate actual drive time, reducing earnings accuracy
**When**: For top-ranked venues after scoring, re-calculated on navigation launch
**How**: Google Routes API with TRAFFIC_AWARE routing → fallback to Haversine if API fails

**Source of Truth**: Distance shown to drivers is the server calculation (Routes when available; otherwise Haversine). The client must never overwrite venue coordinates with device GPS for display or math.

#### Google API Split of Duties

Each Google API has a specific, non-overlapping purpose:

1. **Geocoding API**: Coordinates ⇄ address conversion (+ place_id)
   - Forward: address → coordinates + place_id
   - Reverse: coordinates → address + place_id

2. **Places Details API**: Business metadata ONLY
   - opening_hours, business_status
   - Never used for coordinates or address resolution

3. **Routes API**: Distance and time calculations
   - Traffic-aware distance (meters)
   - ETA with current traffic conditions

4. **Database**: Source of truth for cached place data
   - place_id, lat, lng, formatted_address cached
   - Business hours cached separately

#### Venue Resolution Flow (DB-first)

```javascript
// Order for every candidate:
// a) DB-first: If we have place_id in DB → load lat/lng + address. Done.
// b) If only name (from GPT): Use Places Find Place to get place_id + coords
// c) If only coords (from GPT): Use Geocoding Reverse to get place_id + address
// d) Hours: Use Places Details(fields=opening_hours,business_status) after we have place_id
// e) Distance/time: Use Routes with validated coords
```

**Model-supplied coordinates are untrusted.** Names from models may seed search. place_id is obtained via Places Find Place/Text Search or via Geocoding→place_id; hours then come from Places Details.

#### Routes API Usage

```javascript
{
  origin: { lat, lng },           // From snapshot (validated, non-null)
  destination: { lat, lng },       // From Geocoding/Places (validated, non-null)
  travelMode: 'DRIVE',
  routingPreference: 'TRAFFIC_AWARE',
  departureTime: now + 30s        // Routes API requires future timestamp
}
```

**Returns**: `distanceMeters`, `durationSeconds`, `durationInTrafficSeconds`

**Haversine Fallback**: Used only when Routes API fails; flagged as `distanceSource: "fallback"`

**UI Display Policy**: Center metric shows Distance in miles from server. Subtext `<0.1 mile` for values less than 0.1 miles. If `distanceSource=haversine_fallback`, show "est." badge.

---

### 5. Surge Detection (Opportunity Capture)

**What**: Real-time surge pricing detection with high-multiplier flagging
**Why**: Surge opportunities are time-sensitive and income-critical
**When**: For high-demand venues on every refresh (airports, events, stadiums)
**How**: Uber/Lyft API surge checks → threshold filter (>1.5x) → priority flag (≥2.0x)

**System Impact**: Rate limit management ensures continuous monitoring without quota exhaustion

**ML Impact**: Historical surge patterns stored for predictive window identification

**Accuracy Foundation**: Real-time API calls prevent stale surge data affecting recommendations

---

### 6. Earnings Projection (Income Accuracy)

**What**: Realistic per-ride earnings estimates based on context and historical data
**Why**: Drivers need accurate income projections to evaluate opportunity cost
**When**: For every recommended venue after hours/distance/surge enrichment
**How**: base_earnings_hr × adjustment_factor (open=0.9x, closed=0.7x, event=variable, surge=additive)

**Deterministic Fallbacks**: When validator earnings fields are absent or unparsable, use server "potential" as first fallback. If potential is absent, derive earnings_per_mile from distance and conservative base_earnings_hr; if still undefined, fail-closed instead of returning $0.

**System Impact**: Pulls from venue_metrics historical performance for grounded estimates

**ML Impact**: Logs projected vs. actual earnings for calibration model training

**Accuracy Foundation**: Context-aware adjustments prevent over-optimistic projections

---

### 7. Priority Flagging (Urgency Intelligence)

**What**: High/normal/low priority assignment based on urgency indicators
**Why**: Time-sensitive opportunities need immediate driver attention
**When**: During ranking process after all enrichment complete
**How**: `if (surge≥2.0 OR earnings≥$60 OR eventStartsSoon) → high; if (closed AND driveTime>30) → low`

**System Impact**: Visual priority indicators drive faster decision-making

**ML Impact**: Logs priority vs. driver response time for urgency calibration

**Accuracy Foundation**: Multi-factor urgency prevents false alarms while catching real opportunities

---

### 8. Block Ranking (Value Optimization)

**What**: Deterministic venue sorting by expected driver value
**Why**: Present best opportunities first while maintaining category diversity
**When**: Final step before presentation after all enrichment complete
**How**: `score(proximity, reliability, events, personalization)` → diversity check → final sort

**System Impact**: Deterministic scoring enables A/B testing and auditing

**ML Impact**: Every ranking logged with `ranking_id` for counterfactual "what if" analysis

**Accuracy Foundation**: Quantitative scoring prevents LLM ranking bias

---

### 8.5. ML Training Data Persistence (Atomic Capture)

**What**: Transactional persistence of rankings and candidates for ML training
**Why**: Partial writes corrupt training data; atomic commits ensure data integrity
**When**: Immediately after final enrichment, before returning blocks to UI
**How**: Single transaction writes one `rankings` row + N `ranking_candidates` rows (target 6)

**Data Storage**: `rankings` + `ranking_candidates` tables with strict constraints
- **rankings**: `ranking_id` (UUID PK), `snapshot_id` (FK), `user_id`, `city`, `model_name`, `correlation_id`, `created_at`
- **ranking_candidates**: `id` (serial PK), `ranking_id` (FK CASCADE), `name`, `place_id`, `category`, `rank` (1-N), `distance_miles`, `drive_time_minutes`, `value_per_min`, `value_grade`, `surge`, `est_earnings`
- **Constraints**: Unique index on `(ranking_id, rank)` prevents duplicate ranks; check constraint ensures `distance_miles ≥ 0` and `drive_time_minutes ≥ 0`; FK cascade deletes orphaned candidates

**Required Fields Per Candidate**: `name`, `place_id`, `rank`, `distance_miles`, `drive_time_minutes` (NULLs forbidden for these core fields)

**System Impact**: Fail-hard on persistence errors keeps DB and UI consistent

**ML Impact**:
- Atomic writes guarantee complete training examples
- `correlation_id` links rankings to strategies/actions for "what we recommended vs what they chose" analysis
- Every candidate has distance/time/earnings for model training
- `created_at` + `snapshot_id` + `correlation_id` enable full pipeline reconstruction

**Accuracy Foundation**: "Persist or fail" rule prevents corrupted training data

---

### 9. Staging Intelligence (Waiting Strategy)

**What**: Specific waiting location recommendations with parking/walk-time details
**Why**: Helps drivers avoid tickets and optimize positioning for pickups
**When**: Enrichment phase for top-ranked venues during final presentation
**How**: AI-suggested staging + driver feedback database + venue metadata

**Data Storage**: `venue_catalog.staging_notes` (JSONB) + driver preference tracking
- **staging_notes Fields**: `type` (Premium/Standard/Free/Street), `name`, `address`, `walk_time`, `parking_tip`
- **Driver Preferences**: `preferredStagingTypes[]` stored in user profile

**System Impact**: Personalization boost (+0.1) for preferred staging types

**ML Impact**:
- Driver's staging type choices tracked to identify patterns
- Staging quality vs ride acceptance rate measured
- Driver feedback enriches `staging_notes` database
- Each venue accumulates staging recommendations from AI + drivers

**Accuracy Foundation**: Combines AI analysis with crowd-sourced local knowledge

---

### 10. Pro Tips (Tactical Guidance)

**What**: 1-4 concise tactical tips per venue (max 250 chars each)
**Why**: Actionable advice improves driver success rate at specific venues
**When**: Generated by GPT-5 during tactical planning stage
**How**: GPT-5 Planner analyzes venue+time context → generates tips → Zod schema validation

**Data Storage**: Generated by GPT-5, stored in-memory during request (ephemeral)
- **Validation**: Zod schema enforces `z.array(z.string().max(250)).min(1).max(4)`
- **Context**: Generated from snapshot + venue + historical patterns

**System Impact**: Character limits ensure mobile-friendly display

**ML Impact**:
- Tip categories (timing/staging/events) correlated with venue success
- NLP on tip content identifies which advice types drive driver action
- Tip length, count, category distribution logged per model/venue
- Tips tagged with snapshot conditions for "tip → outcome" analysis
- Tip presence vs absence measured for conversion impact

**Accuracy Foundation**: Context-aware generation prevents generic advice

---

### 11. Gesture Feedback (Learning Loop)

**What**: Like/hide/helpful actions captured for personalization
**Why**: System learns individual driver preferences over time
**When**: Immediately on driver interaction, applied in next recommendation cycle
**How**: action logged → venue_metrics updated → if (3+ hides) → add to noGoZones → suppress future

**Data Storage**: `actions` table + `venue_metrics` updates
- **actions**: `action_id` (UUID PK), `created_at`, `ranking_id` (FK), `snapshot_id` (FK CASCADE), `user_id`, `action` (like/hide/helpful/not_helpful), `block_id`, `dwell_ms` (time spent viewing), `from_rank` (position in list), `raw` (JSONB metadata)
- **venue_metrics**: `positive_feedback++` (on like/helpful), `negative_feedback++` (on hide/not_helpful), `reliability_score` recalculated
- **Driver Profile**: `successfulVenues[]` (liked), `noGoZones[]` (hidden 3+times)

**System Impact**: Personalization boost (+0.3) for liked venues, null return for hidden

**ML Impact**:
- "What we recommended vs what they chose" enables ranking optimization
- `positive_feedback/negative_feedback` ratio updates `reliability_score` (0.0-1.0 scale)
- Identifies venue types/times driver prefers/avoids across sessions
- 3+ hides triggers `noGoZones[]` addition (permanent unless manually removed)
- `dwell_ms` measures engagement; low dwell + hide = immediate rejection signal
- `from_rank` enables "position in list → action" correlation for ranking bias adjustment

**Accuracy Foundation**: Respects explicit driver preferences as ground truth

---

### 12. Navigation Launch (Seamless Routing)

**What**: Deep-link navigation to Google Maps/Apple Maps with traffic awareness
**Why**: Frictionless transition from recommendation to action
**When**: On-demand when driver taps "Navigate" button
**How**: Platform detection → native app deep-link → fallback to web → airport context alerts

**Data Storage**: `actions` table (navigate action) + Routes API call (real-time, not stored)
- **Navigation Action**: `action='navigate'`, `block_id` (venue navigated to), `dwell_ms` (time before tap), `raw.platform` (iOS/Android), `raw.eta_shown` (projected ETA)
- **Actual Arrival**: Not captured (future enhancement: compare projected vs actual ETA)

**System Impact**: Routes API recalculates ETA with current traffic on launch

**ML Impact**:
- Navigate action = strongest positive signal (driver committed to venue)
- `raw.eta_shown` vs actual arrival time measures projection accuracy
- iOS vs Android navigation success rates compared
- `dwell_ms` before navigate measures driver confidence (fast tap = high confidence)
- View → Dwell → Navigate funnel analysis per venue/ranking position
- FAA delay alerts shown → navigate rate measures value of contextual warnings

**Accuracy Foundation**: Traffic-aware routing ensures driver sees same ETA we projected

---

## System Integration Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                   RECOMMENDATION PIPELINE FLOW                       │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  0. HEADER STRATEGY (Context Capture)                       │    │
│  │     ← Browser Geolocation → Geocoding → Weather/AQI APIs   │    │
│  └────────────────────────────┬───────────────────────────────┘    │
│                                ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  1. STRATEGIC OVERVIEW (Claude Sonnet 4.5)                  │    │
│  │     ← Complete Snapshot (GPS/Weather/AQI/Timezone)          │    │
│  └────────────────────────────┬───────────────────────────────┘    │
│                                ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  2. VENUE DISCOVERY (Catalog + Gemini Exploration)          │    │
│  │     ← PostgreSQL venues catalog + H3 Geospatial             │    │
│  └────────────────────────────┬───────────────────────────────┘    │
│                                ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  3. VENUE HOURS (Risk-Gated Validation)                     │    │
│  │     ← Google Places API + 24h metadata cache                │    │
│  └────────────────────────────┬───────────────────────────────┘    │
│                                ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  4. DISTANCE & ETA (Traffic-Aware Routing)                  │    │
│  │     ← Google Routes API (TRAFFIC_AWARE mode)                │    │
│  └────────────────────────────┬───────────────────────────────┘    │
│                                ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  5. SURGE DETECTION (Real-Time Pricing)                     │    │
│  │     ← Uber/Lyft Surge APIs                                  │    │
│  └────────────────────────────┬───────────────────────────────┘    │
│                                ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  6. EARNINGS PROJECTION (Context-Aware Calculations)        │    │
│  │     ← venue_metrics historical performance                  │    │
│  └────────────────────────────┬───────────────────────────────┘    │
│                                ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  7. PRIORITY FLAGGING (Urgency Logic)                       │    │
│  │     ← Multi-factor: surge/earnings/events/timing            │    │
│  └────────────────────────────┬───────────────────────────────┘    │
│                                ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  8. BLOCK RANKING (Deterministic Scoring)                   │    │
│  │     ← proximity/reliability/events/personalization          │    │
│  └────────────────────────────┬───────────────────────────────┘    │
│                                ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  8.5. ML PERSISTENCE (Atomic Transaction)                   │    │
│  │     ← rankings + ranking_candidates tables                  │    │
│  └────────────────────────────┬───────────────────────────────┘    │
│                                ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  9. STAGING INTELLIGENCE (GPT-5 Planner)                    │    │
│  │     ← AI staging + driver feedback DB                       │    │
│  └────────────────────────────┬───────────────────────────────┘    │
│                                ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  10. PRO TIPS (Tactical Advice Generation)                  │    │
│  │     ← GPT-5: 1-4 tips, max 250 chars each                   │    │
│  └────────────────────────────┬───────────────────────────────┘    │
│                                ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  11. GESTURE FEEDBACK (Personalization Learning)            │    │
│  │     ← actions table: like/hide/helpful                      │    │
│  └────────────────────────────┬───────────────────────────────┘    │
│                                ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  12. NAVIGATION LAUNCH (Platform-Aware Deep-Linking)        │    │
│  │     ← Google Maps / Apple Maps + Routes API ETA             │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Critical Success Factors

1. **Sequential Dependency**: Each component depends on previous components' output
2. **Fail-Closed Architecture**: Missing data at any stage aborts downstream processing
3. **ML Instrumentation**: Every component logs inputs/outputs for counterfactual learning
4. **API Cost Management**: Caching, gating, and fallbacks prevent quota exhaustion
5. **Accuracy-First Posture**: When driver income affected, correctness trumps cost

## Related Documentation

- [AI Pipeline](ai-pipeline.md) - TRIAD architecture and model configuration
- [Database Schema](database-schema.md) - Table definitions and relationships
- [Google Cloud APIs](google-cloud-apis.md) - API usage and cost management
- [Constraints](constraints.md) - Critical rules that cannot be violated
