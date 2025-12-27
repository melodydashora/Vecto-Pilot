// server/lib/coach-dal.js
// AI Strategy Coach Data Access Layer - Full Schema Read Access
import { db } from '../../db/drizzle.js';
import {
  snapshots,
  strategies,
  ranking_candidates,
  rankings,
  briefings,
  venue_feedback,
  strategy_feedback,
  venue_catalog,
  venue_metrics,
  actions,
  users
} from '../../../shared/schema.js';
import { eq, desc, and } from 'drizzle-orm';

/**
 * CoachDAL - Full schema read access for AI Strategy Coach
 * 
 * Entry Point: strategy_id (visible on UI)
 * Access Pattern: strategy_id → snapshot_id → user_id + session_id → ALL tables
 * 
 * Access contract:
 * - Scoped by user_id and snapshot_id (waterfall tracking)
 * - Full read access to entire schema (no mutations)
 * - Null-safe reads (missing data returns null, not errors)
 * - Temporal alignment: Trust snapshot day/time as ground truth
 */
export class CoachDAL {
  /**
   * Resolve strategy_id to snapshot_id + user_id (entry point)
   * @param {string} strategyId - Strategy ID from UI
   * @returns {Promise<Object|null>} {snapshot_id, user_id, session_id} or null
   */
  async resolveStrategyToSnapshot(strategyId) {
    try {
      const [strat] = await db
        .select({
          snapshot_id: strategies.snapshot_id,
          user_id: strategies.user_id,
          strategy_id: strategies.strategy_id
        })
        .from(strategies)
        .where(eq(strategies.strategy_id, strategyId))
        .limit(1);

      if (!strat) return null;

      // Get session_id from snapshot
      const [snap] = await db
        .select({ session_id: snapshots.session_id })
        .from(snapshots)
        .where(eq(snapshots.snapshot_id, strat.snapshot_id))
        .limit(1);

      return {
        snapshot_id: strat.snapshot_id,
        user_id: strat.user_id,
        session_id: snap?.session_id || null,
        strategy_id: strat.strategy_id
      };
    } catch (error) {
      console.error('[CoachDAL] resolveStrategyToSnapshot error:', error);
      return null;
    }
  }
  /**
   * Get header snapshot with timezone, DST, day-of-week, day-part, location display
   * Location data is pulled from users table (authoritative source)
   * @param {string} snapshotId - Snapshot ID to scope reads
   * @returns {Promise<Object|null>} Snapshot context or null
   */
  async getHeaderSnapshot(snapshotId) {
    try {
      const [snap] = await db
        .select({
          snapshot_id: snapshots.snapshot_id,
          user_id: snapshots.user_id,
          created_at: snapshots.created_at,
          weather: snapshots.weather,
          air: snapshots.air,
          airport_context: snapshots.airport_context,
          // TIME CONTEXT - READ FROM SNAPSHOT (authoritative)
          dow: snapshots.dow,
          hour: snapshots.hour,
          day_part_key: snapshots.day_part_key,
          timezone: snapshots.timezone,
          // LOCATION FROM SNAPSHOT
          lat: snapshots.lat,
          lng: snapshots.lng,
          city: snapshots.city,
          state: snapshots.state,
          formatted_address: snapshots.formatted_address,
        })
        .from(snapshots)
        .where(eq(snapshots.snapshot_id, snapshotId))
        .limit(1);

      if (!snap) return null;

      // Fetch user location data (for current coordinates if they've moved)
      let userData = null;
      if (snap.user_id) {
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.user_id, snap.user_id))
          .limit(1);
        userData = user;
      }

      // Build context: Snapshot is ground truth for time/location, user table for current position
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dow = snap.dow ?? 0;
      const day_of_week = dow != null ? dayNames[dow] : 'Unknown';
      const is_weekend = dow === 0 || dow === 6;

      return {
        snapshot_id: snap.snapshot_id,
        user_id: snap.user_id,
        iso_timestamp: snap.created_at?.toISOString() || null,
        timezone: snap.timezone || 'America/Chicago',
        day_of_week,
        is_weekend,
        dow: dow,
        hour: snap.hour ?? 0,
        day_part: snap.day_part_key || 'unknown',
        location_display: snap.formatted_address || `${snap.city || 'Unknown'}, ${snap.state || ''}`,
        city: snap.city || 'Unknown',
        state: snap.state || '',
        lat: userData?.new_lat ?? userData?.lat ?? snap.lat,
        lng: userData?.new_lng ?? userData?.lng ?? snap.lng,
        weather: snap.weather,
        air: snap.air,
        airport_context: snap.airport_context,
      };
    } catch (error) {
      console.error('[CoachDAL] getHeaderSnapshot error:', error);
      return null;
    }
  }

  /**
   * Get latest strategy for snapshot
   * @param {string} snapshotId - Snapshot ID to scope reads
   * @returns {Promise<Object|null>} Strategy data or null
   */
  async getLatestStrategy(snapshotId) {
    try {
      // Fetch strategy and snapshot together (location/time context now in snapshot)
      const [strat] = await db
        .select({
          snapshot_id: strategies.snapshot_id,
          user_id: strategies.user_id,
          consolidated_strategy: strategies.consolidated_strategy,
          strategy_for_now: strategies.strategy_for_now,
          strategy_timestamp: strategies.strategy_timestamp,
          created_at: strategies.created_at,
          model_name: strategies.model_name,
          status: strategies.status,
        })
        .from(strategies)
        .where(eq(strategies.snapshot_id, snapshotId))
        .orderBy(desc(strategies.strategy_timestamp), desc(strategies.created_at))
        .limit(1);

      if (!strat) return null;

      // Fetch snapshot for location/holiday context
      const [snapshot] = await db
        .select({
          formatted_address: snapshots.formatted_address,
          city: snapshots.city,
          state: snapshots.state,
          holiday: snapshots.holiday,
        })
        .from(snapshots)
        .where(eq(snapshots.snapshot_id, snapshotId))
        .limit(1);

      return {
        snapshot_id: strat.snapshot_id,
        user_id: strat.user_id,
        strategy_text: strat.consolidated_strategy || strat.strategy_for_now || null,
        strategy_for_now: strat.strategy_for_now,
        consolidated_strategy: strat.consolidated_strategy,
        strategy_timestamp: strat.strategy_timestamp?.toISOString() || strat.created_at?.toISOString() || null,
        holiday: snapshot?.holiday || null,
        user_address: snapshot?.formatted_address || null,
        user_city: snapshot?.city || null,
        user_state: snapshot?.state || null,
        model_name: strat.model_name,
        status: strat.status,
      };
    } catch (error) {
      console.error('[CoachDAL] getLatestStrategy error:', error);
      return null;
    }
  }

  /**
   * Get comprehensive briefing from briefings table
   * NOTE: Briefing data is stored in separate `briefings` table, NOT in strategies table
   * @param {string} snapshotId - Snapshot ID to scope reads
   * @returns {Promise<Object>} Complete briefing data
   */
  async getComprehensiveBriefing(snapshotId) {
    try {
      // Get briefing from briefings table (the ONLY source for briefing data)
      const [briefingRecord] = await db
        .select()
        .from(briefings)
        .where(eq(briefings.snapshot_id, snapshotId))
        .limit(1);

      if (!briefingRecord) {
        return {
          events: [],
          traffic: [],
          news: [],
        };
      }

      return {
        // Events, news, traffic from briefings table
        events: briefingRecord.events || [],
        traffic: briefingRecord.traffic_conditions || {},
        news: briefingRecord.news || { items: [] },
        school_closures: briefingRecord.school_closures || [],
        // Structured API data
        weather_current: briefingRecord.weather_current || null,
        weather_forecast: briefingRecord.weather_forecast || null,
        traffic_conditions: briefingRecord.traffic_conditions || null,
        briefing_news: briefingRecord.news || null,
        briefing_events: briefingRecord.events || null,
      };
    } catch (error) {
      console.error('[CoachDAL] getComprehensiveBriefing error:', error);
      return {};
    }
  }

  /**
   * Get feedback data (venue + strategy feedback)
   * @param {string} snapshotId - Snapshot ID to scope reads
   * @returns {Promise<Object>} Feedback data
   */
  async getFeedback(snapshotId) {
    try {
      const [venueFeedback, strategyFeedback] = await Promise.all([
        db.select()
          .from(venue_feedback)
          .where(eq(venue_feedback.snapshot_id, snapshotId)),
        db.select()
          .from(strategy_feedback)
          .where(eq(strategy_feedback.snapshot_id, snapshotId))
      ]);

      return {
        venue_feedback: venueFeedback || [],
        strategy_feedback: strategyFeedback || [],
      };
    } catch (error) {
      console.error('[CoachDAL] getFeedback error:', error);
      return { venue_feedback: [], strategy_feedback: [] };
    }
  }

  /**
   * Get venue data (catalog + metrics for recommended locations)
   * @param {string} snapshotId - Snapshot ID to scope reads (via ranking_candidates)
   * @returns {Promise<Object>} Venue catalog + metrics
   */
  async getVenueData(snapshotId) {
    try {
      // Get all venues from ranking_candidates for this snapshot
      const candidates = await db
        .select()
        .from(ranking_candidates)
        .where(eq(ranking_candidates.snapshot_id, snapshotId));

      if (candidates.length === 0) return { candidates_count: 0, place_ids: [], venues: [] };

      // Get place_ids
      const placeIds = [...new Set(candidates.map(c => c.place_id).filter(Boolean))];

      if (placeIds.length === 0) return { candidates_count: 0, place_ids: [], venues: [] };

      // Get venue catalog data using IN operator
      const { inArray } = await import('drizzle-orm');
      const venues = await db
        .select()
        .from(venue_catalog)
        .where(inArray(venue_catalog.place_id, placeIds));

      return {
        candidates_count: candidates.length,
        place_ids: placeIds,
        venues: venues || [],
      };
    } catch (error) {
      console.error('[CoachDAL] getVenueData error:', error);
      return { candidates_count: 0, place_ids: [], venues: [] };
    }
  }

  /**
   * Get driver actions for this snapshot (dwell times, selections)
   * @param {string} snapshotId - Snapshot ID to scope reads
   * @returns {Promise<Array>} Actions taken
   */
  async getActions(snapshotId) {
    try {
      const driverActions = await db
        .select()
        .from(actions)
        .where(eq(actions.snapshot_id, snapshotId));

      return driverActions || [];
    } catch (error) {
      console.error('[CoachDAL] getActions error:', error);
      return [];
    }
  }

  /**
   * Get briefing data (events, traffic, news, holidays) from briefings table
   * NOTE: Briefing data is in separate `briefings` table, NOT in strategies table
   * @param {string} snapshotId - Snapshot ID to scope reads
   * @returns {Promise<Object>} Briefing data
   */
  async getBriefing(snapshotId) {
    try {
      const [briefingRecord] = await db
        .select()
        .from(briefings)
        .where(eq(briefings.snapshot_id, snapshotId))
        .limit(1);

      if (!briefingRecord) {
        return {
          events: [],
          traffic: [],
          news: [],
          holidays: [],
        };
      }

      return {
        events: briefingRecord.events || [],
        traffic: briefingRecord.traffic_conditions || {},
        news: briefingRecord.news || { items: [] },
        holidays: briefingRecord.holidays || [],
        school_closures: briefingRecord.school_closures || [],
      };
    } catch (error) {
      console.error('[CoachDAL] getBriefing error:', error);
      return {
        events: [],
        traffic: [],
        news: [],
        holidays: [],
      };
    }
  }

  /**
   * Get smart blocks (location cards with navigation metadata)
   * @param {string} snapshotId - Snapshot ID to scope reads
   * @returns {Promise<Array>} Array of smart blocks
   */
  async getSmartBlocks(snapshotId) {
    try {
      // Find ranking for this snapshot
      const [ranking] = await db
        .select()
        .from(rankings)
        .where(eq(rankings.snapshot_id, snapshotId))
        .limit(1);

      if (!ranking) {
        return [];
      }

      // Get candidates for this ranking
      const candidates = await db
        .select({
          name: ranking_candidates.name,
          lat: ranking_candidates.lat,
          lng: ranking_candidates.lng,
          place_id: ranking_candidates.place_id,
          distance_miles: ranking_candidates.distance_miles,
          drive_minutes: ranking_candidates.drive_minutes,
          value_per_min: ranking_candidates.value_per_min,
          value_grade: ranking_candidates.value_grade,
          not_worth: ranking_candidates.not_worth,
          pro_tips: ranking_candidates.pro_tips,
          closed_reasoning: ranking_candidates.closed_reasoning,
          staging_tips: ranking_candidates.staging_tips,
          business_hours: ranking_candidates.business_hours,
          venue_events: ranking_candidates.venue_events,
          rank: ranking_candidates.rank,
        })
        .from(ranking_candidates)
        .where(eq(ranking_candidates.ranking_id, ranking.ranking_id))
        .orderBy(ranking_candidates.rank);

      return candidates.map(c => ({
        name: c.name,
        coordinates: { lat: c.lat, lng: c.lng },
        placeId: c.place_id,
        distance_miles: c.distance_miles,
        drive_minutes: c.drive_minutes,
        value_per_min: c.value_per_min,
        value_grade: c.value_grade,
        not_worth: c.not_worth,
        pro_tips: c.pro_tips || [],
        closed_reasoning: c.closed_reasoning,
        staging_tips: c.staging_tips,
        business_hours: c.business_hours,
        event_badge: c.venue_events?.badge,
        event_summary: c.venue_events?.summary,
        has_event: c.venue_events?.has_events || false,
        rank: c.rank,
      }));
    } catch (error) {
      console.error('[CoachDAL] getSmartBlocks error:', error);
      return [];
    }
  }

  /**
   * Get complete context for AI Coach - Full schema access
   * Combines snapshot, strategy, briefing, smart blocks, feedback, and venue data
   * 
   * Entry points:
   * - snapshotId: Direct snapshot access
   * - strategyId: Via strategy_id → snapshot_id resolution
   * 
   * @param {string} snapshotId - Snapshot ID to scope reads
   * @param {string} strategyId - Alternative entry point (strategy_id from UI)
   * @returns {Promise<Object>} Complete coach context with full schema access
   */
  async getCompleteContext(snapshotId, strategyId) {
    try {
      // Resolve strategy_id to snapshot_id if needed
      let activeSnapshotId = snapshotId;
      if (!activeSnapshotId && strategyId) {
        const resolution = await this.resolveStrategyToSnapshot(strategyId);
        if (!resolution) {
          console.warn('[CoachDAL] Could not resolve strategy_id:', strategyId);
          return {
            snapshot: null,
            strategy: null,
            briefing: {},
            smartBlocks: [],
            feedback: { venue_feedback: [], strategy_feedback: [] },
            venueData: [],
            actions: [],
            status: 'invalid_strategy_id',
          };
        }
        activeSnapshotId = resolution.snapshot_id;
      }

      // Fetch all schema data in parallel
      const [
        snapshot,
        strategy,
        briefing,
        smartBlocks,
        feedback,
        venueData,
        driverActions
      ] = await Promise.all([
        this.getHeaderSnapshot(activeSnapshotId),
        this.getLatestStrategy(activeSnapshotId),
        this.getComprehensiveBriefing(activeSnapshotId),
        this.getSmartBlocks(activeSnapshotId),
        this.getFeedback(activeSnapshotId),
        this.getVenueData(activeSnapshotId),
        this.getActions(activeSnapshotId),
      ]);

      return {
        snapshot,
        strategy,
        briefing,
        smartBlocks,
        feedback,
        venueData,
        actions: driverActions,
        status: this._determineStatus(snapshot, strategy, briefing, smartBlocks),
      };
    } catch (error) {
      console.error('[CoachDAL] getCompleteContext error:', error);
      return {
        snapshot: null,
        strategy: null,
        briefing: {},
        smartBlocks: [],
        feedback: { venue_feedback: [], strategy_feedback: [] },
        venueData: [],
        actions: [],
        status: 'error',
      };
    }
  }

  /**
   * Determine context readiness status
   * @private
   */
  _determineStatus(snapshot, strategy, briefing, smartBlocks) {
    if (!snapshot) return 'missing_snapshot';
    if (!strategy) return 'pending_strategy';
    if (!strategy.consolidated_strategy) return 'pending_consolidation';
    if (smartBlocks.length === 0) return 'pending_blocks';
    return 'ready';
  }

  /**
   * Format context for AI prompt - FULL SCHEMA ACCESS
   * All available data organized by category for the Coach
   * @param {Object} context - Context from getCompleteContext
   * @returns {string} Formatted context string for AI prompt
   */
  formatContextForPrompt(context) {
    const {
      snapshot,
      strategy,
      briefing,
      smartBlocks,
      feedback,
      venueData,
      actions,
      status
    } = context;

    let prompt = '';

    // ========== SNAPSHOT DATA (Location, Time, Weather, Air Quality) ==========
    if (snapshot) {
      prompt += `\n\n=== CURRENT LOCATION & TIME CONTEXT ===`;
      prompt += `\n📍 Location: ${snapshot.location_display || `${snapshot.city}, ${snapshot.state}`}`;
      prompt += `\n   Coordinates: ${snapshot.lat?.toFixed(4)}, ${snapshot.lng?.toFixed(4)}`;
      prompt += `\n🕐 Time: ${snapshot.day_of_week}, ${snapshot.day_part}`;
      if (snapshot.hour != null) prompt += ` (${snapshot.hour}:00)`;
      if (snapshot.is_weekend) prompt += ` [WEEKEND]`;
      prompt += `\n🌍 Timezone: ${snapshot.timezone}`;

      // Weather
      if (snapshot.weather) {
        prompt += `\n\n🌤️  WEATHER CONDITIONS`;
        prompt += `\n   Temperature: ${snapshot.weather.tempF || snapshot.weather.temp || 'N/A'}°F`;
        prompt += `\n   Conditions: ${snapshot.weather.conditions || snapshot.weather.condition || 'N/A'}`;
        if (snapshot.weather.windSpeed) prompt += `\n   Wind: ${snapshot.weather.windSpeed} mph`;
      }

      // Air Quality
      if (snapshot.air) {
        prompt += `\n\n💨 AIR QUALITY`;
        prompt += `\n   AQI: ${snapshot.air.aqi || 'N/A'} (${snapshot.air.category || 'N/A'})`;
        if (snapshot.air.pollutants) prompt += `\n   Pollutants: ${JSON.stringify(snapshot.air.pollutants).substring(0, 100)}`;
      }

      // Airport Conditions
      if (snapshot.airport_context?.airports && snapshot.airport_context.airports.length > 0) {
        prompt += `\n\n✈️  AIRPORT CONDITIONS (30-mile radius)`;
        snapshot.airport_context.airports.slice(0, 3).forEach(a => {
          prompt += `\n   ${a.name || 'Unknown'} (${a.code || 'N/A'}): ${a.distance_miles?.toFixed(1) || 'N/A'}mi`;
          if (a.delays) prompt += ` - DELAYS: ${a.delays}`;
          if (a.closures) prompt += ` - CLOSURES: ${a.closures}`;
        });
      }

      // Holiday
      if (snapshot.holiday || snapshot.is_holiday) {
        prompt += `\n\n🎉 SPECIAL DATE: ${snapshot.holiday || 'Holiday'} (surge likely)`;
      }
    }

    // ========== STRATEGY & CONSOLIDATION ==========
    if (strategy) {
      if (strategy.consolidated_strategy) {
        prompt += `\n\n=== AI-GENERATED DAILY STRATEGY (8-12hr) ===\n${strategy.consolidated_strategy}`;
      }
      if (strategy.strategy_for_now) {
        prompt += `\n\n=== IMMEDIATE STRATEGY (Next 1hr) ===\n${strategy.strategy_for_now}`;
      }
    } else if (status === 'pending_strategy') {
      prompt += `\n\n⏳ AI strategy is generating...`;
    }

    // ========== COMPREHENSIVE BRIEFING (API Data + Perplexity + GPT-5) ==========
    if (briefing && Object.keys(briefing).length > 0) {
      // REAL-TIME API DATA
      if (briefing.weather_current) {
        prompt += `\n\n🌤️  REAL-TIME WEATHER (from Google Weather API)`;
        const w = briefing.weather_current;
        prompt += `\n   Current: ${w.temperature?.degrees || 'N/A'}°${w.temperature?.unit === 'FAHRENHEIT' ? 'F' : 'C'}`;
        prompt += `\n   Conditions: ${w.conditions || 'N/A'}`;
        if (w.humidity) prompt += `\n   Humidity: ${w.humidity}%`;
        if (w.windSpeed) prompt += `\n   Wind: ${w.windSpeed.value || 'N/A'} ${w.windSpeed.unit || 'mph'}`;
      }

      if (briefing.weather_forecast?.length > 0) {
        prompt += `\n   Forecast (next 6h): `;
        briefing.weather_forecast.slice(0, 3).forEach((h, i) => {
          const temp = h.temperature?.degrees || 'N/A';
          prompt += `${i > 0 ? ' | ' : ''}${temp}° `;
        });
      }

      if (briefing.traffic_conditions) {
        prompt += `\n\n🚗 REAL-TIME TRAFFIC CONDITIONS`;
        prompt += `\n   Level: ${briefing.traffic_conditions.congestionLevel || 'N/A'}`;
        prompt += `\n   Summary: ${briefing.traffic_conditions.summary || 'N/A'}`;
        if (briefing.traffic_conditions.incidents?.length > 0) {
          prompt += `\n   Incidents (${briefing.traffic_conditions.incidents.length}):`;
          briefing.traffic_conditions.incidents.slice(0, 2).forEach(inc => {
            prompt += `\n     - ${inc.description?.substring(0, 80) || 'Unknown'}`;
          });
        }
      }

      if (briefing.briefing_news?.items?.length > 0 || briefing.briefing_news?.filtered?.length > 0) {
        prompt += `\n\n📰 RIDESHARE NEWS & EVENTS (from SerpAPI + Gemini)`;
        const newsItems = briefing.briefing_news.filtered || briefing.briefing_news.items || [];
        newsItems.slice(0, 3).forEach((item, i) => {
          prompt += `\n   ${i + 1}. ${item.title?.substring(0, 100) || 'Unknown'}`;
          if (item.impact) prompt += ` [${item.impact}]`;
          if (item.summary) prompt += `\n      ${item.summary.substring(0, 100)}...`;
        });
      }

      if (briefing.briefing_events?.length > 0) {
        prompt += `\n\n🎉 LOCAL EVENTS (concerts, games, parades, etc.)`;
        briefing.briefing_events.slice(0, 3).forEach((evt, i) => {
          const name = typeof evt === 'string' ? evt : evt.name || evt.title || 'Unknown';
          prompt += `\n   ${i + 1}. ${name.substring(0, 80)}`;
        });
      }

    }

    // ========== SMART BLOCKS (Location Recommendations) ==========
    if (smartBlocks && smartBlocks.length > 0) {
      prompt += `\n\n📍 RECOMMENDED LOCATIONS (Top ${Math.min(smartBlocks.length, 6)})`;
      smartBlocks.slice(0, 6).forEach((block, i) => {
        prompt += `\n   ${i + 1}. ${block.name}`;
        if (block.distance_miles != null) prompt += ` - ${block.distance_miles.toFixed(1)}mi`;
        if (block.drive_minutes != null) prompt += `, ${block.drive_minutes}min`;
        if (block.value_grade) prompt += ` [${block.value_grade} value]`;

        if (block.has_event && block.event_summary) {
          prompt += `\n       🎉 EVENT: ${block.event_summary.substring(0, 80)}`;
        }

        if (block.pro_tips?.length > 0) {
          prompt += `\n       💡 Tip: ${block.pro_tips[0].substring(0, 80)}`;
        }
      });
    } else if (status === 'pending_blocks') {
      prompt += `\n\n⏳ Location recommendations are being generated...`;
    }

    // ========== FEEDBACK DATA (Cross-driver learning) ==========
    if (feedback && (feedback.venue_feedback?.length > 0 || feedback.strategy_feedback?.length > 0)) {
      prompt += `\n\n👍 DRIVER FEEDBACK (Community)`;
      if (feedback.venue_feedback?.length > 0) {
        const thumbsUp = feedback.venue_feedback.filter(f => f.sentiment === 'up').length;
        const thumbsDown = feedback.venue_feedback.filter(f => f.sentiment === 'down').length;
        prompt += `\n   Venue Votes: ${thumbsUp} up, ${thumbsDown} down`;
      }
      if (feedback.strategy_feedback?.length > 0) {
        const thumbsUp = feedback.strategy_feedback.filter(f => f.sentiment === 'up').length;
        const thumbsDown = feedback.strategy_feedback.filter(f => f.sentiment === 'down').length;
        prompt += `\n   Strategy Votes: ${thumbsUp} up, ${thumbsDown} down`;
      }
    }

    // ========== DRIVER ACTIONS (Session history) ==========
    if (actions && actions.length > 0) {
      const dwell = actions.find(a => a.dwell_ms);
      if (dwell) {
        prompt += `\n\n⏱️  SESSION ACTIVITY`;
        prompt += `\n   Last action dwell: ${(dwell.dwell_ms / 1000).toFixed(1)}s`;
      }
    }

    // ========== DATA AVAILABILITY SUMMARY ==========
    prompt += `\n\n📋 DATA ACCESS SUMMARY`;
    prompt += `\n   ✓ Snapshot: ${snapshot ? 'Complete' : 'Unavailable'}`;
    prompt += `\n   ✓ Strategy: ${strategy ? (strategy.consolidated_strategy ? 'Ready' : 'In Progress') : 'Pending'}`;
    prompt += `\n   ✓ Briefing: ${briefing && Object.keys(briefing).length > 0 ? 'Complete' : 'Unavailable'}`;
    prompt += `\n   ✓ Smart Blocks: ${smartBlocks?.length || 0} venues`;
    prompt += `\n   ✓ Feedback: ${feedback?.venue_feedback?.length || 0} venue votes`;
    prompt += `\n   ✓ Actions: ${actions?.length || 0} recorded`;
    prompt += `\n   Status: ${status}`;

    return prompt;
  }
}

// Export singleton instance
export const coachDAL = new CoachDAL();
