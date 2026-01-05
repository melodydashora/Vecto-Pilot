# Rideshare Algorithm Research

Research findings on rideshare platform algorithmic behaviors that directly inform Vecto Pilot's architecture. This document maps specific platform behaviors to concrete implementation improvements.

> **Context**: iOS and Android require separate solutions for subscription-based services. This research provides the algorithmic intelligence layer that powers both platforms.

## Table of Contents

1. [High-Impact Enhancements](#high-impact-enhancements)
2. [Screenshot Analysis Improvements](#1.-screenshot-analysis-prompt-improvements)
3. [Detection Rules](#2.-new-detection-rules-from-research)
4. [Dead Zone Detection](#3.-enhanced-dead-zone-detection)
5. [Surge Stability Scoring](#4.-new-surge-stability-scoring)
6. [Market-Specific Rate Cards](#5.-market-specific-rate-cards)
7. [Enhanced Recommendations](#6.-enhanced-recommendation-response)
8. [iOS Shortcut Integration](#7.-ios-shortcut-integration)
9. [Implementation Priority](#8.-priority-implementation-order)

---

## High-Impact Enhancements

The research revealed several specific algorithmic behaviors that can directly enhance the architecture:

| Finding | Impact | Priority |
|---------|--------|----------|
| 85% acceptance threshold critical for trip visibility | Catastrophic loss of pings below threshold | P0 |
| Multiple stops detection has specific indicators | #1 profit killer for drivers | P0 |
| Surge recalculates every 3-5 minutes | Actionable real-time intelligence | P1 |
| Market rates vary from $0.12/min to $0.61/min | Completely changes decision economics | P1 |

---

## 1. Screenshot Analysis Prompt Improvements

The current Claude Vision extraction prompt is missing critical fields the research uncovered.

### Current Implementation

```javascript
// CURRENT (basic fields)
text: `Extract rideshare ping information:
  1. Pickup address
  2. Estimated fare range
  3. Time to pickup
  4. Rider rating
  5. Surge indicator
  6. Trip distance
  7. Multiple stops indicator
  8. Platform`
```

### Enhanced Implementation (Research-Based)

```javascript
// ENHANCED (based on research)
text: `Extract ALL visible rideshare ping information:

  CRITICAL FIELDS:
  1. Pickup address (exact text shown)
  2. Estimated fare (exact amount or range)
  3. Time to pickup (minutes)
  4. Trip distance AND duration (both matter)
  5. Rider rating (if hidden, note "NOT SHOWN")

  HIDDEN PROFIT KILLERS:
  6. Message area text - capture EXACTLY what's shown
     (could be: "Multiple Stops", "Long Trip", "45+ min",
      "Toward Destination", or nothing)
  7. Any "+" symbol after trip time (indicates uncertainty)
  8. Fare shown as range vs fixed (ranges = multiple stops likely)

  SURGE INDICATORS:
  9. Surge multiplier OR flat bonus amount
  10. Surge zone color on map (orange/red intensity)

  PLATFORM DETECTION:
  11. Platform (Uber/Lyft) - affects wait time rules
  12. Service tier (UberX/Comfort/XL/Black/Lux)

  Return as JSON with confidence scores per field.`
```

### Key Research Insights

| Field | Why It Matters |
|-------|---------------|
| Message area text | Only ONE message displays - stops notification may be hidden by other messages |
| "+" after trip time | Indicates uncertainty = likely multiple stops or route changes |
| Fare as range | Ranges like "$12-18" strongly indicate multiple stops |
| Service tier | Comfort has 10-min wait grace period vs 2-min for UberX |

---

## 2. New Detection Rules from Research

Specific patterns the decision engine should flag based on research findings.

### Multiple Stops Likelihood Detection

```javascript
// Add to recommendation engine
const RESEARCH_BASED_RULES = {

  // Multiple stops detection (research: only ONE message displays)
  multipleStopsLikelihood: (pingData) => {
    let risk = 0.1; // baseline

    // Fare shown as range = high stop risk
    if (pingData.fare.includes('-') || pingData.fare.includes('$12-$18')) {
      risk += 0.35;
    }

    // Time estimate has "+" = uncertainty = stops
    if (pingData.tripTime.includes('+')) {
      risk += 0.25;
    }

    // Message area shows ANYTHING other than "Long Trip"
    // Research: messages compete, stops notification may be hidden
    if (pingData.messageArea &&
        !pingData.messageArea.includes('Long Trip') &&
        !pingData.messageArea.includes('45+')) {
      risk += 0.20;
    }

    // Residential pickup + evening = errand run
    if (pingData.pickupType === 'residential' &&
        pingData.hour >= 17 && pingData.hour <= 20) {
      risk += 0.15;
    }

    return Math.min(risk, 0.95);
  },
```

### Long Trip Warning Reliability

```javascript
  // Long trip warning manipulation detection
  longTripWarningReliability: (pingData, driverHistory) => {
    // Research: Uber removes warning after multiple declines
    if (driverHistory?.recentDeclines > 3 &&
        !pingData.messageArea?.includes('Long Trip')) {
      return {
        warningMayBeHidden: true,
        reason: "3+ recent declines may have suppressed long trip warning"
      };
    }

    // Research: 45+ min could mean 46 min or 4+ hours
    if (pingData.messageArea?.includes('45+')) {
      return {
        ambiguous: true,
        actualRange: "46 minutes to 4+ hours",
        recommendation: "Check route map for destination hints"
      };
    }

    return { reliable: true };
  },
```

### Acceptance Rate Strategy

```javascript
  // Acceptance rate threshold awareness
  acceptanceRateStrategy: (session) => {
    const rate = session.acceptance_rate;

    // Research: 85% threshold is CRITICAL for trip visibility
    if (rate >= 0.83 && rate < 0.85) {
      return {
        status: "DANGER_ZONE",
        message: "1-2 more declines loses trip visibility",
        recommendation: "Accept next reasonable ping"
      };
    }

    // Research: calculated on last 100 trips now (was 200)
    if (rate >= 0.85 && session.rides_in_window < 100) {
      return {
        status: "BUILDING",
        message: `${100 - session.rides_in_window} more trips until rate stabilizes`,
        safeDeclines: Math.floor((rate - 0.85) * session.rides_in_window)
      };
    }

    // Research: below 50% = dramatically fewer pings
    if (rate < 0.50) {
      return {
        status: "RECOVERY_MODE",
        message: "Accept rate critically low - accept next 10 pings",
        pingQualityExpected: "DEGRADED"
      };
    }

    return {
      status: "HEALTHY",
      safeDeclines: Math.floor((rate - 0.85) * 100)
    };
  }
};
```

---

## 3. Enhanced Dead Zone Detection

The architecture has dead zone detection, but research adds specific trap patterns.

### Dead Zone Pattern Types

```javascript
// Enhanced dead_zone_analysis schema
const DEAD_ZONE_PATTERNS = {

  SUBURB_BLEED: {
    detection: (pickup_h3, destination_h3, time) => {
      const pickupDemand = getH3Demand(pickup_h3);
      const destDemand = getH3Demand(destination_h3);

      // High demand → Low demand = classic trap
      return pickupDemand > 0.7 && destDemand < 0.3;
    },
    deadMileEstimate: (destination_h3) => {
      return getDistanceToNearestSurge(destination_h3);
    },
    recommendation: "DECLINE unless fare covers return dead miles"
  },

  AIRPORT_DUMP: {
    detection: (destination_h3, driverHistory) => {
      const isAirport = AIRPORT_H3_CELLS.includes(destination_h3);
      const hasReturnRide = driverHistory.airportReturnRate;

      // Research: 45min queue wait OR empty return
      return isAirport && hasReturnRide < 0.4;
    },
    queueTimeEstimate: async (airport_code) => {
      // Could integrate with airport queue APIs
      return AIRPORT_QUEUE_ESTIMATES[airport_code] || 30;
    },
    recommendation: (queueTime, fareAmount) => {
      const hourlyIfQueue = fareAmount / (queueTime / 60);
      return hourlyIfQueue > 25 ? "ACCEPT" : "DECLINE - queue economics poor";
    }
  },

  EVENT_SCATTER: {
    detection: (pickup_h3, destination_h3, eventContext) => {
      const nearEvent = eventContext?.ending_soon;
      const destIsSurgeZone = getSurgeStability(destination_h3) > 0.5;

      // Post-event ride to non-surge area = stranded
      return nearEvent && !destIsSurgeZone;
    },
    recommendation: "CAUTION - surge will end before next pickup at destination"
  }
};
```

### Pattern Impact Summary

| Pattern | Detection Signal | Driver Impact |
|---------|------------------|---------------|
| Suburb Bleed | High→Low demand transition | Dead miles back to active area |
| Airport Dump | Airport destination + low return rate | 45min queue or empty return |
| Event Scatter | Event ending + non-surge destination | Stranded after surge ends |

---

## 4. New: Surge Stability Scoring

Research revealed surge zones recalculate every 3-5 minutes. The system should track stability.

### Database Schema

```sql
-- New table for surge tracking
CREATE TABLE surge_observations (
  observation_id UUID PRIMARY KEY,
  h3_cell TEXT NOT NULL,
  observed_at TIMESTAMPTZ DEFAULT NOW(),
  surge_multiplier DECIMAL(3,2),
  surge_amount DECIMAL(6,2), -- flat bonus in some markets
  source TEXT -- 'screenshot' | 'user_report' | 'inference'
);

CREATE INDEX idx_surge_h3_time ON surge_observations(h3_cell, observed_at DESC);
```

### Stability Calculation

```javascript
// Surge stability calculation
async function getSurgeStabilityScore(h3_cell) {
  const observations = await db.query(`
    SELECT surge_multiplier, observed_at
    FROM surge_observations
    WHERE h3_cell = $1
      AND observed_at > NOW() - INTERVAL '30 minutes'
    ORDER BY observed_at DESC
    LIMIT 10
  `, [h3_cell]);

  if (observations.length < 3) {
    return { stability: 0.5, confidence: 'LOW', reason: 'insufficient data' };
  }

  // Calculate variance - low variance = stable surge
  const values = observations.map(o => o.surge_multiplier);
  const variance = calculateVariance(values);

  // Research: surge recalculates every 3-5 min
  // If stable for 15+ min, likely to hold for your trip
  const stability = 1 - Math.min(variance / 0.5, 1);

  return {
    stability,
    trend: values[0] > values[values.length - 1] ? 'RISING' : 'FALLING',
    predictedIn5Min: predictSurge(observations),
    recommendation: stability > 0.7 ?
      "Surge likely to hold" :
      "Surge unstable - may drop before pickup"
  };
}
```

### Stability Thresholds

| Stability Score | Interpretation | Action |
|-----------------|----------------|--------|
| > 0.8 | Very stable | Safe to rely on surge |
| 0.5 - 0.8 | Moderate | Accept quickly before change |
| < 0.5 | Unstable | May drop before you arrive |

---

## 5. Market-Specific Rate Cards

Research shows dramatic pay differences by market. This data informs decision economics.

### Database Schema

```sql
-- New: market_rate_cards table
CREATE TABLE market_rate_cards (
  market_id TEXT PRIMARY KEY,
  market_name TEXT,

  -- Base rates by tier
  uberx_per_mile DECIMAL(4,2),
  uberx_per_minute DECIMAL(4,2),
  comfort_per_mile DECIMAL(4,2),
  comfort_per_minute DECIMAL(4,2),

  -- Wait time rules (CRITICAL - research shows this varies)
  wait_grace_period_uberx INTEGER DEFAULT 2, -- minutes
  wait_grace_period_comfort INTEGER DEFAULT 10,
  wait_per_minute DECIMAL(4,2),

  -- Thresholds
  long_trip_threshold_minutes INTEGER DEFAULT 45,

  -- Regulatory
  has_transparency_law BOOLEAN DEFAULT false,
  minimum_fare DECIMAL(6,2),

  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Sample Market Data

```sql
-- Example data from research
INSERT INTO market_rate_cards VALUES
  ('nyc', 'New York City', 1.41, 0.61, 1.83, 0.61, 2, 10, 0.50, 45, true, 8.00, NOW()),
  ('seattle', 'Seattle', 1.55, 0.66, 2.00, 0.85, 2, 10, 0.55, 45, true, 5.81, NOW()),
  ('dallas', 'Dallas', 0.80, 0.12, 1.00, 0.15, 2, 10, 0.12, 45, false, 3.00, NOW());
```

### Rate Impact Analysis

| Market | Per Mile | Per Minute | Impact |
|--------|----------|------------|--------|
| NYC | $1.41 | $0.61 | Time-heavy trips more profitable |
| Seattle | $1.55 | $0.66 | Balanced, transparency law helps |
| Dallas | $0.80 | $0.12 | Distance-heavy, avoid traffic |

**Key Insight**: Dallas at $0.12/min vs NYC at $0.61/min completely changes whether sitting in traffic is acceptable.

---

## 6. Enhanced Recommendation Response

Updated response format to include research-backed insights.

### Enhanced Response Structure

```javascript
// Enhanced response format
{
  recommendation: "ACCEPT",
  confidence: 0.88,

  // NEW: Research-backed warnings
  algorithmic_insights: {
    acceptance_rate_impact: {
      current: 0.86,
      after_this_decision: 0.865,
      threshold_buffer: "Safe to decline 1 more before losing visibility"
    },

    platform_take_estimate: {
      // Research: 22% of trips match expected pricing
      likely_range: "25-40%",
      warning: "Actual pay may differ from shown fare"
    },

    hidden_costs: {
      wait_time_not_in_fare: true,
      grace_period: "10 min (Comfort)",
      estimated_wait_cost: "$0 if under 10 min"
    }
  },

  // NEW: Pattern detection
  pattern_alerts: [
    {
      pattern: "SUBURB_BLEED",
      detected: false
    },
    {
      pattern: "MULTIPLE_STOPS_LIKELY",
      detected: true,
      confidence: 0.72,
      indicators: ["Fare shown as range", "Residential pickup", "Evening hour"]
    },
    {
      pattern: "SURGE_BAIT",
      detected: false
    }
  ],

  // Existing fields...
  destination_forecast: { /* ... */ },
  risks: { /* ... */ }
}
```

---

## 7. iOS Shortcut Integration

For the clipboard/screenshot workflow on iOS (no App Store required for MVP).

### API Endpoint for iOS Shortcuts

```javascript
// New endpoint for iOS Shortcut integration
// POST /api/ping/analyze-text
app.post('/api/ping/analyze-text', async (req, res) => {
  const {
    ocr_text,        // From iOS "Extract Text from Image"
    session_id,
    driver_location,
    timestamp
  } = req.body;

  // Parse OCR text (less reliable than vision, but faster)
  const pingData = parseOCRText(ocr_text);

  // Enrich and recommend (same pipeline, different input)
  const enriched = await enrichPingContext(pingData, session_id);
  const recommendation = await generateRecommendation(enriched);

  // Return simplified format for Shortcut "Show Result"
  return res.json({
    verdict: recommendation.recommendation, // "ACCEPT" or "DECLINE"
    reason: recommendation.reasoning.primary,
    confidence: recommendation.confidence,
    speak_text: `${recommendation.recommendation}. ${recommendation.reasoning.primary}`
  });
});
```

### OCR Text Parser

```javascript
function parseOCRText(text) {
  // Regex patterns for common ping elements
  const patterns = {
    fare: /\$[\d.]+(?:\s*-\s*\$?[\d.]+)?/,
    time: /(\d+)\s*min/i,
    distance: /([\d.]+)\s*mi/i,
    rating: /(\d\.\d{1,2})\s*★?/,
    surge: /(\d\.\d)x|(\$\d+)\s*surge/i,
    longTrip: /(45|60)\+\s*min|long trip/i,
    multipleStops: /multiple\s*(stops|destinations)/i
  };

  return {
    fare: text.match(patterns.fare)?.[0],
    pickupTime: text.match(patterns.time)?.[1],
    distance: text.match(patterns.distance)?.[1],
    rating: text.match(patterns.rating)?.[1],
    surge: text.match(patterns.surge)?.[0],
    hasLongTripWarning: patterns.longTrip.test(text),
    hasMultipleStops: patterns.multipleStops.test(text),
    raw_text: text
  };
}
```

### iOS Shortcut Workflow

```
1. Screenshot trigger (share sheet or automation)
2. "Extract Text from Image" action
3. "Get Contents of URL" → POST to /api/ping/analyze-text
4. "Show Result" with verdict + speak_text
5. Optional: "Speak Text" for hands-free use
```

---

## 8. Priority Implementation Order

Based on research impact, recommended implementation order:

| Priority | Feature | Research Justification | Effort |
|----------|---------|------------------------|--------|
| **P0** | Acceptance rate tracking with 85% threshold alerts | Losing trip visibility is catastrophic | Medium |
| **P0** | Multiple stops detection (fare range, message area analysis) | #1 profit killer per driver experience | Medium |
| **P0** | iOS Shortcut text endpoint | Enables MVP without App Store | Low |
| **P1** | Market-specific rate cards | $0.12/min vs $0.61/min changes everything | Low |
| **P1** | Dead zone pattern detection | Predictable with H3 + historical data | High |
| **P1** | Surge stability scoring | 3-5 min recalculation = actionable | Medium |
| **P2** | Long trip warning reliability scoring | Helps but less critical | Low |
| **P2** | Platform take rate estimates | Informational, can't act on it | Low |

### Implementation Dependencies

```
P0 Items (Parallel)
├── Acceptance rate tracking (independent)
├── Multiple stops detection (independent)
└── iOS Shortcut endpoint (independent)

P1 Items (After P0)
├── Market rate cards (needs acceptance tracking)
├── Dead zone detection (needs rate cards)
└── Surge stability (independent)

P2 Items (After P1)
├── Long trip reliability (needs pattern base)
└── Take rate estimates (needs rate cards)
```

---

## Platform-Specific Considerations

### iOS vs Android Separation

| Capability | iOS Approach | Android Approach |
|------------|--------------|------------------|
| Screenshot capture | Shortcut automation | Accessibility service |
| Text extraction | Native OCR action | ML Kit or Tesseract |
| API calls | "Get Contents of URL" | OkHttp/Retrofit |
| Result display | Notification/Widget | Overlay/Notification |
| Background processing | Limited (shortcuts) | Full (foreground service) |

### Why Separate Solutions

1. **iOS Shortcuts** provide no-App-Store MVP capability
2. **Android** requires published app for accessibility permissions
3. Different **monetization rules** on each platform
4. **User behavior differs** - iOS users more Shortcut-savvy

---

## Related Documentation

- [Strategy Framework](../architecture/strategy-framework.md) - Where these rules integrate
- [Database Schema](../architecture/database-schema.md) - Schema additions
- [API Reference](../architecture/api-reference.md) - New endpoints
- [Mobile Subscription Architecture](mobile-subscription-architecture.md) - Platform-specific details
