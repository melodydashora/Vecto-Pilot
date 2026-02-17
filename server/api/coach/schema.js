// server/api/coach/schema.js
// Read-only schema metadata for AI Coach prompt injection
// Created: 2026-01-05
//
// This endpoint exposes schema structure to the coach so it understands
// what data it has access to. The metadata is injected into the system prompt.

import { Router } from 'express';

const router = Router();

/**
 * Schema metadata for AI Coach
 *
 * This is a curated view of the database schema that helps the coach
 * understand what data it can access and what actions it can take.
 */
export const coachSchemaMetadata = {
  // Tables the coach can READ
  readable_tables: {
    snapshots: {
      description: "User location sessions with GPS, weather, and context",
      key_columns: ["snapshot_id", "user_id", "city", "state", "timezone", "lat", "lng", "created_at"],
      sample_query: "Get user's recent sessions to understand driving patterns"
    },
    strategies: {
      description: "AI-generated driving strategies for each session",
      key_columns: ["id", "snapshot_id", "consolidated_strategy", "strategy_for_now", "created_at"],
      sample_query: "Get current strategy recommendations"
    },
    briefings: {
      description: "Events, traffic, news, weather briefings",
      key_columns: ["id", "snapshot_id", "events", "traffic_conditions", "news", "weather_current", "weather_forecast"],
      sample_query: "Get today's events and traffic conditions"
    },
    discovered_events: {
      description: "Local events (concerts, sports, festivals, etc.)",
      // 2026-01-15: Fixed column names - renamed from event_date/event_time to event_start_date/event_start_time
      key_columns: ["id", "title", "venue_name", "event_start_date", "event_start_time", "city", "category", "is_active"],
      sample_query: "Find events happening tonight",
      notes: "Use discovered_at for sorting (not created_at)"
    },
    venue_catalog: {
      description: "Venue database with ratings, hours, and pricing",
      key_columns: ["venue_id", "venue_name", "city", "expense_rank", "lat", "lng", "business_hours"],
      sample_query: "Find high-end venues in a neighborhood"
    },
    ranking_candidates: {
      description: "Venue recommendations with ranking scores",
      key_columns: ["id", "snapshot_id", "venue_name", "rank", "features", "distance_mi"],
      sample_query: "Get top-ranked venues for current session"
    },
    market_intelligence: {
      description: "Market-specific intel (surge patterns, best times, etc.)",
      key_columns: ["id", "market_slug", "intel_type", "title", "content", "priority"],
      sample_query: "Get intel for Dallas-TX market"
    },
    zone_intelligence: {
      description: "Crowd-sourced zone knowledge (dead zones, honey holes)",
      key_columns: ["id", "market_slug", "zone_type", "zone_name", "zone_description", "confidence_score"],
      sample_query: "Find known honey holes in this market"
    },
    driver_profiles: {
      description: "Driver's profile, preferences, and home location",
      key_columns: ["id", "user_id", "first_name", "home_city", "home_timezone", "platforms"],
      sample_query: "Get driver's name and home market"
    },
    driver_vehicles: {
      description: "Driver's vehicle information",
      key_columns: ["id", "user_id", "make", "model", "year", "vehicle_type"],
      sample_query: "Check if driver has XL-eligible vehicle"
    },
    user_intel_notes: {
      description: "Coach's saved notes about this driver (memory)",
      key_columns: ["id", "user_id", "note_type", "title", "content", "importance", "is_pinned"],
      sample_query: "Retrieve saved preferences and insights about driver"
    },
    // 2026-02-17: Structured offer intelligence (replaces intercepted_signals JSONB)
    offer_intelligence: {
      description: "Analyst-grade structured ride offer data — every metric is a real indexed column (no JSONB unpacking needed)",
      key_columns: ["id", "device_id", "price", "per_mile", "total_miles", "pickup_minutes", "pickup_address", "dropoff_address", "product_type", "platform", "decision", "decision_reasoning", "confidence_score", "user_override", "driver_lat", "driver_lng", "h3_index", "market", "local_date", "local_hour", "day_part", "is_weekend", "offer_session_id", "offer_sequence_num", "response_time_ms", "created_at"],
      sample_query: "SELECT day_part, AVG(per_mile), COUNT(*) FROM offer_intelligence WHERE platform = 'uber' GROUP BY day_part",
      notes: "No user_id FK — uses device_id (Siri headless). H3 res-8 for geographic clustering. Session tracking (30-min windows) for sequence analysis. offer_override indicates driver disagreed with AI."
    }
  },

  // Tables the coach can WRITE to
  writable_tables: {
    user_intel_notes: {
      description: "Save notes about driver's preferences, tips, and insights",
      action_tag: "[SAVE_NOTE: {...}]",
      fields: {
        note_type: "preference | insight | tip | feedback | pattern | market_update",
        category: "timing | location | strategy | vehicle | earnings | safety (optional)",
        title: "Short title (max 200 chars)",
        content: "Full note content (max 5000 chars)",
        importance: "1-100 (default 50)",
        market_slug: "e.g. dallas-tx (optional)"
      }
    },
    discovered_events: {
      description: "Deactivate or reactivate events",
      action_tags: ["[DEACTIVATE_EVENT: {...}]", "[REACTIVATE_EVENT: {...}]"],
      fields: {
        event_id: "UUID (optional if using title)",
        event_title: "Event name for fuzzy lookup",
        reason: "event_ended | incorrect_time | no_longer_relevant | cancelled | duplicate | other",
        notes: "Additional context (optional)"
      }
    },
    zone_intelligence: {
      description: "Capture crowd-sourced zone knowledge",
      action_tag: "[ZONE_INTEL: {...}]",
      fields: {
        zone_type: "dead_zone | danger_zone | honey_hole | surge_trap | staging_spot | event_zone",
        zone_name: "Human-readable name",
        market_slug: "Required (e.g. dallas-tx)",
        reason: "Why this zone matters",
        time_constraints: "When this applies (optional)",
        address_hint: "Location hint (optional)"
      }
    },
    coach_conversations: {
      description: "Chat history (auto-saved, no action tag needed)",
      notes: "Conversations are automatically persisted"
    },
    coach_system_notes: {
      description: "System observations for developers",
      action_tag: "[SYSTEM_NOTE: {...}]",
      fields: {
        type: "feature_request | pain_point | bug_report | aha_moment",
        category: "ui | strategy | briefing | venues | coach | map | earnings",
        title: "Short description",
        description: "Full details",
        user_quote: "Direct quote if applicable"
      }
    },
    news_deactivations: {
      description: "Hide news items user doesn't want to see",
      action_tag: "[DEACTIVATE_NEWS: {...}]",
      fields: {
        news_title: "Title of news to hide",
        news_source: "Source name (optional)",
        reason: "Why hiding this"
      }
    }
  },

  // Relationships for context
  relationships: [
    "snapshots → strategies (1:N by snapshot_id)",
    "snapshots → briefings (1:1 by snapshot_id)",
    "snapshots → ranking_candidates (1:N by snapshot_id)",
    "venue_catalog → discovered_events (1:N by venue_id)",
    "users → driver_profiles (1:1 by user_id)",
    "users → user_intel_notes (1:N by user_id)"
  ],

  // Data scoping rules
  scoping: {
    user_data: "All user-specific data is filtered by authenticated user_id",
    market_data: "Market intel is accessible for any market (shared knowledge)",
    historical: "Last 10 sessions available via snapshot history"
  }
};

/**
 * GET /api/coach/schema
 * Returns schema metadata for prompt injection
 */
router.get('/', (_req, res) => {
  res.json({
    ok: true,
    schema: coachSchemaMetadata,
    generated_at: new Date().toISOString()
  });
});

/**
 * GET /api/coach/schema/tables
 * Returns just table names and descriptions (compact version)
 */
router.get('/tables', (_req, res) => {
  const tables = {
    readable: Object.entries(coachSchemaMetadata.readable_tables).map(([name, info]) => ({
      name,
      description: info.description
    })),
    writable: Object.entries(coachSchemaMetadata.writable_tables).map(([name, info]) => ({
      name,
      description: info.description,
      action_tag: info.action_tag || info.action_tags?.[0]
    }))
  };

  res.json({ ok: true, tables });
});

/**
 * GET /api/coach/schema/prompt
 * Returns formatted string for system prompt injection
 */
router.get('/prompt', (_req, res) => {
  const prompt = formatSchemaForPrompt(coachSchemaMetadata);
  res.json({ ok: true, prompt });
});

/**
 * Format schema metadata as a prompt-friendly string
 */
export function formatSchemaForPrompt(schema) {
  let prompt = `\n## DATABASE SCHEMA AWARENESS\n\n`;

  prompt += `### Tables You Can READ:\n`;
  for (const [name, info] of Object.entries(schema.readable_tables)) {
    prompt += `- **${name}**: ${info.description}\n`;
    prompt += `  Columns: ${info.key_columns.join(', ')}\n`;
  }

  prompt += `\n### Tables You Can WRITE (via action tags):\n`;
  for (const [name, info] of Object.entries(schema.writable_tables)) {
    const tag = info.action_tag || info.action_tags?.[0] || 'auto-saved';
    prompt += `- **${name}**: ${info.description} → ${tag}\n`;
  }

  prompt += `\n### Data Scoping:\n`;
  prompt += `- User data is filtered by authenticated user_id\n`;
  prompt += `- Market intel is shared across all drivers\n`;
  prompt += `- You have access to the last 10 sessions for cross-session learning\n`;

  return prompt;
}

export default router;
