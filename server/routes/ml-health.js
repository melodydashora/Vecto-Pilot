// server/routes/ml-health.js
// ML Health Dashboard - Monitor data quality and learning pipeline health
import express from 'express';
import { db } from '../db/drizzle.js';
import { sql } from 'drizzle-orm';
import { recallContext, searchMemory } from '../../gateway-server.js';

const router = express.Router();

// GET /api/ml/health - Comprehensive ML health metrics
router.get('/health', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Parallel queries for all ML data quality metrics
    const [
      snapshotStats,
      strategyStats,
      rankingStats,
      feedbackStats,
      actionStats,
      vectorStats,
      memoryStats,
      recentLearningEvents
    ] = await Promise.all([
      // Snapshots health
      db.execute(sql`
        SELECT 
          COUNT(*) as total_count,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as last_24h,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') as last_hour,
          COUNT(DISTINCT user_id) as unique_users,
          AVG(accuracy) as avg_accuracy
        FROM snapshots
      `),
      
      // Strategies health
      db.execute(sql`
        SELECT 
          COUNT(*) as total_count,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'failed') as failed,
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          AVG(latency_ms) FILTER (WHERE status = 'completed') as avg_latency_ms,
          SUM(tokens) as total_tokens
        FROM strategies
      `),
      
      // Rankings health
      db.execute(sql`
        SELECT 
          COUNT(*) as total_count,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as last_24h,
          AVG(latency_ms) as avg_latency_ms,
          SUM(tokens) as total_tokens
        FROM rankings
      `),
      
      // Feedback coverage
      db.execute(sql`
        SELECT 
          COUNT(*) as total_feedback,
          COUNT(*) FILTER (WHERE sentiment = 'up') as positive,
          COUNT(*) FILTER (WHERE sentiment = 'down') as negative,
          COUNT(DISTINCT ranking_id) as rankings_with_feedback,
          COUNT(DISTINCT place_id) as venues_with_feedback,
          COUNT(*) FILTER (WHERE comment IS NOT NULL AND comment != '') as with_comments
        FROM venue_feedback
      `),
      
      // User actions
      db.execute(sql`
        SELECT 
          COUNT(*) as total_actions,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as last_24h,
          COUNT(DISTINCT action) as unique_action_types,
          COUNT(DISTINCT user_id) as active_users
        FROM actions
      `),
      
      // Vector search readiness
      db.execute(sql`
        SELECT 
          COUNT(*) as total_documents,
          COUNT(*) FILTER (WHERE metadata->>'type' = 'strategy') as strategies_indexed,
          COUNT(*) FILTER (WHERE metadata->>'type' = 'venue_feedback') as feedback_indexed,
          pg_size_pretty(pg_total_relation_size('documents')) as table_size
        FROM documents
      `),
      
      // Assistant memory health
      db.execute(sql`
        SELECT 
          COUNT(*) as total_memories,
          COUNT(DISTINCT scope) as unique_scopes,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as last_24h
        FROM assistant_memory
      `),
      
      // Recent learning events from assistant_memory
      db.execute(sql`
        SELECT scope, key, content->>'event_type' as event_type, created_at
        FROM assistant_memory
        WHERE scope = 'learning_events'
        ORDER BY created_at DESC
        LIMIT 10
      `)
    ]);
    
    // Calculate health scores (0-100)
    const snapshot = snapshotStats.rows[0];
    const strategy = strategyStats.rows[0];
    const ranking = rankingStats.rows[0];
    const feedback = feedbackStats.rows[0];
    const actions = actionStats.rows[0];
    const vectors = vectorStats.rows[0];
    const memory = memoryStats.rows[0];
    
    // Health score calculations
    const calculateHealth = (current, target, maxScore = 100) => {
      return Math.min(Math.round((parseInt(current) / target) * maxScore), maxScore);
    };
    
    const snapshotHealth = calculateHealth(snapshot?.last_24h || 0, 100);
    const strategyHealth = strategy?.total_count > 0 
      ? Math.round((parseInt(strategy.completed) / parseInt(strategy.total_count)) * 100)
      : 0;
    const feedbackCoverage = ranking?.total_count > 0
      ? Math.round((parseInt(feedback.rankings_with_feedback) / parseInt(ranking.total_count)) * 100)
      : 0;
    const vectorIndexCoverage = strategy?.total_count > 0
      ? Math.round((parseInt(vectors.strategies_indexed) / parseInt(strategy.total_count)) * 100)
      : 0;
    
    // Overall ML health score (weighted average)
    const overallHealth = Math.round(
      (snapshotHealth * 0.2) +
      (strategyHealth * 0.3) +
      (feedbackCoverage * 0.3) +
      (vectorIndexCoverage * 0.2)
    );
    
    // Get architecture and deployment memories
    const archMemories = await recallContext('architecture');
    const deployMemories = await recallContext('deployment');
    
    const responseTime = Date.now() - startTime;
    
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      response_time_ms: responseTime,
      overall_health: overallHealth,
      health_status: overallHealth >= 80 ? 'excellent' : 
                    overallHealth >= 60 ? 'good' :
                    overallHealth >= 40 ? 'fair' : 'needs_attention',
      metrics: {
        snapshots: {
          total: parseInt(snapshot?.total_count || 0),
          last_24h: parseInt(snapshot?.last_24h || 0),
          last_hour: parseInt(snapshot?.last_hour || 0),
          unique_users: parseInt(snapshot?.unique_users || 0),
          avg_accuracy: parseFloat(snapshot?.avg_accuracy || 0).toFixed(2),
          health_score: snapshotHealth
        },
        strategies: {
          total: parseInt(strategy?.total_count || 0),
          completed: parseInt(strategy?.completed || 0),
          failed: parseInt(strategy?.failed || 0),
          pending: parseInt(strategy?.pending || 0),
          avg_latency_ms: parseFloat(strategy?.avg_latency_ms || 0).toFixed(0),
          total_tokens: parseInt(strategy?.total_tokens || 0),
          success_rate: strategyHealth
        },
        rankings: {
          total: parseInt(ranking?.total_count || 0),
          last_24h: parseInt(ranking?.last_24h || 0),
          avg_latency_ms: parseFloat(ranking?.avg_latency_ms || 0).toFixed(0),
          total_tokens: parseInt(ranking?.total_tokens || 0)
        },
        feedback: {
          total: parseInt(feedback?.total_feedback || 0),
          positive: parseInt(feedback?.positive || 0),
          negative: parseInt(feedback?.negative || 0),
          rankings_covered: parseInt(feedback?.rankings_with_feedback || 0),
          venues_covered: parseInt(feedback?.venues_with_feedback || 0),
          with_comments: parseInt(feedback?.with_comments || 0),
          coverage_rate: feedbackCoverage
        },
        actions: {
          total: parseInt(actions?.total_actions || 0),
          last_24h: parseInt(actions?.last_24h || 0),
          unique_types: parseInt(actions?.unique_action_types || 0),
          active_users: parseInt(actions?.active_users || 0)
        },
        vector_search: {
          total_documents: parseInt(vectors?.total_documents || 0),
          strategies_indexed: parseInt(vectors?.strategies_indexed || 0),
          feedback_indexed: parseInt(vectors?.feedback_indexed || 0),
          table_size: vectors?.table_size || '0 bytes',
          index_coverage: vectorIndexCoverage
        },
        memory: {
          total_memories: parseInt(memory?.total_memories || 0),
          unique_scopes: parseInt(memory?.unique_scopes || 0),
          last_24h: parseInt(memory?.last_24h || 0),
          architecture_memories: archMemories?.length || 0,
          deployment_memories: deployMemories?.length || 0
        },
        recent_learning: recentLearningEvents.rows.map(e => ({
          event_type: e.event_type,
          scope: e.scope,
          created_at: e.created_at
        }))
      }
    });
    
  } catch (error) {
    console.error('[ml-health] Health check failed:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch ML health metrics',
      message: error.message
    });
  }
});

// GET /api/ml/memory/:scope - Query assistant memory by scope
router.get('/memory/:scope', async (req, res) => {
  try {
    const { scope } = req.params;
    const memories = await recallContext(scope);
    
    res.json({
      ok: true,
      scope,
      count: memories?.length || 0,
      memories: memories || []
    });
  } catch (error) {
    console.error('[ml-health] Memory query failed:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Failed to query memory',
      message: error.message
    });
  }
});

// GET /api/ml/search?q=<term> - Search across all learning data
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 3) {
      return res.status(400).json({
        ok: false,
        error: 'Query must be at least 3 characters'
      });
    }
    
    const results = await searchMemory(q);
    
    res.json({
      ok: true,
      query: q,
      count: results.length,
      results
    });
  } catch (error) {
    console.error('[ml-health] Search failed:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Search failed',
      message: error.message
    });
  }
});

export default router;
