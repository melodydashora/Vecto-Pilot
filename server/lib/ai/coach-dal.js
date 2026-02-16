// server/lib/coach-dal.js
// AI Strategy Coach Data Access Layer - Full Schema Read/Write Access
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
  users,
  market_intelligence,
  user_intel_notes,
  platform_data,
  driver_profiles,
  driver_vehicles,
  discovered_events,
  coach_conversations,
  coach_system_notes,
  news_deactivations,
  zone_intelligence,
  intercepted_signals   // 2026-02-16: Offer analysis history for coach context
} from '../../../shared/schema.js';
import { eq, desc, and, or, sql, isNull, gte, inArray, asc, lte } from 'drizzle-orm';
import crypto from 'crypto';

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
      // 2026-01-14: FIX - Use 'id' instead of dropped 'strategy_id' column
      const [strat] = await db
        .select({
          id: strategies.id,
          snapshot_id: strategies.snapshot_id,
          user_id: strategies.user_id
        })
        .from(strategies)
        .where(eq(strategies.id, strategyId))
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
        strategy_id: strat.id  // Return id as strategy_id for backwards compatibility
      };
    } catch (error) {
      console.error('[CoachDAL] resolveStrategyToSnapshot error:', error);
      return null;
    }
  }
  /**
   * Get header snapshot with timezone, DST, day-of-week, day-part, location display
   * Location data is pulled from snapshots table (authoritative source)
   * 2026-01-10: Fixed comment - users table has no location data (per SAVE-IMPORTANT.md)
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
          // 2026-01-14: airport_context dropped - now in briefings.airport_conditions
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

      // NO FALLBACK - timezone is required for accurate coach context
      if (!snap.timezone) {
        console.warn('[CoachDAL] Snapshot missing timezone - coach context may be inaccurate');
      }
      return {
        snapshot_id: snap.snapshot_id,
        user_id: snap.user_id,
        iso_timestamp: snap.created_at?.toISOString() || null,
        timezone: snap.timezone || null,  // NO FALLBACK - let consumer handle missing timezone
        day_of_week,
        is_weekend,
        dow: dow,
        hour: snap.hour ?? 0,
        day_part: snap.day_part_key || 'unknown',
        location_display: snap.formatted_address || `${snap.city || 'Unknown'}, ${snap.state || ''}`,
        city: snap.city || null,
        state: snap.state || null,
        lat: userData?.new_lat ?? userData?.lat ?? snap.lat,
        lng: userData?.new_lng ?? userData?.lng ?? snap.lng,
        weather: snap.weather,
        air: snap.air,
        // 2026-01-14: airport_context dropped - get from briefings.airport_conditions if needed
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
      // 2026-01-14: FIX - Removed strategy_timestamp and model_name (columns dropped)
      // Use created_at for ordering instead
      const [strat] = await db
        .select({
          snapshot_id: strategies.snapshot_id,
          user_id: strategies.user_id,
          consolidated_strategy: strategies.consolidated_strategy,
          strategy_for_now: strategies.strategy_for_now,
          created_at: strategies.created_at,
          status: strategies.status,
        })
        .from(strategies)
        .where(eq(strategies.snapshot_id, snapshotId))
        .orderBy(desc(strategies.created_at))
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

      // 2026-01-14: Lean strategies table - removed strategy_timestamp and model_name columns
      return {
        snapshot_id: strat.snapshot_id,
        user_id: strat.user_id,
        strategy_text: strat.consolidated_strategy || strat.strategy_for_now || null,
        strategy_for_now: strat.strategy_for_now,
        consolidated_strategy: strat.consolidated_strategy,
        strategy_timestamp: strat.created_at?.toISOString() || null,  // Use created_at as canonical timestamp
        holiday: snapshot?.holiday || null,
        user_address: snapshot?.formatted_address || null,
        user_city: snapshot?.city || null,
        user_state: snapshot?.state || null,
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
   * Get briefing data (events, traffic, news) from briefings table
   * NOTE: Briefing data is in separate `briefings` table, NOT in strategies table
   * NOTE: Holiday info is in snapshots table (holiday, is_holiday), not briefings
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
        };
      }

      // 2026-01-14: Removed holidays (column dropped in 20251209_drop_unused_briefing_columns.sql)
      // Holiday info is now in snapshots table (holiday, is_holiday)
      return {
        events: briefingRecord.events || [],
        traffic: briefingRecord.traffic_conditions || {},
        news: briefingRecord.news || { items: [] },
        school_closures: briefingRecord.school_closures || [],
      };
    } catch (error) {
      console.error('[CoachDAL] getBriefing error:', error);
      return {
        events: [],
        traffic: [],
        news: [],
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
   * Get market intelligence for the user's location
   * Includes universal intel + market-specific intel
   * @param {string} city - City name
   * @param {string} state - State name
   * @param {string} platform - Platform filter ('uber', 'lyft', 'both')
   * @returns {Promise<Object>} Market intelligence data
   */
  async getMarketIntelligence(city, state, platform = 'both') {
    try {
      if (!city || !state) {
        return { marketPosition: null, intelligence: [], userNotes: [] };
      }

      // First, look up the market for this city
      const [cityData] = await db
        .select({
          market_anchor: platform_data.market_anchor,
          region_type: platform_data.region_type,
          market: platform_data.market,
        })
        .from(platform_data)
        .where(and(
          eq(platform_data.city, city),
          eq(platform_data.platform, 'uber')
        ))
        .limit(1);

      const marketAnchor = cityData?.market_anchor || null;
      const regionType = cityData?.region_type || null;
      const marketSlug = marketAnchor ? marketAnchor.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') : null;

      // Build query for intelligence - universal + market-specific
      const intelligenceQuery = db
        .select({
          id: market_intelligence.id,
          market: market_intelligence.market,
          market_slug: market_intelligence.market_slug,
          intel_type: market_intelligence.intel_type,
          intel_subtype: market_intelligence.intel_subtype,
          title: market_intelligence.title,
          summary: market_intelligence.summary,
          content: market_intelligence.content,
          neighborhoods: market_intelligence.neighborhoods,
          tags: market_intelligence.tags,
          priority: market_intelligence.priority,
          confidence: market_intelligence.confidence,
          coach_priority: market_intelligence.coach_priority,
        })
        .from(market_intelligence)
        .where(and(
          eq(market_intelligence.is_active, true),
          eq(market_intelligence.coach_can_cite, true),
          or(
            eq(market_intelligence.market_slug, 'universal'),
            marketSlug ? eq(market_intelligence.market_slug, marketSlug) : sql`false`
          ),
          or(
            eq(market_intelligence.platform, 'both'),
            eq(market_intelligence.platform, platform)
          )
        ))
        .orderBy(desc(market_intelligence.coach_priority), desc(market_intelligence.priority))
        .limit(25);

      const intelligence = await intelligenceQuery;

      // Calculate deadhead risk
      let deadheadRisk = null;
      if (regionType) {
        const riskMap = {
          'Core': { level: 'low', score: 20, description: 'Low risk - high demand density, easy return trips' },
          'Satellite': { level: 'medium', score: 50, description: 'Moderate risk - favor rides toward Core cities' },
          'Rural': { level: 'high', score: 80, description: 'High risk - expect long unpaid returns' }
        };
        deadheadRisk = riskMap[regionType] || null;
      }

      return {
        marketPosition: {
          city,
          state,
          market_anchor: marketAnchor,
          region_type: regionType,
          market_slug: marketSlug,
          deadhead_risk: deadheadRisk,
        },
        intelligence: intelligence || [],
      };
    } catch (error) {
      console.error('[CoachDAL] getMarketIntelligence error:', error);
      return { marketPosition: null, intelligence: [] };
    }
  }

  /**
   * Get user-specific intel notes (coach memories about this user)
   * @param {string} userId - User ID
   * @param {number} limit - Max notes to retrieve
   * @returns {Promise<Array>} User intel notes
   */
  async getUserNotes(userId, limit = 20) {
    try {
      if (!userId) return [];

      const notes = await db
        .select()
        .from(user_intel_notes)
        .where(and(
          eq(user_intel_notes.user_id, userId),
          eq(user_intel_notes.is_active, true),
          or(
            isNull(user_intel_notes.valid_until),
            gte(user_intel_notes.valid_until, new Date())
          )
        ))
        .orderBy(
          desc(user_intel_notes.is_pinned),
          desc(user_intel_notes.importance),
          desc(user_intel_notes.created_at)
        )
        .limit(limit);

      return notes || [];
    } catch (error) {
      console.error('[CoachDAL] getUserNotes error:', error);
      return [];
    }
  }

  /**
   * Save a new intel note from coach interaction
   * @param {Object} noteData - Note data to save
   * @returns {Promise<Object|null>} Saved note or null
   */
  async saveUserNote(noteData) {
    try {
      const {
        user_id,
        snapshot_id,
        note_type = 'insight',
        category,
        title,
        content,
        context,
        market_slug,
        neighborhoods,
        importance = 50,
        confidence = 80,
        source_message_id,
        created_by = 'ai_coach'
      } = noteData;

      if (!user_id || !content) {
        console.warn('[CoachDAL] saveUserNote: missing user_id or content');
        return null;
      }

      const [note] = await db
        .insert(user_intel_notes)
        .values({
          user_id,
          snapshot_id,
          note_type,
          category,
          title,
          content,
          context,
          market_slug,
          neighborhoods,
          importance,
          confidence,
          source_message_id,
          created_by,
        })
        .returning();

      console.log(`[CoachDAL] Saved user note: ${note.id} (${note_type})`);
      return note;
    } catch (error) {
      console.error('[CoachDAL] saveUserNote error:', error);
      return null;
    }
  }

  /**
   * Increment times_referenced for a note (when coach uses it)
   * @param {string} noteId - Note ID
   */
  async incrementNoteReference(noteId) {
    try {
      await db
        .update(user_intel_notes)
        .set({
          times_referenced: sql`${user_intel_notes.times_referenced} + 1`,
          updated_at: new Date()
        })
        .where(eq(user_intel_notes.id, noteId));
    } catch (error) {
      console.error('[CoachDAL] incrementNoteReference error:', error);
    }
  }

  /**
   * Get driver profile and vehicle information
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Driver profile and vehicle data
   */
  async getDriverProfile(userId) {
    try {
      if (!userId) {
        console.log('[CoachDAL] getDriverProfile: No userId provided');
        return { profile: null, vehicle: null };
      }

      console.log(`[CoachDAL] getDriverProfile: Looking up profile for user ${userId.slice(0, 8)}...`);

      // Get driver profile - only select columns that exist in schema
      const [profile] = await db
        .select({
          id: driver_profiles.id,
          user_id: driver_profiles.user_id,
          first_name: driver_profiles.first_name,
          last_name: driver_profiles.last_name,
          driver_nickname: driver_profiles.driver_nickname,
          email: driver_profiles.email,
          phone: driver_profiles.phone,
          address_1: driver_profiles.address_1,
          address_2: driver_profiles.address_2,
          city: driver_profiles.city,
          state_territory: driver_profiles.state_territory,
          zip_code: driver_profiles.zip_code,
          country: driver_profiles.country,
          home_lat: driver_profiles.home_lat,
          home_lng: driver_profiles.home_lng,
          home_timezone: driver_profiles.home_timezone,
          market: driver_profiles.market,
          rideshare_platforms: driver_profiles.rideshare_platforms,
          // Vehicle eligibility
          elig_economy: driver_profiles.elig_economy,
          elig_xl: driver_profiles.elig_xl,
          elig_xxl: driver_profiles.elig_xxl,
          elig_comfort: driver_profiles.elig_comfort,
          elig_luxury_sedan: driver_profiles.elig_luxury_sedan,
          elig_luxury_suv: driver_profiles.elig_luxury_suv,
          // Vehicle attributes
          attr_electric: driver_profiles.attr_electric,
          attr_green: driver_profiles.attr_green,
          attr_wav: driver_profiles.attr_wav,
          // Service preferences
          pref_pet_friendly: driver_profiles.pref_pet_friendly,
          pref_teen: driver_profiles.pref_teen,
          pref_assist: driver_profiles.pref_assist,
          pref_shared: driver_profiles.pref_shared,
          // Timestamps
          created_at: driver_profiles.created_at,
          updated_at: driver_profiles.updated_at,
        })
        .from(driver_profiles)
        .where(eq(driver_profiles.user_id, userId))
        .limit(1);

      if (!profile) {
        console.log(`[CoachDAL] getDriverProfile: No profile found for user ${userId.slice(0, 8)}`);
        return { profile: null, vehicle: null };
      }

      console.log(`[CoachDAL] getDriverProfile: Found profile for ${profile.first_name} ${profile.last_name}`);

      // Get primary vehicle
      const [vehicle] = await db
        .select({
          id: driver_vehicles.id,
          year: driver_vehicles.year,
          make: driver_vehicles.make,
          model: driver_vehicles.model,
          color: driver_vehicles.color,
          license_plate: driver_vehicles.license_plate,
          seatbelts: driver_vehicles.seatbelts,
          is_primary: driver_vehicles.is_primary,
        })
        .from(driver_vehicles)
        .where(and(
          eq(driver_vehicles.driver_profile_id, profile.id),
          eq(driver_vehicles.is_primary, true)
        ))
        .limit(1);

      if (vehicle) {
        console.log(`[CoachDAL] getDriverProfile: Found vehicle ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
      } else {
        console.log(`[CoachDAL] getDriverProfile: No vehicle found for profile ${profile.id.slice(0, 8)}`);
      }

      return {
        profile,
        vehicle: vehicle || null,
      };
    } catch (error) {
      console.error('[CoachDAL] getDriverProfile error:', error);
      return { profile: null, vehicle: null };
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
   * @param {string} authenticatedUserId - Optional authenticated user ID for driver profile lookup
   * @returns {Promise<Object>} Complete coach context with full schema access
   */
  async getCompleteContext(snapshotId, strategyId, authenticatedUserId = null) {
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

      // Fetch all schema data in parallel (first batch)
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

      // Fetch market intelligence, user notes, and driver profile (depends on snapshot for city/state/user_id)
      let marketIntelligence = { marketPosition: null, intelligence: [] };
      let userNotes = [];
      let driverData = { profile: null, vehicle: null };

      if (snapshot) {
        // Use authenticated user ID if provided, otherwise fall back to snapshot's user_id
        const effectiveUserId = authenticatedUserId || snapshot.user_id;
        console.log(`[CoachDAL] getCompleteContext: Snapshot user_id = ${snapshot.user_id || 'NULL'}, authenticated = ${authenticatedUserId || 'NULL'}, effective = ${effectiveUserId || 'NULL'}, city = ${snapshot.city}`);

        const [intel, notes, driver, offerData] = await Promise.all([
          this.getMarketIntelligence(snapshot.city, snapshot.state),
          effectiveUserId ? this.getUserNotes(effectiveUserId) : Promise.resolve([]),
          effectiveUserId ? this.getDriverProfile(effectiveUserId) : Promise.resolve({ profile: null, vehicle: null }),
          this.getOfferHistory(20)  // 2026-02-16: Include offer analysis history
        ]);
        marketIntelligence = intel;
        userNotes = notes;
        driverData = driver;
      }

      return {
        snapshot,
        strategy,
        briefing,
        smartBlocks,
        feedback,
        venueData,
        actions: driverActions,
        marketIntelligence,
        userNotes,
        driverProfile: driverData.profile,
        driverVehicle: driverData.vehicle,
        offerHistory: offerData || { offers: [], stats: null },  // 2026-02-16: Offer log for coach
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
        marketIntelligence: { marketPosition: null, intelligence: [] },
        userNotes: [],
        driverProfile: null,
        driverVehicle: null,
        offerHistory: { offers: [], stats: null },
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
      marketIntelligence,
      userNotes,
      driverProfile,
      driverVehicle,
      status
    } = context;

    let prompt = '';

    // ========== DRIVER PROFILE (Who is this driver?) ==========
    if (driverProfile) {
      prompt += `\n\n=== DRIVER PROFILE ===`;
      const displayName = driverProfile.driver_nickname || driverProfile.first_name || 'Driver';
      prompt += `\n👤 Name: ${displayName} ${driverProfile.last_name || ''}`.trim();
      prompt += `\n📧 Email: ${driverProfile.email}`;
      if (driverProfile.phone) prompt += `\n📱 Phone: ${driverProfile.phone}`;

      // Home location
      if (driverProfile.city && driverProfile.state_territory) {
        prompt += `\n🏠 Home: ${driverProfile.city}, ${driverProfile.state_territory}`;
        if (driverProfile.home_timezone) prompt += ` (${driverProfile.home_timezone})`;
      }
      if (driverProfile.market) prompt += `\n📍 Market: ${driverProfile.market}`;

      // Rideshare platforms from JSON array
      if (driverProfile.rideshare_platforms && Array.isArray(driverProfile.rideshare_platforms)) {
        const platformNames = driverProfile.rideshare_platforms.map(p =>
          p.charAt(0).toUpperCase() + p.slice(1)
        );
        if (platformNames.length > 0) {
          prompt += `\n🚗 Platforms: ${platformNames.join(', ')}`;
        }
      }

      // Vehicle eligibility tiers
      const eligibility = [];
      if (driverProfile.elig_economy) eligibility.push('Economy (UberX/Lyft)');
      if (driverProfile.elig_xl) eligibility.push('XL (6+ seats)');
      if (driverProfile.elig_xxl) eligibility.push('XXL');
      if (driverProfile.elig_comfort) eligibility.push('Comfort');
      if (driverProfile.elig_luxury_sedan) eligibility.push('Black/Luxury Sedan');
      if (driverProfile.elig_luxury_suv) eligibility.push('Black SUV');
      if (eligibility.length > 0) {
        prompt += `\n🎖️ Eligible Tiers: ${eligibility.join(', ')}`;
      }

      // Vehicle attributes
      const attrs = [];
      if (driverProfile.attr_electric) attrs.push('Electric Vehicle');
      if (driverProfile.attr_green) attrs.push('Hybrid/Green');
      if (driverProfile.attr_wav) attrs.push('Wheelchair Accessible');
      if (attrs.length > 0) {
        prompt += `\n✨ Vehicle Features: ${attrs.join(', ')}`;
      }

      // Service preferences
      const prefs = [];
      if (driverProfile.pref_pet_friendly) prefs.push('accepts pets');
      if (driverProfile.pref_teen) prefs.push('accepts unaccompanied teens');
      if (driverProfile.pref_assist) prefs.push('provides assist rides');
      if (driverProfile.pref_shared) prefs.push('takes shared rides');
      if (prefs.length > 0) {
        prompt += `\n⭐ Service Prefs: ${prefs.join(', ')}`;
      }
    }

    // ========== VEHICLE INFO ==========
    if (driverVehicle) {
      prompt += `\n\n🚙 VEHICLE: ${driverVehicle.year} ${driverVehicle.make} ${driverVehicle.model}`;
      if (driverVehicle.color) prompt += ` (${driverVehicle.color})`;
      if (driverVehicle.seatbelts) prompt += `\n   Capacity: ${driverVehicle.seatbelts} passengers`;
    }

    // ========== SNAPSHOT DATA (Location, Time, Weather, Air Quality) ==========
    if (snapshot) {
      prompt += `\n\n=== CURRENT LOCATION & TIME CONTEXT ===`;
      prompt += `\n📍 Location: ${snapshot.location_display || `${snapshot.city}, ${snapshot.state}`}`;
      prompt += `\n   Coordinates: ${parseFloat(snapshot.lat).toFixed(6)},${parseFloat(snapshot.lng).toFixed(6)}`;
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

      // Airport Conditions - now in briefings.airport_conditions (not snapshot)
      // 2026-01-14: airport_context dropped from snapshots, get from briefing if passed
      if (briefing?.airport_conditions?.airports && briefing.airport_conditions.airports.length > 0) {
        prompt += `\n\n✈️  AIRPORT CONDITIONS (30-mile radius)`;
        briefing.airport_conditions.airports.slice(0, 3).forEach(a => {
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

    // ========== MARKET INTELLIGENCE (Research-backed insights) ==========
    if (marketIntelligence?.marketPosition) {
      const mp = marketIntelligence.marketPosition;
      prompt += `\n\n=== MARKET INTELLIGENCE ===`;
      prompt += `\n🗺️  MARKET POSITION`;
      prompt += `\n   Market: ${mp.market_anchor || 'Unknown'}`;
      prompt += `\n   Region Type: ${mp.region_type || 'Unknown'}`;
      if (mp.deadhead_risk) {
        prompt += `\n   Deadhead Risk: ${mp.deadhead_risk.level.toUpperCase()} (${mp.deadhead_risk.score}/100)`;
        prompt += `\n   ${mp.deadhead_risk.description}`;
      }
    }

    if (marketIntelligence?.intelligence?.length > 0) {
      prompt += `\n\n📚 MARKET KNOWLEDGE BASE (${marketIntelligence.intelligence.length} items)`;

      // Group by intel_type for better organization
      const byType = {};
      marketIntelligence.intelligence.forEach(intel => {
        const type = intel.intel_type || 'general';
        if (!byType[type]) byType[type] = [];
        byType[type].push(intel);
      });

      // Format each type
      const typeLabels = {
        algorithm: '⚙️ Algorithm Mechanics',
        strategy: '🎯 Strategy Insights',
        zone: '📍 Zone Intelligence',
        timing: '⏰ Timing Patterns',
        regulatory: '📋 Regulations',
        airport: '✈️ Airport Tips',
        safety: '🛡️ Safety Info',
        general: '📖 General Knowledge'
      };

      for (const [type, items] of Object.entries(byType)) {
        prompt += `\n\n${typeLabels[type] || type.toUpperCase()}:`;
        items.slice(0, 5).forEach(intel => {
          prompt += `\n   • ${intel.title}`;
          if (intel.summary) {
            prompt += `\n     ${intel.summary.substring(0, 120)}`;
          }
        });
      }
    }

    // ========== USER NOTES (Coach memory about this user) ==========
    if (userNotes?.length > 0) {
      prompt += `\n\n=== YOUR NOTES ABOUT THIS DRIVER ===`;
      prompt += `\n📝 You have ${userNotes.length} saved note(s) about this user:`;

      userNotes.slice(0, 10).forEach((note, i) => {
        const noteIcon = {
          preference: '⭐',
          insight: '💡',
          tip: '💬',
          feedback: '👍',
          pattern: '🔄',
          market_update: '📰'
        }[note.note_type] || '📝';

        prompt += `\n   ${noteIcon} [${note.note_type}] ${note.title || 'Note'}`;
        prompt += `\n      ${note.content.substring(0, 150)}${note.content.length > 150 ? '...' : ''}`;
        if (note.is_pinned) prompt += ` [PINNED]`;
      });

      prompt += `\n\n   Use these notes to personalize your advice. You can reference them naturally.`;
    }

    // ========== OFFER ANALYSIS HISTORY (Siri Shortcuts) ==========
    // 2026-02-16: Ride offer analysis log for pattern-aware coaching
    const { offerHistory } = context;
    if (offerHistory?.stats && offerHistory.stats.total > 0) {
      const s = offerHistory.stats;
      prompt += `\n\n=== RIDE OFFER ANALYSIS LOG ===`;
      prompt += `\nStats (last ${s.total} offers):`;
      prompt += `\n   Accept rate: ${s.accept_rate_pct}% (${s.accepted} accepted, ${s.rejected} rejected)`;
      if (s.avg_per_mile) prompt += `\n   Avg $/mile: $${s.avg_per_mile}`;
      prompt += `\n   Avg response time: ${s.avg_response_ms}ms`;
      if (s.overrides > 0) {
        prompt += `\n   Driver overrides: ${s.overrides} (driver disagreed with AI ${s.overrides} time${s.overrides > 1 ? 's' : ''})`;
      }

      prompt += `\n\n   Recent offers:`;
      offerHistory.offers.slice(0, 5).forEach((offer, i) => {
        const pd = offer.parsed_data || {};
        const price = pd.price ? `$${pd.price}` : '?';
        const miles = pd.miles || pd.total_miles ? `${(pd.miles || pd.total_miles).toFixed(1)}mi` : '?';
        const pm = pd.per_mile ? `$${pd.per_mile.toFixed(2)}/mi` : '';
        const override = offer.user_override ? ` [DRIVER OVERRIDE: ${offer.user_override}]` : '';
        const time = new Date(offer.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        prompt += `\n   ${i + 1}. ${offer.decision} ${price}/${miles} ${pm} (${time})${override}`;
      });

      prompt += `\n\n   Use offer patterns to advise on positioning, timing, and offer strategy.`;
    }

    // ========== DATA AVAILABILITY SUMMARY ==========
    prompt += `\n\n📋 DATA ACCESS SUMMARY`;
    prompt += `\n   ✓ Driver Profile: ${driverProfile ? `${driverProfile.first_name} ${driverProfile.last_name}` : 'Not registered'}`;
    prompt += `\n   ✓ Vehicle: ${driverVehicle ? `${driverVehicle.year} ${driverVehicle.make} ${driverVehicle.model}` : 'Not set'}`;
    prompt += `\n   ✓ Snapshot: ${snapshot ? 'Complete' : 'Unavailable'}`;
    prompt += `\n   ✓ Strategy: ${strategy ? (strategy.consolidated_strategy ? 'Ready' : 'In Progress') : 'Pending'}`;
    prompt += `\n   ✓ Briefing: ${briefing && Object.keys(briefing).length > 0 ? 'Complete' : 'Unavailable'}`;
    prompt += `\n   ✓ Smart Blocks: ${smartBlocks?.length || 0} venues`;
    prompt += `\n   ✓ Feedback: ${feedback?.venue_feedback?.length || 0} venue votes`;
    prompt += `\n   ✓ Actions: ${actions?.length || 0} recorded`;
    prompt += `\n   ✓ Market Intel: ${marketIntelligence?.intelligence?.length || 0} items`;
    prompt += `\n   ✓ User Notes: ${userNotes?.length || 0} notes`;
    prompt += `\n   ✓ Offer Log: ${offerHistory?.stats?.total || 0} analyzed`;
    prompt += `\n   Status: ${status}`;

    return prompt;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OFFER HISTORY - Siri Shortcuts ride offer analysis log
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get offer analysis history for AI Coach context.
   * 2026-02-16: intercepted_signals uses device_id, NOT user_id (Siri headless).
   * Queries ALL recent offers (single-user system for now).
   * Future: link device_id → user_id for multi-user support.
   *
   * @param {number} limit - Max offers to retrieve (default 20)
   * @returns {Promise<Object>} { offers: Array, stats: Object }
   */
  async getOfferHistory(limit = 20) {
    try {
      const history = await db
        .select({
          id: intercepted_signals.id,
          decision: intercepted_signals.decision,
          decision_reasoning: intercepted_signals.decision_reasoning,
          parsed_data: intercepted_signals.parsed_data,
          confidence_score: intercepted_signals.confidence_score,
          user_override: intercepted_signals.user_override,
          platform: intercepted_signals.platform,
          market: intercepted_signals.market,
          response_time_ms: intercepted_signals.response_time_ms,
          created_at: intercepted_signals.created_at,
        })
        .from(intercepted_signals)
        .orderBy(desc(intercepted_signals.created_at))
        .limit(limit);

      if (history.length === 0) {
        return { offers: [], stats: null };
      }

      const accepted = history.filter(h => h.decision === 'ACCEPT');
      const rejected = history.filter(h => h.decision === 'REJECT');
      const overrides = history.filter(h => h.user_override !== null);
      const perMileValues = history
        .map(h => h.parsed_data?.per_mile)
        .filter(v => v != null && v > 0);

      const stats = {
        total: history.length,
        accepted: accepted.length,
        rejected: rejected.length,
        accept_rate_pct: Math.round((accepted.length / history.length) * 100),
        overrides: overrides.length,
        avg_per_mile: perMileValues.length > 0
          ? (perMileValues.reduce((a, b) => a + b, 0) / perMileValues.length).toFixed(2)
          : null,
        avg_response_ms: Math.round(
          history.reduce((sum, h) => sum + (h.response_time_ms || 0), 0) / history.length
        ),
      };

      console.log(`[CoachDAL] getOfferHistory: ${history.length} offers, ${stats.accept_rate_pct}% accept rate`);
      return { offers: history, stats };
    } catch (error) {
      console.error('[CoachDAL] getOfferHistory error:', error);
      return { offers: [], stats: null };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SNAPSHOT HISTORY - User-level historical data access
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get snapshot history for a user (enables cross-session learning)
   * @param {string} userId - User ID
   * @param {number} limit - Max snapshots to retrieve
   * @param {Date} since - Only snapshots since this date
   * @returns {Promise<Array>} Array of historical snapshots with strategies
   */
  async getSnapshotHistory(userId, limit = 20, since = null) {
    try {
      if (!userId) return [];

      const conditions = [eq(snapshots.user_id, userId)];
      if (since) {
        conditions.push(gte(snapshots.created_at, since));
      }

      const snapshotHistory = await db
        .select({
          snapshot_id: snapshots.snapshot_id,
          created_at: snapshots.created_at,
          city: snapshots.city,
          state: snapshots.state,
          dow: snapshots.dow,
          hour: snapshots.hour,
          day_part_key: snapshots.day_part_key,
          holiday: snapshots.holiday,
          weather: snapshots.weather,
        })
        .from(snapshots)
        .where(and(...conditions))
        .orderBy(desc(snapshots.created_at))
        .limit(limit);

      // Enrich with strategy status
      const enrichedHistory = await Promise.all(
        snapshotHistory.map(async (snap) => {
          const [strat] = await db
            .select({
              status: strategies.status,
              strategy_for_now: strategies.strategy_for_now,
            })
            .from(strategies)
            .where(eq(strategies.snapshot_id, snap.snapshot_id))
            .limit(1);

          return {
            ...snap,
            had_strategy: !!strat?.strategy_for_now,
            strategy_status: strat?.status || 'none',
          };
        })
      );

      console.log(`[CoachDAL] getSnapshotHistory: Found ${enrichedHistory.length} snapshots for user ${userId.slice(0, 8)}`);
      return enrichedHistory;
    } catch (error) {
      console.error('[CoachDAL] getSnapshotHistory error:', error);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONVERSATION PERSISTENCE - Full thread memory
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Save a conversation message (user or assistant)
   * @param {Object} messageData - Message data
   * @returns {Promise<Object|null>} Saved message or null
   */
  async saveConversationMessage(messageData) {
    try {
      const {
        user_id,
        snapshot_id,
        conversation_id,
        parent_message_id,
        role,
        content,
        content_type = 'text',
        market_slug,  // For cross-driver learning
        topic_tags = [],
        extracted_tips = [],
        sentiment,
        location_context,
        time_context,
        tokens_in,
        tokens_out,
        model_used
      } = messageData;

      if (!user_id || !conversation_id || !role || !content) {
        console.warn('[CoachDAL] saveConversationMessage: missing required fields');
        return null;
      }

      const [message] = await db
        .insert(coach_conversations)
        .values({
          user_id,
          snapshot_id,
          conversation_id,
          parent_message_id,
          role,
          content,
          content_type,
          market_slug,  // For cross-driver learning
          topic_tags,
          extracted_tips,
          sentiment,
          location_context,
          time_context,
          tokens_in,
          tokens_out,
          model_used,
        })
        .returning();

      console.log(`[CoachDAL] Saved conversation message: ${message.id} (${role})`);
      return message;
    } catch (error) {
      console.error('[CoachDAL] saveConversationMessage error:', error);
      return null;
    }
  }

  /**
   * Get conversation history for a user
   * @param {string} userId - User ID
   * @param {string} conversationId - Specific conversation (optional)
   * @param {number} limit - Max messages to retrieve
   * @returns {Promise<Array>} Array of messages
   */
  async getConversationHistory(userId, conversationId = null, limit = 100) {
    try {
      if (!userId) return [];

      const conditions = [eq(coach_conversations.user_id, userId)];
      if (conversationId) {
        conditions.push(eq(coach_conversations.conversation_id, conversationId));
      }

      const messages = await db
        .select()
        .from(coach_conversations)
        .where(and(...conditions))
        .orderBy(asc(coach_conversations.created_at))
        .limit(limit);

      console.log(`[CoachDAL] getConversationHistory: Found ${messages.length} messages for user ${userId.slice(0, 8)}`);
      return messages;
    } catch (error) {
      console.error('[CoachDAL] getConversationHistory error:', error);
      return [];
    }
  }

  /**
   * Get list of conversations for a user (summary view)
   * @param {string} userId - User ID
   * @param {number} limit - Max conversations to retrieve
   * @returns {Promise<Array>} Array of conversation summaries
   */
  async getConversations(userId, limit = 20) {
    try {
      if (!userId) return [];

      // Get distinct conversations with first message as title
      const conversations = await db
        .selectDistinctOn([coach_conversations.conversation_id], {
          conversation_id: coach_conversations.conversation_id,
          first_message: coach_conversations.content,
          created_at: coach_conversations.created_at,
          snapshot_id: coach_conversations.snapshot_id,
          topic_tags: coach_conversations.topic_tags,
        })
        .from(coach_conversations)
        .where(and(
          eq(coach_conversations.user_id, userId),
          eq(coach_conversations.role, 'user')
        ))
        .orderBy(coach_conversations.conversation_id, desc(coach_conversations.created_at))
        .limit(limit);

      console.log(`[CoachDAL] getConversations: Found ${conversations.length} conversations for user ${userId.slice(0, 8)}`);
      return conversations;
    } catch (error) {
      console.error('[CoachDAL] getConversations error:', error);
      return [];
    }
  }

  /**
   * Star/unstar a message for easy reference
   * @param {string} messageId - Message ID
   * @param {boolean} starred - Whether to star or unstar
   */
  async toggleMessageStar(messageId, starred) {
    try {
      await db
        .update(coach_conversations)
        .set({ is_starred: starred, updated_at: new Date() })
        .where(eq(coach_conversations.id, messageId));
      console.log(`[CoachDAL] Message ${messageId} ${starred ? 'starred' : 'unstarred'}`);
    } catch (error) {
      console.error('[CoachDAL] toggleMessageStar error:', error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SYSTEM NOTES - AI observations about system enhancements
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Save a system enhancement note (AI observation)
   * @param {Object} noteData - System note data
   * @returns {Promise<Object|null>} Saved note or null
   */
  async saveSystemNote(noteData) {
    try {
      const {
        note_type,
        category,
        priority = 50,
        title,
        description,
        user_quote,
        triggering_user_id,
        triggering_conversation_id,
        triggering_snapshot_id,
        market_slug,
        is_market_specific = false
      } = noteData;

      if (!note_type || !category || !title || !description) {
        console.warn('[CoachDAL] saveSystemNote: missing required fields');
        return null;
      }

      // Check if similar note exists (dedupe by title + category)
      const [existing] = await db
        .select()
        .from(coach_system_notes)
        .where(and(
          eq(coach_system_notes.title, title),
          eq(coach_system_notes.category, category)
        ))
        .limit(1);

      if (existing) {
        // Update occurrence count instead of creating duplicate
        await db
          .update(coach_system_notes)
          .set({
            occurrence_count: sql`${coach_system_notes.occurrence_count} + 1`,
            affected_users: sql`${coach_system_notes.affected_users} || ${JSON.stringify([triggering_user_id])}::jsonb`,
            updated_at: new Date()
          })
          .where(eq(coach_system_notes.id, existing.id));
        console.log(`[CoachDAL] Updated existing system note: ${existing.id} (occurrence: ${existing.occurrence_count + 1})`);
        return existing;
      }

      const [note] = await db
        .insert(coach_system_notes)
        .values({
          note_type,
          category,
          priority,
          title,
          description,
          user_quote,
          triggering_user_id,
          triggering_conversation_id,
          triggering_snapshot_id,
          market_slug,
          is_market_specific,
          affected_users: triggering_user_id ? [triggering_user_id] : [],
        })
        .returning();

      console.log(`[CoachDAL] Saved system note: ${note.id} (${note_type}/${category})`);
      return note;
    } catch (error) {
      console.error('[CoachDAL] saveSystemNote error:', error);
      return null;
    }
  }

  /**
   * Get system notes (for admin review)
   * @param {string} status - Filter by status (optional)
   * @param {number} limit - Max notes to retrieve
   * @returns {Promise<Array>} Array of system notes
   */
  async getSystemNotes(status = null, limit = 50) {
    try {
      const conditions = [];
      if (status) {
        conditions.push(eq(coach_system_notes.status, status));
      }

      const notes = await db
        .select()
        .from(coach_system_notes)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(coach_system_notes.priority), desc(coach_system_notes.created_at))
        .limit(limit);

      return notes;
    } catch (error) {
      console.error('[CoachDAL] getSystemNotes error:', error);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NEWS/EVENT DEACTIVATION - User-specific content filtering
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate hash for news item deduplication
   * @private
   */
  _generateNewsHash(title, source, date) {
    const normalized = `${title || ''}_${source || ''}_${date || ''}`.toLowerCase().trim();
    return crypto.createHash('md5').update(normalized).digest('hex');
  }

  /**
   * Deactivate a news item for a user
   * @param {Object} deactivationData - Deactivation data
   * @returns {Promise<Object|null>} Deactivation record or null
   *
   * @example
   * // User asks to hide old news
   * await coachDAL.deactivateNews({
   *   user_id: userId,
   *   news_title: 'Rideshare driver carjacked in East Dallas',
   *   reason: 'Article is from a year ago'
   * });
   *
   * @example
   * // User preference
   * await coachDAL.deactivateNews({
   *   user_id: userId,
   *   news_title: 'Uber announces new driver incentives',
   *   reason: 'I only drive Lyft'
   * });
   */
  async deactivateNews(deactivationData) {
    try {
      const {
        user_id,
        news_title,
        news_source,
        news_date,
        reason, // Free-form - we'll learn patterns as users interact
        deactivated_by = 'user',
        snapshot_id // Optional: for real-time UI update
      } = deactivationData;

      if (!user_id || !news_title || !reason) {
        console.warn('[CoachDAL] deactivateNews: missing required fields');
        return null;
      }

      const news_hash = this._generateNewsHash(news_title, news_source, news_date);

      const [deactivation] = await db
        .insert(news_deactivations)
        .values({
          user_id,
          news_hash,
          news_title,
          news_source,
          reason,
          deactivated_by,
        })
        .onConflictDoUpdate({
          target: [news_deactivations.user_id, news_deactivations.news_hash],
          set: {
            reason,
            created_at: new Date()
          }
        })
        .returning();

      console.log(`[CoachDAL] Deactivated news: "${news_title.substring(0, 30)}..." for user ${user_id.slice(0, 8)} (reason: ${reason})`);

      // 2026-02-04: Real-time update - notify client to refresh briefing
      if (snapshot_id && deactivation) {
        const payload = JSON.stringify({ snapshot_id, type: 'news_update' });
        await db.execute(sql`SELECT pg_notify('briefing_ready', ${payload})`);
        console.log(`[CoachDAL] 📢 Sent briefing_ready notification for news update (snapshot: ${snapshot_id.slice(0, 8)})`);
      }

      return deactivation;
    } catch (error) {
      console.error('[CoachDAL] deactivateNews error:', error);
      return null;
    }
  }

  /**
   * Get deactivated news hashes for a user (for filtering)
   * @param {string} userId - User ID
   * @returns {Promise<Set<string>>} Set of deactivated news hashes
   */
  async getDeactivatedNewsHashes(userId) {
    try {
      if (!userId) return new Set();

      const deactivations = await db
        .select({ news_hash: news_deactivations.news_hash })
        .from(news_deactivations)
        .where(eq(news_deactivations.user_id, userId));

      return new Set(deactivations.map(d => d.news_hash));
    } catch (error) {
      console.error('[CoachDAL] getDeactivatedNewsHashes error:', error);
      return new Set();
    }
  }

  /**
   * Deactivate a discovered event
   * Supports lookup by either event_id or event_title (title-based lookup searches recent active events)
   * @param {Object} deactivationData - Deactivation data
   * @param {string} [deactivationData.event_id] - Direct event ID (optional if event_title provided)
   * @param {string} [deactivationData.event_title] - Event title for fuzzy lookup (optional if event_id provided)
   * @param {string} deactivationData.reason - Reason for deactivation
   * @param {string} [deactivationData.notes] - Additional notes
   * @param {string} [deactivationData.deactivated_by] - Who deactivated (default: 'ai_coach')
   * @param {string} [deactivationData.snapshot_id] - Snapshot ID for real-time update
   * @returns {Promise<Object|null>} Updated event or null
   */
  async deactivateEvent(deactivationData) {
    try {
      const {
        event_id,
        event_title,
        reason,
        notes,
        deactivated_by = 'ai_coach',
        snapshot_id // Optional: for real-time UI update
      } = deactivationData;

      if (!reason) {
        console.warn('[CoachDAL] deactivateEvent: missing reason');
        return null;
      }

      let targetEventId = event_id;

      // If no event_id, look up by title
      if (!targetEventId && event_title) {
        // Search for matching active event (case-insensitive, recent first)
        const normalizedTitle = event_title.trim().toLowerCase();

        const matchingEvents = await db
          .select({ id: discovered_events.id, title: discovered_events.title })
          .from(discovered_events)
          .where(eq(discovered_events.is_active, true))
          .orderBy(desc(discovered_events.discovered_at))
          .limit(100); // Check recent events

        // Find best match (exact or close)
        const exactMatch = matchingEvents.find(e =>
          e.title?.toLowerCase() === normalizedTitle
        );

        if (exactMatch) {
          targetEventId = exactMatch.id;
          console.log(`[CoachDAL] Found event by title: "${event_title}" -> ID ${targetEventId}`);
        } else {
          // Try partial match (title contains the search term or vice versa)
          const partialMatch = matchingEvents.find(e =>
            e.title?.toLowerCase().includes(normalizedTitle) ||
            normalizedTitle.includes(e.title?.toLowerCase())
          );

          if (partialMatch) {
            targetEventId = partialMatch.id;
            console.log(`[CoachDAL] Found event by partial match: "${event_title}" -> "${partialMatch.title}" (ID ${targetEventId})`);
          }
        }
      }

      if (!targetEventId) {
        console.warn(`[CoachDAL] deactivateEvent: could not find event - id: ${event_id}, title: "${event_title}"`);
        return null;
      }

      const deactivationReason = notes ? `${reason}: ${notes}` : reason;

      const [event] = await db
        .update(discovered_events)
        .set({
          is_active: false,
          deactivation_reason: deactivationReason,
          deactivated_at: new Date(),
          deactivated_by,
          updated_at: new Date()
        })
        .where(eq(discovered_events.id, targetEventId))
        .returning();

      console.log(`[CoachDAL] Deactivated event: ${targetEventId} (reason: ${deactivationReason})`);

      // 2026-02-04: Real-time update - notify client to refresh briefing
      if (snapshot_id && event) {
        const payload = JSON.stringify({ snapshot_id, type: 'event_update' });
        await db.execute(sql`SELECT pg_notify('briefing_ready', ${payload})`);
        console.log(`[CoachDAL] 📢 Sent briefing_ready notification for event deactivation (snapshot: ${snapshot_id.slice(0, 8)})`);
      }

      return event;
    } catch (error) {
      console.error('[CoachDAL] deactivateEvent error:', error);
      return null;
    }
  }

  /**
   * Reactivate a previously deactivated event (undo mistaken deactivation)
   * Supports lookup by either event_id or event_title
   * @param {Object} reactivationData - Reactivation data
   * @param {string} [reactivationData.event_id] - Direct event ID (optional if event_title provided)
   * @param {string} [reactivationData.event_title] - Event title for fuzzy lookup (optional if event_id provided)
   * @param {string} reactivationData.reason - Reason for reactivation
   * @param {string} [reactivationData.notes] - Additional notes
   * @param {string} [reactivationData.reactivated_by] - Who reactivated (default: 'ai_coach')
   * @param {string} [reactivationData.snapshot_id] - Snapshot ID for real-time update
   * @returns {Promise<Object|null>} Updated event or null
   */
  async reactivateEvent(reactivationData) {
    try {
      const {
        event_id,
        event_title,
        reason,
        notes,
        reactivated_by = 'ai_coach',
        snapshot_id // Optional: for real-time UI update
      } = reactivationData;

      if (!reason) {
        console.warn('[CoachDAL] reactivateEvent: missing reason');
        return null;
      }

      let targetEventId = event_id;

      // If no event_id, look up by title (including inactive events)
      if (!targetEventId && event_title) {
        const normalizedTitle = event_title.trim().toLowerCase();

        // Search ALL events (including inactive ones) to find the deactivated event
        const matchingEvents = await db
          .select({ id: discovered_events.id, title: discovered_events.title, is_active: discovered_events.is_active })
          .from(discovered_events)
          .orderBy(desc(discovered_events.discovered_at))
          .limit(200); // Check more events since we need inactive ones too

        // Prioritize inactive events (the ones we want to reactivate)
        const inactiveEvents = matchingEvents.filter(e => !e.is_active);

        // Find best match among inactive events first
        const exactMatch = inactiveEvents.find(e =>
          e.title?.toLowerCase() === normalizedTitle
        );

        if (exactMatch) {
          targetEventId = exactMatch.id;
          console.log(`[CoachDAL] Found inactive event by title: "${event_title}" -> ID ${targetEventId}`);
        } else {
          // Try partial match on inactive events
          const partialMatch = inactiveEvents.find(e =>
            e.title?.toLowerCase().includes(normalizedTitle) ||
            normalizedTitle.includes(e.title?.toLowerCase())
          );

          if (partialMatch) {
            targetEventId = partialMatch.id;
            console.log(`[CoachDAL] Found inactive event by partial match: "${event_title}" -> "${partialMatch.title}" (ID ${targetEventId})`);
          }
        }
      }

      if (!targetEventId) {
        console.warn(`[CoachDAL] reactivateEvent: could not find event - id: ${event_id}, title: "${event_title}"`);
        return null;
      }

      const reactivationNote = notes ? `Reactivated: ${reason} - ${notes}` : `Reactivated: ${reason}`;

      const [event] = await db
        .update(discovered_events)
        .set({
          is_active: true,
          deactivation_reason: null, // Clear the deactivation reason
          deactivated_at: null,
          deactivated_by: null,
          // Store reactivation info in a way that doesn't overwrite important fields
          updated_at: new Date()
        })
        .where(eq(discovered_events.id, targetEventId))
        .returning();

      console.log(`[CoachDAL] Reactivated event: ${targetEventId} (reason: ${reactivationNote}, by: ${reactivated_by})`);

      // 2026-02-04: Real-time update - notify client to refresh briefing
      if (snapshot_id && event) {
        const payload = JSON.stringify({ snapshot_id, type: 'event_update' });
        await db.execute(sql`SELECT pg_notify('briefing_ready', ${payload})`);
        console.log(`[CoachDAL] 📢 Sent briefing_ready notification for event reactivation (snapshot: ${snapshot_id.slice(0, 8)})`);
      }

      return event;
    } catch (error) {
      console.error('[CoachDAL] reactivateEvent error:', error);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MARKET INTELLIGENCE - Coach-contributed market insights
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Save market intelligence (from coach analysis)
   * @param {Object} intelData - Market intelligence data
   * @returns {Promise<Object|null>} Saved intel or null
   */
  async saveMarketIntelligence(intelData) {
    try {
      const {
        market,
        platform = 'both',
        intel_type,
        intel_subtype,
        title,
        summary,
        content,
        neighborhoods,
        boundaries,
        time_context,
        tags = [],
        priority = 50,
        source = 'ai_coach',
        confidence = 70,
        created_by = 'ai_coach'
      } = intelData;

      if (!market || !intel_type || !title || !content) {
        console.warn('[CoachDAL] saveMarketIntelligence: missing required fields');
        return null;
      }

      const market_slug = market.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

      const [intel] = await db
        .insert(market_intelligence)
        .values({
          market,
          market_slug,
          platform,
          intel_type,
          intel_subtype,
          title,
          summary,
          content,
          neighborhoods,
          boundaries,
          time_context,
          tags,
          priority,
          source,
          confidence,
          created_by,
          coach_can_cite: true,
          coach_priority: priority,
        })
        .returning();

      console.log(`[CoachDAL] Saved market intel: ${intel.id} (${market}/${intel_type})`);
      return intel;
    } catch (error) {
      console.error('[CoachDAL] saveMarketIntelligence error:', error);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VENUE CATALOG - Driver-contributed venue intel
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Save or update venue catalog entry (driver intel contribution)
   * @param {Object} venueData - Venue data
   * @returns {Promise<Object|null>} Saved venue or null
   */
  async saveVenueCatalogEntry(venueData) {
    try {
      const {
        place_id,
        venue_name,
        address,
        lat,
        lng,
        category,
        dayparts,
        staging_notes,
        city,
        metro,
        district,
        ai_estimated_hours,
        discovery_source = 'ai_coach'
      } = venueData;

      if (!venue_name || !address || !category) {
        console.warn('[CoachDAL] saveVenueCatalogEntry: missing required fields');
        return null;
      }

      const district_slug = district
        ? district.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
        : null;

      // Check if venue exists by place_id
      if (place_id) {
        const [existing] = await db
          .select()
          .from(venue_catalog)
          .where(eq(venue_catalog.place_id, place_id))
          .limit(1);

        if (existing) {
          // Update existing venue
          const [updated] = await db
            .update(venue_catalog)
            .set({
              staging_notes: staging_notes || existing.staging_notes,
              ai_estimated_hours: ai_estimated_hours || existing.ai_estimated_hours,
              validated_at: new Date(),
            })
            .where(eq(venue_catalog.venue_id, existing.venue_id))
            .returning();

          console.log(`[CoachDAL] Updated venue: ${updated.venue_id} (${venue_name})`);
          return updated;
        }
      }

      // Create new venue entry
      const [venue] = await db
        .insert(venue_catalog)
        .values({
          place_id,
          venue_name,
          address,
          lat,
          lng,
          category,
          dayparts,
          staging_notes,
          city,
          metro,
          district,
          district_slug,
          ai_estimated_hours,
          discovery_source,
        })
        .returning();

      console.log(`[CoachDAL] Created venue: ${venue.venue_id} (${venue_name})`);
      return venue;
    } catch (error) {
      console.error('[CoachDAL] saveVenueCatalogEntry error:', error);
      return null;
    }
  }

  /**
   * Add staging notes to an existing venue
   * @param {string} placeId - Google Place ID
   * @param {Object} stagingNotes - Staging notes to add
   * @returns {Promise<Object|null>} Updated venue or null
   */
  async addVenueStagingNotes(placeId, stagingNotes) {
    try {
      if (!placeId || !stagingNotes) {
        console.warn('[CoachDAL] addVenueStagingNotes: missing required fields');
        return null;
      }

      const [venue] = await db
        .update(venue_catalog)
        .set({
          staging_notes: sql`COALESCE(${venue_catalog.staging_notes}, '{}')::jsonb || ${JSON.stringify(stagingNotes)}::jsonb`,
          validated_at: new Date(),
        })
        .where(eq(venue_catalog.place_id, placeId))
        .returning();

      if (venue) {
        console.log(`[CoachDAL] Added staging notes to venue: ${placeId}`);
      }
      return venue;
    } catch (error) {
      console.error('[CoachDAL] addVenueStagingNotes error:', error);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TIPS EXTRACTION - Learn from successful conversations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Extract and save tips from a coach response
   * @param {string} userId - User ID
   * @param {string} responseContent - Coach response containing tips
   * @param {Object} context - Context (city, state, etc.)
   * @returns {Promise<number>} Number of tips extracted
   */
  async extractAndSaveTips(userId, responseContent, context = {}) {
    try {
      // Look for actionable patterns in the response
      const tipPatterns = [
        /(?:try|consider|i recommend|you should|tip:)\s+([^.!?]+[.!?])/gi,
        /(?:what works|pro tip|insider tip):\s+([^.!?]+[.!?])/gi,
        /(?:turn on|enable|activate|use)\s+(?:your\s+)?(\w+\s+(?:filter|mode|setting)[^.!?]*[.!?])/gi,
      ];

      const extractedTips = [];
      for (const pattern of tipPatterns) {
        let match;
        while ((match = pattern.exec(responseContent)) !== null) {
          extractedTips.push(match[1].trim());
        }
      }

      // Save each unique tip as a user intel note
      const savedCount = 0;
      const uniqueTips = [...new Set(extractedTips)].slice(0, 5); // Max 5 tips per response

      for (const tip of uniqueTips) {
        await this.saveUserNote({
          user_id: userId,
          note_type: 'tip',
          category: 'strategy',
          title: tip.substring(0, 50),
          content: tip,
          market_slug: context.market_slug,
          importance: 60,
          created_by: 'ai_coach'
        });
      }

      if (uniqueTips.length > 0) {
        console.log(`[CoachDAL] Extracted ${uniqueTips.length} tips from coach response`);
      }
      return uniqueTips.length;
    } catch (error) {
      console.error('[CoachDAL] extractAndSaveTips error:', error);
      return 0;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ZONE INTELLIGENCE - Crowd-sourced market knowledge
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate market slug from city/state
   * @param {string} city - City name
   * @param {string} state - State abbreviation
   * @returns {string} Market slug (e.g., "dallas-tx")
   */
  generateMarketSlug(city, state) {
    if (!city || !state) return null;
    const normalizedCity = city.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const normalizedState = state.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return `${normalizedCity}-${normalizedState}`;
  }

  /**
   * Save zone intelligence from AI Coach conversation
   * Implements cross-driver learning: if zone already exists, increment reports and confidence
   *
   * @param {Object} zoneData - Zone intelligence data
   * @returns {Promise<Object|null>} Saved/updated zone or null
   *
   * @example
   * await coachDAL.saveZoneIntelligence({
   *   market_slug: 'dallas-tx',
   *   zone_type: 'dead_zone',
   *   zone_name: 'The area around Galleria after 11pm',
   *   reason: 'Driver said they waited 45 min with no pings',
   *   time_constraints: { after_hour: 23 },
   *   user_id: userId,
   *   conversation_id: conversationId
   * });
   */
  async saveZoneIntelligence(zoneData) {
    try {
      const {
        market_slug,
        zone_type,
        zone_name,
        zone_description,
        lat,
        lng,
        radius_miles,
        address_hint,
        time_constraints,
        reason,
        user_id,
        conversation_id
      } = zoneData;

      if (!market_slug || !zone_type || !zone_name) {
        console.warn('[CoachDAL] saveZoneIntelligence: missing required fields');
        return null;
      }

      // Check if similar zone already exists in this market
      // Match by zone_type and similar name (fuzzy match)
      const normalizedName = zone_name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const existing = await db
        .select()
        .from(zone_intelligence)
        .where(and(
          eq(zone_intelligence.market_slug, market_slug),
          eq(zone_intelligence.zone_type, zone_type),
          eq(zone_intelligence.is_active, true)
        ))
        .limit(100);

      // Find matching zone by name similarity
      const matchingZone = existing.find(z => {
        const existingName = z.zone_name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        // Simple containment check - could be improved with fuzzy matching
        return existingName.includes(normalizedName) || normalizedName.includes(existingName);
      });

      if (matchingZone) {
        // Cross-driver learning: update existing zone
        const contributors = matchingZone.contributing_users || [];
        const conversations = matchingZone.source_conversations || [];

        // Only add user if not already a contributor
        if (user_id && !contributors.includes(user_id)) {
          contributors.push(user_id);
        }
        if (conversation_id && !conversations.includes(conversation_id)) {
          conversations.push(conversation_id);
        }

        // Increase confidence with more reports (max 95)
        const newConfidence = Math.min(95, matchingZone.confidence_score + 10);

        const [updated] = await db
          .update(zone_intelligence)
          .set({
            reports_count: matchingZone.reports_count + 1,
            confidence_score: newConfidence,
            contributing_users: contributors,
            source_conversations: conversations,
            last_reason: reason || matchingZone.last_reason,
            last_reported_by: user_id,
            last_reported_at: new Date(),
            updated_at: new Date(),
            // Update coordinates if we now have them
            lat: lat || matchingZone.lat,
            lng: lng || matchingZone.lng,
            address_hint: address_hint || matchingZone.address_hint,
          })
          .where(eq(zone_intelligence.id, matchingZone.id))
          .returning();

        console.log(`[CoachDAL] Zone intel updated: "${zone_name}" now has ${updated.reports_count} reports, confidence=${updated.confidence_score}`);
        return updated;
      } else {
        // New zone - create it
        const [created] = await db
          .insert(zone_intelligence)
          .values({
            market_slug,
            zone_type,
            zone_name,
            zone_description: zone_description || reason,
            lat: lat || null,
            lng: lng || null,
            radius_miles: radius_miles || 0.5,
            address_hint: address_hint || null,
            time_constraints: time_constraints || {},
            is_time_specific: !!(time_constraints && Object.keys(time_constraints).length > 0),
            reports_count: 1,
            confidence_score: 50,
            contributing_users: user_id ? [user_id] : [],
            source_conversations: conversation_id ? [conversation_id] : [],
            last_reason: reason,
            last_reported_by: user_id,
            last_reported_at: new Date(),
          })
          .returning();

        console.log(`[CoachDAL] New zone intel created: "${zone_name}" in ${market_slug} (${zone_type})`);
        return created;
      }
    } catch (error) {
      console.error('[CoachDAL] saveZoneIntelligence error:', error);
      return null;
    }
  }

  /**
   * Get zone intelligence for a market
   * @param {string} marketSlug - Market slug (e.g., "dallas-tx")
   * @param {Object} options - Filter options
   * @returns {Promise<Array>} Zone intelligence items
   */
  async getZoneIntelligence(marketSlug, options = {}) {
    try {
      const { zone_type, min_confidence = 30, limit = 50 } = options;

      const conditions = [
        eq(zone_intelligence.market_slug, marketSlug),
        eq(zone_intelligence.is_active, true),
        gte(zone_intelligence.confidence_score, min_confidence)
      ];

      if (zone_type) {
        conditions.push(eq(zone_intelligence.zone_type, zone_type));
      }

      const zones = await db
        .select()
        .from(zone_intelligence)
        .where(and(...conditions))
        .orderBy(desc(zone_intelligence.confidence_score), desc(zone_intelligence.reports_count))
        .limit(limit);

      console.log(`[CoachDAL] getZoneIntelligence: Found ${zones.length} zones in ${marketSlug}`);
      return zones;
    } catch (error) {
      console.error('[CoachDAL] getZoneIntelligence error:', error);
      return [];
    }
  }

  /**
   * Get zone intelligence summary for AI prompt
   * @param {string} marketSlug - Market slug
   * @returns {Promise<string>} Formatted zone intel for AI
   */
  async getZoneIntelligenceSummary(marketSlug) {
    try {
      if (!marketSlug) return '';

      const zones = await this.getZoneIntelligence(marketSlug, { min_confidence: 40, limit: 20 });
      if (zones.length === 0) return '';

      let summary = `\n\n🗺️ **Local Zone Intelligence for ${marketSlug}** (crowd-sourced from drivers):\n`;

      const byType = {};
      for (const zone of zones) {
        if (!byType[zone.zone_type]) byType[zone.zone_type] = [];
        byType[zone.zone_type].push(zone);
      }

      const typeLabels = {
        dead_zone: '🚫 Dead Zones',
        danger_zone: '⚠️ Danger Zones',
        honey_hole: '🍯 Honey Holes',
        surge_trap: '🪤 Surge Traps',
        staging_spot: '🅿️ Staging Spots',
        event_zone: '🎉 Event Zones'
      };

      for (const [type, typeZones] of Object.entries(byType)) {
        summary += `\n${typeLabels[type] || type}:\n`;
        for (const z of typeZones.slice(0, 5)) {
          const confidence = z.reports_count > 1 ? `(${z.reports_count} reports)` : '(new)';
          const time = z.is_time_specific ? `[time-specific]` : '';
          summary += `  • ${z.zone_name} ${confidence} ${time}\n`;
        }
      }

      return summary;
    } catch (error) {
      console.error('[CoachDAL] getZoneIntelligenceSummary error:', error);
      return '';
    }
  }
}

// Export singleton instance
export const coachDAL = new CoachDAL();
