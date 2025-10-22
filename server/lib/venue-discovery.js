/**
 * VENUE DISCOVERY SERVICE
 * 
 * Hybrid learning system: "Seeded Best + Smart Discovery"
 * - LLM suggests NEW venues with reasoning
 * - Places API validates (hours, location, existence)
 * - Adds validated venues to catalog
 * - Tracks suggestions for learning
 */

import { db } from '../db/drizzle.js';
import { venue_catalog, venue_metrics, llm_venue_suggestions } from '../../shared/schema.js';
import { findPlaceId, getPlaceHours } from './places-hours.js';
import { eq } from 'drizzle-orm';

/**
 * Validate and add LLM-suggested venue to catalog
 * @param {Object} suggestion - {name, category, reasoning, lat, lng, city}
 * @param {string} rankingId - Ranking ID that triggered the suggestion
 * @param {string} modelName - LLM model that made the suggestion
 * @returns {Promise<{success: boolean, venue_id?: string, reason?: string}>}
 */
export async function validateAndAddVenue(suggestion, rankingId, modelName) {
  const suggestionRecord = {
    model_name: modelName,
    ranking_id: rankingId,
    venue_name: suggestion.name,
    suggested_category: suggestion.category,
    llm_reasoning: suggestion.reasoning,
    validation_status: 'pending'
  };

  try {
    // Step 1: Log the suggestion
    const [inserted] = await db.insert(llm_venue_suggestions)
      .values(suggestionRecord)
      .returning();
    const suggestionId = inserted.suggestion_id;

    console.log(`🔍 Validating LLM suggestion: "${suggestion.name}" (${suggestion.category})`);

    // Step 2: Find place via Places API
    let placeId;
    try {
      placeId = await findPlaceId(suggestion.name, {
        lat: suggestion.lat,
        lng: suggestion.lng
      });
      console.log(`✅ Found place_id: ${placeId}`);
    } catch (error) {
      // Place not found - reject
      await db.update(llm_venue_suggestions)
        .set({
          validation_status: 'rejected',
          rejection_reason: `Place not found in Google Places: ${error.message}`,
          validated_at: new Date()
        })
        .where(eq(llm_venue_suggestions.suggestion_id, suggestionId));
      
      console.log(`❌ Rejected: Place not found`);
      return { success: false, reason: 'place_not_found' };
    }

    // Step 3: Check if place already exists in catalog
    const existing = await db.select()
      .from(venue_catalog)
      .where(eq(venue_catalog.place_id, placeId))
      .limit(1);

    if (existing.length > 0) {
      await db.update(llm_venue_suggestions)
        .set({
          validation_status: 'duplicate',
          place_id_found: placeId,
          venue_id_created: existing[0].venue_id,
          validated_at: new Date()
        })
        .where(eq(llm_venue_suggestions.suggestion_id, suggestionId));
      
      console.log(`⚠️ Duplicate: Venue already exists in catalog`);
      return { success: false, reason: 'duplicate', venue_id: existing[0].venue_id };
    }

    // Step 4: Fetch business hours
    let businessHours = null;
    try {
      const hours = await getPlaceHours(placeId);
      businessHours = {
        open_now: hours.openNow,
        weekday_text: hours.weekdayText,
        current_hours: hours.currentHours,
        has_holiday_hours: hours.hasHolidayHours,
        fetched_at: new Date().toISOString()
      };
      console.log(`📅 Fetched business hours (open now: ${hours.openNow})`);
    } catch (error) {
      console.warn(`⚠️ Could not fetch hours, proceeding without: ${error.message}`);
    }

    // Step 5: Add to catalog
    const [newVenue] = await db.insert(venue_catalog)
      .values({
        place_id: placeId,
        name: suggestion.name,
        address: suggestion.address || `${suggestion.city}, ${suggestion.state || ''}`,
        lat: suggestion.lat,
        lng: suggestion.lng,
        category: suggestion.category,
        city: suggestion.city,
        metro: suggestion.metro || suggestion.city || 'Unknown', // Use provided metro or city
        business_hours: businessHours,
        discovery_source: 'llm_suggestion',
        validated_at: new Date(),
        suggestion_metadata: {
          suggested_by: modelName,
          ranking_id: rankingId,
          reasoning: suggestion.reasoning
        }
      })
      .returning();

    // Step 6: Initialize metrics
    await db.insert(venue_metrics)
      .values({
        venue_id: newVenue.venue_id,
        times_recommended: 0,
        times_chosen: 0,
        positive_feedback: 0,
        negative_feedback: 0,
        reliability_score: 0.5
      });

    // Step 7: Update suggestion record
    await db.update(llm_venue_suggestions)
      .set({
        validation_status: 'validated',
        place_id_found: placeId,
        venue_id_created: newVenue.venue_id,
        validated_at: new Date()
      })
      .where(eq(llm_venue_suggestions.suggestion_id, suggestionId));

    console.log(`🎉 Successfully added "${suggestion.name}" to catalog (venue_id: ${newVenue.venue_id})`);

    return {
      success: true,
      venue_id: newVenue.venue_id,
      place_id: placeId,
      business_hours: businessHours
    };

  } catch (error) {
    console.error('[venue-discovery] Validation failed:', error);
    return { success: false, reason: 'validation_error', error: error.message };
  }
}

/**
 * Process batch of LLM suggestions
 * @param {Array} suggestions - [{name, category, reasoning, lat, lng, city}, ...]
 * @param {string} rankingId - Ranking ID
 * @param {string} modelName - LLM model name
 * @returns {Promise<{validated: number, rejected: number, duplicates: number}>}
 */
export async function processSuggestionBatch(suggestions, rankingId, modelName) {
  const results = {
    validated: 0,
    rejected: 0,
    duplicates: 0,
    errors: 0,
    new_venues: []
  };

  for (const suggestion of suggestions) {
    const result = await validateAndAddVenue(suggestion, rankingId, modelName);
    
    if (result.success) {
      results.validated++;
      results.new_venues.push({
        venue_id: result.venue_id,
        name: suggestion.name,
        business_hours: result.business_hours
      });
    } else if (result.reason === 'duplicate') {
      results.duplicates++;
    } else if (result.reason === 'place_not_found') {
      results.rejected++;
    } else {
      results.errors++;
    }
  }

  return results;
}

/**
 * Get discovery statistics
 * @returns {Promise<{total_suggestions: number, validated: number, rejected: number}>}
 */
export async function getDiscoveryStats() {
  const stats = await db.select({
    validation_status: llm_venue_suggestions.validation_status
  })
  .from(llm_venue_suggestions);

  const summary = {
    total_suggestions: stats.length,
    validated: stats.filter(s => s.validation_status === 'validated').length,
    rejected: stats.filter(s => s.validation_status === 'rejected').length,
    duplicates: stats.filter(s => s.validation_status === 'duplicate').length,
    pending: stats.filter(s => s.validation_status === 'pending').length
  };

  return summary;
}
