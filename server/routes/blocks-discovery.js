/**
 * BLOCKS-DISCOVERY.JS - Hybrid Learning Strategy Endpoint
 * 
 * Demonstrates the full "Seeded Best + Smart Discovery" flow:
 * 1. Detect triggers (day_part change, coord delta, manual refresh)
 * 2. Show curated "seeded best" venues (instant, reliable)
 * 3. LLM suggests NEW places (20% exploration rate)
 * 4. Validate suggestions via Places API (hours, location)
 * 5. Add validated venues to catalog
 * 6. User sees real-time updates streaming in
 * 
 * Benefits:
 * - Trust + Discovery: Start with quality, grow intelligently
 * - Feels Alive: Strategy updates in real-time
 * - Self-Improving: Successful new places become "seeded best"
 * - Zero Hallucinations: Everything validated via APIs
 */

import { Router } from 'express';
import crypto from 'crypto';
import { latLngToCell } from 'h3-js';
import { db } from '../db/drizzle.js';
import { venue_catalog, venue_metrics, snapshots, rankings, ranking_candidates } from '../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { scoreCandidate, applyDiversityGuardrails, enrichCandidateWithH3Distance } from '../lib/scoring-engine.js';
import { predictDriveMinutes } from '../lib/driveTime.js';
import { estimateNow } from '../utils/eta.js';
import { detectStrategyTrigger, getTriggerMessage, shouldExploreNewVenues, checkAirportProximity } from '../lib/strategy-triggers.js';
import { validateAndAddVenue, processSuggestionBatch } from '../lib/venue-discovery.js';
import { fetchFAADelayData } from '../lib/faa-asws.js';

const router = Router();

// LLM call for discovery
async function callLLMForDiscovery(systemPrompt, userPrompt) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp',
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: 0.7, // Higher temp for creative discovery
      maxOutputTokens: 4000,
    },
  });

  const result = await model.generateContent(userPrompt);
  return result.response.text();
}

router.get('/', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { 
      lat, 
      lng,
      userId = 'default',
      snapshotId
    } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({
        error: 'Missing coordinates',
        message: 'lat and lng query parameters are required'
      });
    }
    
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    
    console.log(`🔄 DISCOVERY: lat=${latitude} lng=${longitude}`);
    
    // ============================================
    // STEP 1: Get current & last snapshot context
    // ============================================
    let city = 'Unknown';
    let state = '';
    let timezone = null; // No default - must come from snapshot
    let dayPart = 'morning';
    let currentSnapshot = null;
    let lastSnapshot = null;
    
    if (snapshotId) {
      const rows = await db.select()
        .from(snapshots)
        .where(eq(snapshots.snapshot_id, snapshotId))
        .limit(1);
      
      if (rows && rows[0]) {
        currentSnapshot = rows[0];
        city = currentSnapshot.city || 'Unknown';
        state = currentSnapshot.state || '';
        timezone = currentSnapshot.timezone; // No fallback - timezone required
        dayPart = currentSnapshot.day_part_key || 'morning';
        
        console.log(`📸 Current snapshot: ${city}, ${state} (${dayPart})`);
      }
    }
    
    // Get last strategy snapshot
    const lastSnapshots = await db.select()
      .from(snapshots)
      .where(eq(snapshots.user_id, userId))
      .orderBy(sql`created_at DESC`)
      .limit(2);
    
    if (lastSnapshots.length > 1) {
      lastSnapshot = lastSnapshots[1]; // Second most recent
    }
    
    // ============================================
    // STEP 2: Detect strategy triggers
    // ============================================
    const trigger = detectStrategyTrigger(
      currentSnapshot || { day_part_key: dayPart, lat: latitude, lng: longitude },
      lastSnapshot
    );
    
    const triggerMessage = getTriggerMessage(trigger.reason, trigger.details);
    console.log(`🎯 Trigger: ${trigger.reason} - ${triggerMessage}`);
    
    if (!trigger.shouldUpdate) {
      console.log(`✋ No update needed - using cached strategy`);
      return res.json({
        trigger: trigger.reason,
        message: 'Strategy is up to date',
        details: trigger.details,
        blocks: [] // Would return cached strategy here
      });
    }
    
    // ============================================
    // STEP 3: Check airport proximity & disruptions
    // ============================================
    let airportContext = null;
    
    const nearbyAirport = await checkAirportProximity(latitude, longitude);
    if (nearbyAirport) {
      console.log(`✈️ Driver near ${nearbyAirport.code} (${nearbyAirport.distance.toFixed(1)} mi)`);
      
      // Fetch real-time disruption data for this airport
      const airportData = await fetchFAADelayData(nearbyAirport.code);
      
      if (airportData) {
        airportContext = {
          airport_code: nearbyAirport.code,
          airport_name: nearbyAirport.name,
          distance_miles: parseFloat(nearbyAirport.distance.toFixed(1)),
          delay_minutes: airportData.delay_minutes || 0,
          delay_reason: airportData.delay_reason,
          closure_status: airportData.closure_status,
          weather: airportData.weather,
          alert: null
        };
        
        // Generate driver alert
        if (airportData.delay_minutes > 15) {
          const trend = airportData.ground_delay_programs?.[0]?.trend;
          airportContext.alert = `🚨 ${nearbyAirport.code}: ${airportData.delay_minutes}min delays (${airportData.delay_reason})${trend ? `, ${trend}` : ''}`;
          if (airportData.weather) {
            airportContext.alert += `\n🌤️ ${airportData.weather.conditions}, ${airportData.weather.temperature}`;
          }
          airportContext.alert += '\n💡 Expect surge demand at nearby hotels & secondary airports';
        } else if (airportData.closure_status === 'restricted') {
          airportContext.alert = `⚠️ ${nearbyAirport.code}: ${airportData.delay_reason}`;
        } else if (airportData.weather) {
          airportContext.alert = `✈️ ${nearbyAirport.code}: Operating normally\n🌤️ ${airportData.weather.conditions}, ${airportData.weather.temperature}, Wind: ${airportData.weather.wind}`;
        }
        
        console.log(`📊 Airport context:`, airportContext);
      }
    }
    
    // ============================================
    // STEP 4: Get "seeded best" venues
    // ============================================
    const allVenues = await db.select({
      venue_id: venue_catalog.venue_id,
      place_id: venue_catalog.place_id,
      name: venue_catalog.name,
      address: venue_catalog.address,
      lat: venue_catalog.lat,
      lng: venue_catalog.lng,
      category: venue_catalog.category,
      city: venue_catalog.city,
      discovery_source: venue_catalog.discovery_source,
      business_hours: venue_catalog.business_hours,
      times_recommended: venue_metrics.times_recommended,
      reliability_score: venue_metrics.reliability_score,
    })
    .from(venue_catalog)
    .leftJoin(venue_metrics, eq(venue_catalog.venue_id, venue_metrics.venue_id));
    
    console.log(`✅ Found ${allVenues.length} total venues in catalog`);
    
    // Score and rank
    const driverH3 = latLngToCell(latitude, longitude, 8);
    const scoredVenues = allVenues.map(venue => {
      const enriched = enrichCandidateWithH3Distance(venue, driverH3);
      const score = scoreCandidate(enriched, { lat: latitude, lng: longitude });
      return { ...enriched, score };
    });
    
    scoredVenues.sort((a, b) => b.score - a.score);
    
    // Apply diversity
    const diverseVenues = applyDiversityGuardrails(scoredVenues, {
      lat: latitude,
      lng: longitude
    });
    
    console.log(`🌈 Selected ${diverseVenues.length} diverse venues from catalog`);
    
    // Calculate drive times
    const driveCtx = { tz: timezone, dow: new Date().getDay(), hour: new Date().getHours() };
    for (const venue of diverseVenues) {
      const driveTimeMinutes = await predictDriveMinutes(
        { lat: latitude, lng: longitude },
        { lat: venue.lat, lng: venue.lng },
        driveCtx
      );
      venue.driveTimeMinutes = driveTimeMinutes;
    }
    
    // ============================================
    // STEP 5: Discovery phase (20% exploration)
    // ============================================
    const shouldDiscover = shouldExploreNewVenues();
    let discoveryResults = null;
    
    if (shouldDiscover) {
      console.log(`🔍 Exploration mode: Asking LLM for NEW venue suggestions...`);
      
      const discoveryPrompt = `You are a rideshare strategy expert${snapshot.city ? ` for the ${snapshot.city} area` : ''}.

Current driver location: ${city}, ${state} (${latitude}, ${longitude})
Time: ${dayPart}

We already have these venues in our catalog:
${diverseVenues.map(v => `- ${v.name} (${v.category})`).join('\n')}

Suggest 2-3 NEW high-potential venues that are NOT in the list above. For each suggestion, provide:
1. Exact venue name (as it appears on Google Maps)
2. Category (airport/mall/entertainment/stadium/medical/university/mixed-use)
3. Why it's good for rideshare drivers RIGHT NOW
4. Approximate address

Return ONLY valid JSON (no markdown):
{
  "suggestions": [
    {
      "name": "Exact venue name",
      "category": "category",
      "reasoning": "Why drivers should go here now",
      "address": "Approximate address, ${city}, TX",
      "lat": ${latitude},
      "lng": ${longitude}
    }
  ]
}`;

      try {
        const llmResponse = await callLLMForDiscovery(
          'You are a rideshare venue discovery expert. Only suggest REAL places that exist.',
          discoveryPrompt
        );
        
        // Parse suggestions
        const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const suggestions = parsed.suggestions || [];
          
          console.log(`💡 LLM suggested ${suggestions.length} new venues`);
          
          // Validate and add to catalog
          const rankingId = crypto.randomUUID();
          discoveryResults = await processSuggestionBatch(
            suggestions,
            rankingId,
            'gemini-discovery'
          );
          
          console.log(`✅ Discovery results:`, discoveryResults);
        }
      } catch (error) {
        console.error(`❌ Discovery failed:`, error.message);
        discoveryResults = { error: error.message };
      }
    } else {
      console.log(`📊 Exploitation mode: Using proven venues only`);
    }
    
    // ============================================
    // STEP 6: Return response
    // ============================================
    const totalTime = Date.now() - startTime;
    
    res.json({
      trigger: {
        reason: trigger.reason,
        message: triggerMessage,
        details: trigger.details
      },
      airport_context: airportContext,
      catalog: {
        total_venues: allVenues.length,
        seeded: allVenues.filter(v => v.discovery_source === 'seed').length,
        discovered: allVenues.filter(v => v.discovery_source === 'llm_suggestion').length
      },
      recommendations: diverseVenues.map(v => ({
        name: v.name,
        category: v.category,
        drive_time: v.driveTimeMinutes,
        source: v.discovery_source,
        reliability: v.reliability_score,
        business_hours: v.business_hours
      })),
      discovery: shouldDiscover ? discoveryResults : { mode: 'exploitation' },
      timing: {
        total_ms: totalTime,
        trigger_detection: '< 1ms',
        airport_check: airportContext ? '~500ms' : 'skipped',
        catalog_query: '~50ms',
        discovery: shouldDiscover ? '~3000ms' : 'skipped'
      }
    });
    
  } catch (error) {
    console.error('[blocks-discovery] Error:', error);
    res.status(500).json({
      error: 'Strategy generation failed',
      message: error.message
    });
  }
});

export default router;
