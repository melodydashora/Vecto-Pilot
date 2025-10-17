// Research API endpoint - Internet-powered research via Perplexity
import express from 'express';
import { PerplexityResearch } from '../lib/perplexity-research.js';
import pg from 'pg';
import OpenAI from 'openai';

const router = express.Router();
const perplexity = new PerplexityResearch();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Quick research endpoint
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.status(400).json({
        error: 'Missing query parameter: q'
      });
    }

    const result = await perplexity.search(q, {
      systemPrompt: 'Provide concise, technical information for software development. Focus on best practices and actionable insights.',
      maxTokens: 500,
      searchRecencyFilter: 'month'
    });

    res.json({
      ok: true,
      query: q,
      answer: result.answer,
      citations: result.citations,
      relatedQuestions: result.relatedQuestions,
      model: result.model,
      timestamp: result.timestamp
    });
  } catch (error) {
    console.error('[Research API] Error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Deep research endpoint
router.post('/deep', async (req, res) => {
  try {
    const { topic, depth = 'standard' } = req.body;
    
    if (!topic) {
      return res.status(400).json({
        error: 'Missing required field: topic'
      });
    }

    const result = await perplexity.researchTopic(topic, depth);

    res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error('[Research API] Deep research error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Location-based research endpoint (non-blocking)
router.post('/location', async (req, res) => {
  try {
    const { snapshotId, lat, lng, city, state } = req.body;
    
    if (!snapshotId || !lat || !lng) {
      return res.status(400).json({
        error: 'Missing required fields: snapshotId, lat, lng'
      });
    }

    res.json({
      ok: true,
      message: 'Location research started',
      snapshotId
    });

    setImmediate(async () => {
      try {
        console.log(`[Perplexity Research] Starting location research for snapshot ${snapshotId}...`);
        const startTime = Date.now();
        
        const research = await perplexity.researchLocationConditions(lat, lng, city, state);
        const totalLatency = Date.now() - startTime;
        
        for (const queryResult of research.queries) {
          if (queryResult.success) {
            await pool.query(
              `INSERT INTO perplexity_research 
               (snapshot_id, lat, lng, city, state, query_type, perplexity_query, answer, citations, impact_level, model_name, latency_ms, status, metadata)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
              [
                snapshotId,
                lat,
                lng,
                city,
                state,
                queryResult.data.type,
                queryResult.data.query,
                queryResult.data.answer,
                JSON.stringify(queryResult.data.citations || []),
                queryResult.data.impact_level,
                queryResult.data.model,
                queryResult.data.latency_ms,
                'completed',
                JSON.stringify({ timestamp: queryResult.data.timestamp })
              ]
            );
          } else {
            await pool.query(
              `INSERT INTO perplexity_research 
               (snapshot_id, lat, lng, city, state, query_type, perplexity_query, status, metadata)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                snapshotId,
                lat,
                lng,
                city,
                state,
                queryResult.type,
                '',
                'failed',
                JSON.stringify({ error: queryResult.error })
              ]
            );
          }
        }
        
        console.log(`[Perplexity Research] ✅ Completed for snapshot ${snapshotId} in ${totalLatency}ms (${research.successfulQueries}/${research.totalQueries} successful)`);
      } catch (error) {
        console.error('[Perplexity Research] Background research failed:', error);
      }
    });
  } catch (error) {
    console.error('[Research API] Location research error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Eidolon chatbot endpoint - GPT-5 with snapshot + Perplexity context
router.post('/chat', async (req, res) => {
  try {
    const { snapshotId, message, conversationHistory = [] } = req.body;
    
    if (!snapshotId || !message) {
      return res.status(400).json({
        error: 'Missing required fields: snapshotId, message'
      });
    }

    // Fetch snapshot data
    const snapshotResult = await pool.query(
      `SELECT 
        snapshot_id, lat, lng, city, state, country, formatted_address,
        day_part_key, dow, hour, timezone, local_iso,
        weather, air, airport_context, h3_r8, created_at
       FROM snapshots WHERE snapshot_id = $1`,
      [snapshotId]
    );

    if (snapshotResult.rows.length === 0) {
      return res.status(404).json({ error: 'Snapshot not found' });
    }

    const snapshot = snapshotResult.rows[0];

    // Fetch Perplexity research
    const researchResult = await pool.query(
      `SELECT query_type, perplexity_query, answer, citations, impact_level, created_at
       FROM perplexity_research 
       WHERE snapshot_id = $1 AND status = 'completed'
       ORDER BY created_at ASC`,
      [snapshotId]
    );

    // Fetch Claude strategy
    const strategyResult = await pool.query(
      `SELECT strategy FROM strategies WHERE snapshot_id = $1 AND status = 'ok' LIMIT 1`,
      [snapshotId]
    );

    // Fetch venue recommendations
    const venuesResult = await pool.query(
      `SELECT rc.name, rc.lat, rc.lng, rc.drive_time_min, rc.model_score, rc.rank, rc.features
       FROM ranking_candidates rc
       JOIN rankings r ON r.ranking_id = rc.ranking_id
       WHERE r.snapshot_id = $1
       ORDER BY rc.rank ASC
       LIMIT 10`,
      [snapshotId]
    );

    // Build context for GPT-5
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const contextParts = [
      `## Current Driver Location Context`,
      `- **Location**: ${snapshot.city || 'Unknown'}, ${snapshot.state || 'Unknown'}`,
      `- **Coordinates**: ${snapshot.lat}, ${snapshot.lng}`,
      `- **Time**: ${dayNames[snapshot.dow]} ${snapshot.hour}:00 (${snapshot.day_part_key})`,
      `- **Weather**: ${snapshot.weather ? `${snapshot.weather.tempF}°F, ${snapshot.weather.conditions}` : 'Unknown'}`,
      `- **Air Quality**: ${snapshot.air ? `AQI ${snapshot.air.aqi} (${snapshot.air.category})` : 'Unknown'}`,
      snapshot.airport_context ? `- **Nearby Airport**: ${snapshot.airport_context.airport_name} (${snapshot.airport_context.airport_code}), ${snapshot.airport_context.delay_minutes || 0} min delays` : '',
      '',
      `## Strategic Analysis (Claude Sonnet 4.5)`,
      strategyResult.rows[0]?.strategy || 'No strategy available',
      '',
      `## Recommended Venues`,
      venuesResult.rows.map((v, i) => `${i + 1}. **${v.name}** - ${v.drive_time_min} min drive, score: ${v.model_score?.toFixed(2) || 'N/A'}`).join('\n'),
      '',
      `## Real-Time Intelligence (Perplexity)`,
      researchResult.rows.map(r => `**${r.query_type.replace(/_/g, ' ').toUpperCase()}** (${r.impact_level || 'low'}): ${r.answer}`).join('\n\n')
    ].filter(Boolean).join('\n');

    const systemPrompt = `You are Eidolon, an AI assistant for rideshare drivers. You have access to real-time location data, strategic recommendations, and local intelligence.

Your role is to help drivers make informed decisions about where to go, what to avoid, and how to maximize earnings.

Use the provided context to answer questions accurately. If the driver asks "where should I go now", recommend venues from the list. If they ask about safety or road conditions, reference the Perplexity intelligence.

Be concise, practical, and action-oriented. Drivers are working and need quick, clear answers.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'system', content: `## Context for this conversation:\n\n${contextParts}` },
      ...conversationHistory,
      { role: 'user', content: message }
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-5',
      messages,
      max_completion_tokens: parseInt(process.env.OPENAI_MAX_COMPLETION_TOKENS || '64000'),
      temperature: 0.1
    });

    const reply = completion.choices[0].message.content;

    res.json({
      ok: true,
      reply,
      snapshotId,
      contextProvided: {
        hasStrategy: !!strategyResult.rows[0]?.strategy,
        venueCount: venuesResult.rows.length,
        researchCount: researchResult.rows.length
      },
      usage: completion.usage
    });
  } catch (error) {
    console.error('[Research API] Chat error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

export default router;
