# Coach Data Access - Comprehensive Inventory

## Current State vs. Potential

### What Coach Currently Receives (Limited)

**From Frontend** (`CoachChat.tsx` line 50):
```typescript
{
  userId,
  message,
  snapshotId,
  strategy,  // Text only
  blocks: blocks.map(b => ({ 
    name: b.name, 
    category: b.category, 
    address: b.address 
  }))
}
```

**From Database** (`chat.js` lines 30-52):
```javascript
- snap.city
- snap.state  
- snap.day_part_key
- snap.day_of_week // MISSING - not in schema
- snap.weather_condition // MISSING - weather is jsonb object
- snap.airport_context // Boolean
- strategyData[0].strategy (truncated to 200 chars)
```

---

## What Coach SHOULD Have Access To

### 1. Full Snapshot Context (snapshots table)

**Location Intelligence:**
- ✅ lat, lng, accuracy_m
- ✅ city, state, country
- ✅ formatted_address
- ✅ timezone
- ✅ h3_r8 (H3 grid cell for precision location)

**Time Context:**
- ✅ local_iso (local timestamp)
- ✅ dow (0=Sunday, 6=Saturday)
- ✅ hour (0-23)
- ✅ day_part_key (overnight, morning, afternoon, etc.)

**Environmental Data:**
- ✅ weather (jsonb) - {tempF, conditions, description}
- ✅ air (jsonb) - {aqi, category}
- ✅ airport_context (jsonb) - {name, code, distance, driving_status}

**News & Events:**
- ✅ local_news (jsonb) - Perplexity daily news affecting rideshare
- ✅ news_briefing (jsonb) - **Gemini 60-minute briefing with:**
  - **0:15 Airports** - DFW delays, surges, drop-off tips
  - **0:30 Traffic** - Real-time accidents, slowdowns, route advice
  - **0:45 Events** - Concerts, games, festivals happening now
  - **1:00 Policy** - Regulations, city changes, driver alerts

**Device Context:**
- ✅ device (jsonb) - User agent, platform
- ✅ permissions (jsonb) - Geolocation status

### 2. Full Strategy Data (strategies table)

- ✅ strategy (unlimited text) - **Full Claude Opus 4.1 analysis**
- ✅ strategy_for_now (unlimited text) - **GPT-5 tactical briefing**
- ✅ model_name, model_params, prompt_version (for debugging)
- ✅ lat, lng, city (where strategy was created)
- ✅ latency_ms, tokens (performance metrics)

### 3. Full Blocks/Rankings Data (ranking_candidates table)

**For Each Venue:**
- ✅ name, lat, lng, place_id
- ✅ drive_time_min, distance_miles
- ✅ est_earnings_per_ride, earnings_per_mile
- ✅ model_score, rank
- ✅ value_per_min, value_grade, not_worth
- ✅ pro_tips (array) - **GPT-5 tactical tips**
- ✅ closed_reasoning - **Why recommend if closed**
- ✅ staging_tips - **Where to park/stage**
- ✅ **venue_events (jsonb)** - **CRITICAL: Full Perplexity event data:**
  ```json
  {
    "has_events": true,
    "summary": "Legacy Hall at Legacy West in Frisco has two special events...",
    "badge": "🎸 Concert tonight",
    "citations": ["https://...", "https://..."],
    "impact_level": "high",
    "researched_at": "2025-10-30T...",
    "date": "2025-10-30"
  }
  ```

### 4. User Feedback & History

**Venue Feedback** (venue_feedback table):
- ✅ sentiment (up/down), comment
- ✅ Aggregated counts per venue
- ✅ User's past preferences

**Strategy Feedback** (strategy_feedback table):
- ✅ sentiment on overall strategy
- ✅ Comments on what worked/didn't work

**Actions** (actions table):
- ✅ What venues user clicked
- ✅ Dwell time on recommendations
- ✅ Navigation actions taken

### 5. Memory Systems (for personalization)

**assistant_memory:**
- User preferences
- Past conversations
- Learned patterns

**cross_thread_memory:**
- System-wide insights
- Successful patterns
- Market trends

---

## What's Currently MISSING in Coach Context

### ⚠️ Critical Gaps

1. **Full Event Data** - Only sending venue name/category/address, missing:
   - eventSummary (full Perplexity answer with details)
   - eventBadge, eventImpact
   - Event citations

2. **Full Weather Data** - Accessing `weather_condition` (doesn't exist), should access:
   - weather.tempF, weather.conditions, weather.description

3. **Full Airport Data** - Only checking boolean, missing:
   - airport_context.name, airport_context.code
   - airport_context.distance, airport_context.driving_status

4. **News Briefings** - Not accessing at all:
   - news_briefing (Gemini's 0:15/0:30/0:45/1:00 intel)
   - local_news (Perplexity daily news)

5. **Full Block Details** - Only sending name/category/address, missing:
   - pro_tips (tactical advice)
   - staging_tips (parking guidance)
   - value_per_min, earnings data
   - businessHours, isOpen status

6. **Feedback Context** - Not accessing:
   - User's past thumbs up/down on venues
   - Strategy feedback history
   - Action logs (what user actually clicked)

---

## Recommended Enhancement: Full Context API

### New Endpoint: `POST /api/chat` (Enhanced)

**Request Body:**
```typescript
{
  userId: string,
  message: string,
  snapshotId: string,
  includeFullContext: boolean  // Default: true
}
```

**Backend Enhancement:**
```javascript
// Fetch EVERYTHING for this snapshot
const fullContext = {
  snapshot: {
    location: { city, state, timezone, formatted_address },
    time: { local_iso, dow, hour, day_part_key },
    weather: snap.weather,  // Full object
    air: snap.air,  // Full object
    airport: snap.airport_context,  // Full object
    news: snap.local_news,  // Perplexity news
    newsBriefing: snap.news_briefing  // Gemini 60-min briefing
  },
  strategy: {
    full: strategyData.strategy,  // Claude analysis
    tactical: strategyData.strategy_for_now  // GPT-5 briefing
  },
  blocks: await db
    .select()
    .from(ranking_candidates)
    .where(eq(ranking_candidates.snapshot_id, snapshotId))
    .orderBy(ranking_candidates.rank),  // ALL fields including venue_events
  feedback: {
    venues: await db.select().from(venue_feedback).where(...),
    strategy: await db.select().from(strategy_feedback).where(...),
    actions: await db.select().from(actions).where(...)
  }
};
```

**System Prompt Enhancement:**
```javascript
const systemPrompt = `You are Vecto Pilot's AI Companion.

FULL CONTEXT AVAILABLE:
${JSON.stringify(fullContext, null, 2)}

You have access to:
- Real-time location, weather (${fullContext.snapshot.weather.tempF}°F), air quality (AQI ${fullContext.snapshot.air.aqi})
- Airport intel: ${fullContext.snapshot.airport?.name} (${fullContext.snapshot.airport?.driving_status})
- Today's events: ${fullContext.snapshot.newsBriefing?.events || 'None'}
- Traffic updates: ${fullContext.snapshot.newsBriefing?.traffic || 'None'}
- Full strategy from Claude + GPT-5
- ${fullContext.blocks.length} venue recommendations with:
  - Earnings data, drive times, pro tips
  - Event details from Perplexity (concerts, games, festivals)
  - Staging/parking advice
- User's past feedback on venues and strategies

Use this rich context to provide highly personalized, actionable advice.`;
```

---

## Data Field Count Summary

| Source | Current | Available | Missing |
|--------|---------|-----------|---------|
| Snapshot | 5 fields | 31 fields | 26 fields |
| Strategy | 1 field (truncated) | 10 fields (full) | 9 fields |
| Blocks | 3 fields | 25 fields | 22 fields |
| Events | 0 fields | 6 fields | 6 fields |
| Feedback | 0 fields | ~50 records | All |
| News | 0 fields | 2 objects | All |

**Total Available Data Points:** ~100+ fields  
**Currently Using:** ~9 fields  
**Utilization:** **9%** ⚠️

---

## Implementation Priority

### Phase 1: Essential Context (High Impact)
1. ✅ Full weather object (tempF, conditions, description)
2. ✅ Full event data (summary, badge, citations, impact)
3. ✅ News briefing (0:15/0:30/0:45/1:00 intel)
4. ✅ Pro tips & staging advice from blocks

### Phase 2: Intelligence Enrichment
1. ✅ User feedback history (venue preferences)
2. ✅ Action logs (what they actually clicked)
3. ✅ Full earnings data (value_per_min, earnings_per_mile)

### Phase 3: Advanced Personalization
1. ✅ Memory systems integration
2. ✅ Pattern recognition from past sessions
3. ✅ Predictive suggestions based on history

---

## Example Coach Response (Before vs. After)

### BEFORE (Current - 9% Context)
**User:** "Should I go to Legacy Hall?"

**Coach:** "Based on your location in Frisco and the current afternoon timing, Legacy Hall could be a good option. It's a popular venue that typically has activity."

### AFTER (Full Context - 100%)
**User:** "Should I go to Legacy Hall?"

**Coach:** "🎸 ABSOLUTELY! Legacy Hall has TWO events tonight:
- Live Band Karaoke @ 7pm (recurring Thursdays, moderate crowd)
- Hall-O-Ween Bash with Emerald City Band (LARGE crowd expected)

**Why it's perfect right now:**
- 8 min drive (closest venue with events)
- High surge likely ($2.1x estimated)
- Pro tip: Stage in Lexus Box Garden parking (2-min walk to entrance)
- Earnings potential: $18-24/ride during event peak (7-10pm)

**Weather note:** 59°F, perfect for outdoor staging

**Traffic:** No issues on Legacy Drive (checked 60-sec ago)

You gave this venue 👍 last time - matches your preference for event-driven hotspots!"

---

## Next Steps

1. **Enhance chat.js** to fetch full context
2. **Update CoachChat.tsx** to pass full blocks array
3. **Add UI tooltip** showing full eventSummary in blocks
4. **Document in replit.md** with data access policy
5. **Test** coach responses with rich context
