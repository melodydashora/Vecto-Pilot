// server/lib/coach-dal.js
// AI Strategy Coach Data Access Layer - Read-only, snapshot-scoped access
import { db } from '../db/drizzle.js';
import { snapshots, strategies, ranking_candidates, rankings } from '../../shared/schema.js';
import { eq, desc, and } from 'drizzle-orm';

/**
 * CoachDAL - Read-only data access for AI Strategy Coach
 * 
 * Access contract:
 * - Scoped by user_id and snapshot_id
 * - Read-only (no writes/mutations)
 * - Null-safe reads (missing data returns null, not errors)
 * - Temporal alignment: Trust snapshot day/time as ground truth
 */
export class CoachDAL {
  /**
   * Get header snapshot with timezone, DST, day-of-week, day-part, location display
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
          iso_timestamp: snapshots.local_iso,
          timezone: snapshots.timezone,
          dow: snapshots.dow, // 0=Sunday, 1=Monday, etc.
          hour: snapshots.hour,
          day_part_key: snapshots.day_part_key,
          location_display: snapshots.formatted_address,
          city: snapshots.city,
          state: snapshots.state,
          lat: snapshots.lat,
          lng: snapshots.lng,
          weather: snapshots.weather,
          air: snapshots.air,
          airport_context: snapshots.airport_context,
        })
        .from(snapshots)
        .where(eq(snapshots.snapshot_id, snapshotId))
        .limit(1);

      if (!snap) return null;

      // Enrich with computed fields
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const day_of_week = snap.dow != null ? dayNames[snap.dow] : 'Unknown';
      const is_weekend = snap.dow === 0 || snap.dow === 6;

      return {
        snapshot_id: snap.snapshot_id,
        user_id: snap.user_id,
        iso_timestamp: snap.created_at?.toISOString() || null,
        timezone: snap.timezone || 'America/Chicago',
        day_of_week,
        is_weekend,
        dow: snap.dow,
        hour: snap.hour,
        day_part: snap.day_part_key || 'unknown',
        location_display: snap.location_display || `${snap.city}, ${snap.state}`,
        city: snap.city,
        state: snap.state,
        lat: snap.lat,
        lng: snap.lng,
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
      const [strat] = await db
        .select({
          snapshot_id: strategies.snapshot_id,
          user_id: strategies.user_id,
          consolidated_strategy: strategies.consolidated_strategy,
          minstrategy: strategies.minstrategy,
          holiday: strategies.holiday,
          briefing: strategies.briefing,
          strategy_timestamp: strategies.strategy_timestamp,
          created_at: strategies.created_at,
          user_resolved_address: strategies.user_resolved_address,
          user_resolved_city: strategies.user_resolved_city,
          user_resolved_state: strategies.user_resolved_state,
          model_name: strategies.model_name,
          status: strategies.status,
        })
        .from(strategies)
        .where(eq(strategies.snapshot_id, snapshotId))
        .orderBy(desc(strategies.strategy_timestamp), desc(strategies.created_at))
        .limit(1);

      if (!strat) return null;

      return {
        snapshot_id: strat.snapshot_id,
        user_id: strat.user_id,
        strategy_text: strat.consolidated_strategy || strat.minstrategy || null,
        minstrategy: strat.minstrategy,
        consolidated_strategy: strat.consolidated_strategy,
        strategy_timestamp: strat.strategy_timestamp?.toISOString() || strat.created_at?.toISOString() || null,
        holiday: strat.holiday,
        briefing: strat.briefing || {},
        user_address: strat.user_resolved_address,
        user_city: strat.user_resolved_city,
        user_state: strat.user_resolved_state,
        model_name: strat.model_name,
        status: strat.status,
      };
    } catch (error) {
      console.error('[CoachDAL] getLatestStrategy error:', error);
      return null;
    }
  }

  /**
   * Get briefing data (events, traffic, news, holidays) from strategy JSONB
   * @param {string} snapshotId - Snapshot ID to scope reads
   * @returns {Promise<Object>} Briefing data
   */
  async getBriefing(snapshotId) {
    try {
      const strategy = await this.getLatestStrategy(snapshotId);
      
      if (!strategy || !strategy.briefing) {
        return {
          events: [],
          traffic: [],
          news: [],
          holidays: [],
        };
      }

      const briefing = strategy.briefing;
      return {
        events: briefing.events || [],
        traffic: briefing.traffic || [],
        news: briefing.news || [],
        holidays: briefing.holidays || [],
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
   * Get complete context for AI Coach
   * Combines snapshot, strategy, briefing, and smart blocks
   * @param {string} snapshotId - Snapshot ID to scope reads
   * @returns {Promise<Object>} Complete coach context
   */
  async getCompleteContext(snapshotId) {
    try {
      const [snapshot, strategy, briefing, smartBlocks] = await Promise.all([
        this.getHeaderSnapshot(snapshotId),
        this.getLatestStrategy(snapshotId),
        this.getBriefing(snapshotId),
        this.getSmartBlocks(snapshotId),
      ]);

      return {
        snapshot,
        strategy,
        briefing,
        smartBlocks,
        status: this._determineStatus(snapshot, strategy, briefing, smartBlocks),
      };
    } catch (error) {
      console.error('[CoachDAL] getCompleteContext error:', error);
      return {
        snapshot: null,
        strategy: null,
        briefing: { events: [], traffic: [], news: [], holidays: [] },
        smartBlocks: [],
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
   * Format context for AI prompt
   * Null-safe formatting with clear "pending" states
   * @param {Object} context - Context from getCompleteContext
   * @returns {string} Formatted context string for AI prompt
   */
  formatContextForPrompt(context) {
    const { snapshot, strategy, briefing, smartBlocks, status } = context;

    let prompt = '';

    // Snapshot context (always available if snapshot exists)
    if (snapshot) {
      prompt += `\n\n=== CURRENT CONTEXT ===`;
      prompt += `\nLocation: ${snapshot.city}, ${snapshot.state}`;
      prompt += `\nTime: ${snapshot.day_of_week}, ${snapshot.day_part}`;
      if (snapshot.hour != null) prompt += ` (${snapshot.hour}:00)`;
      if (snapshot.is_weekend) prompt += ` [WEEKEND]`;
      prompt += `\nTimezone: ${snapshot.timezone}`;
      
      if (snapshot.weather) {
        prompt += `\nWeather: ${snapshot.weather.tempF}°F, ${snapshot.weather.conditions || 'N/A'}`;
      }
      
      if (snapshot.air) {
        prompt += `\nAir Quality: AQI ${snapshot.air.aqi} (${snapshot.air.category})`;
      }

      if (snapshot.airport_context) {
        const airports = snapshot.airport_context.airports || [];
        if (airports.length > 0) {
          prompt += `\n\nAirport Conditions (30-mile radius):`;
          airports.slice(0, 2).forEach(a => {
            prompt += `\n- ${a.name} (${a.code}): ${a.distance_miles?.toFixed(1)}mi`;
            if (a.delays) prompt += ` - DELAYS: ${a.delays}`;
            if (a.closures) prompt += ` - CLOSURES: ${a.closures}`;
          });
        }
      }
    }

    // Strategy context
    if (strategy) {
      if (strategy.holiday) {
        prompt += `\n\n🎉 HOLIDAY: ${strategy.holiday}`;
      }

      if (strategy.consolidated_strategy) {
        prompt += `\n\n=== CURRENT STRATEGY ===\n${strategy.consolidated_strategy}`;
      } else if (strategy.minstrategy) {
        prompt += `\n\n=== INITIAL STRATEGY (consolidation pending) ===\n${strategy.minstrategy}`;
      }
    } else {
      prompt += `\n\n⏳ Strategy is generating...`;
    }

    // Briefing data
    if (briefing.news && briefing.news.length > 0) {
      prompt += `\n\n=== RIDESHARE NEWS ===`;
      briefing.news.slice(0, 3).forEach((item, i) => {
        const title = typeof item === 'string' ? item : item.title || item.summary || '';
        prompt += `\n${i + 1}. ${title.substring(0, 150)}`;
      });
    }

    if (briefing.events && briefing.events.length > 0) {
      prompt += `\n\n=== LOCAL EVENTS ===`;
      briefing.events.slice(0, 5).forEach((item, i) => {
        const title = typeof item === 'string' ? item : item.title || item.name || item.summary || '';
        prompt += `\n${i + 1}. ${title}`;
      });
    }

    if (briefing.traffic && briefing.traffic.length > 0) {
      prompt += `\n\n=== TRAFFIC CONDITIONS ===`;
      briefing.traffic.slice(0, 5).forEach((item, i) => {
        const summary = typeof item === 'string' ? item : item.summary || item.note || '';
        prompt += `\n${i + 1}. ${summary}`;
      });
    }

    // Smart blocks
    if (smartBlocks && smartBlocks.length > 0) {
      prompt += `\n\n=== RECOMMENDED LOCATIONS (Top ${Math.min(smartBlocks.length, 6)}) ===`;
      smartBlocks.slice(0, 6).forEach((block, i) => {
        prompt += `\n${i + 1}. ${block.name}`;
        if (block.distance_miles != null) prompt += ` - ${block.distance_miles.toFixed(1)}mi`;
        if (block.drive_minutes != null) prompt += `, ${block.drive_minutes}min`;
        if (block.value_grade) prompt += ` [${block.value_grade} value]`;
        
        if (block.has_event && block.event_summary) {
          prompt += `\n   🎉 EVENT: ${block.event_summary.substring(0, 100)}`;
        }
        
        if (block.pro_tips && block.pro_tips.length > 0) {
          prompt += `\n   💡 ${block.pro_tips[0].substring(0, 100)}`;
        }
      });
    } else if (status === 'pending_blocks') {
      prompt += `\n\n⏳ Location recommendations are being generated...`;
    }

    return prompt;
  }
}

// Export singleton instance
export const coachDAL = new CoachDAL();
