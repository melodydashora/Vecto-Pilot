import express from 'express';
import crypto from 'crypto';
import { db } from '../db/drizzle.js';
import { sql } from 'drizzle-orm';

const router = express.Router();

// GET /api/diagnostics - System health check
router.get('/', async (req, res) => {
  const correlationId = crypto.randomUUID();
  
  try {
    const checks = {};
    const startTime = Date.now();

    // 1. Database connectivity
    try {
      await db.execute(sql`SELECT 1`);
      checks.database = { status: 'ok', message: 'Connected' };
    } catch (err) {
      checks.database = { status: 'error', message: err.message };
    }

    // 2. API keys presence (not values!)
    checks.apiKeys = {
      status: 'ok',
      keys: {
        googleMaps: !!process.env.GOOGLE_MAPS_API_KEY,
        anthropic: !!process.env.ANTHROPIC_API_KEY,
        openai: !!process.env.OPENAI_API_KEY,
        gemini: !!process.env.GOOGLEAQ_API_KEY,
        agentToken: !!process.env.AGENT_TOKEN,
        gwKey: !!process.env.GW_KEY
      }
    };

    // 3. Recent data counts (last 24 hours)
    try {
      const snapshotCount = await db.execute(sql`
        SELECT COUNT(*) as count FROM snapshots 
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `);
      
      const rankingCount = await db.execute(sql`
        SELECT COUNT(*) as count FROM rankings 
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `);
      
      const feedbackCount = await db.execute(sql`
        SELECT COUNT(*) as count FROM venue_feedback 
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `);

      checks.recentActivity = {
        status: 'ok',
        snapshots24h: Number(snapshotCount.rows?.[0]?.count || 0),
        rankings24h: Number(rankingCount.rows?.[0]?.count || 0),
        feedback24h: Number(feedbackCount.rows?.[0]?.count || 0)
      };
    } catch (err) {
      checks.recentActivity = { status: 'error', message: err.message };
    }

    // 4. Triad pipeline status
    try {
      const triadJobs = await db.execute(sql`
        SELECT status, COUNT(*) as count FROM triad_jobs 
        WHERE created_at > NOW() - INTERVAL '1 hour'
        GROUP BY status
      `);

      const jobsByStatus = {};
      for (const row of triadJobs.rows || []) {
        jobsByStatus[row.status] = Number(row.count);
      }

      checks.triadPipeline = {
        status: 'ok',
        jobsLast1h: jobsByStatus
      };
    } catch (err) {
      checks.triadPipeline = { status: 'error', message: err.message };
    }

    // 5. Database table sizes
    try {
      const tableSizes = await db.execute(sql`
        SELECT 
          schemaname,
          tablename,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
        FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
        LIMIT 10
      `);

      checks.databaseSize = {
        status: 'ok',
        topTables: (tableSizes.rows || []).map(r => ({
          table: r.tablename,
          size: r.size
        }))
      };
    } catch (err) {
      checks.databaseSize = { status: 'error', message: err.message };
    }

    // 6. Venue catalog stats
    try {
      const venueCount = await db.execute(sql`
        SELECT COUNT(*) as count FROM venue_catalog
      `);
      
      const categoryBreakdown = await db.execute(sql`
        SELECT category, COUNT(*) as count 
        FROM venue_catalog 
        GROUP BY category 
        ORDER BY count DESC
      `);

      checks.venueCatalog = {
        status: 'ok',
        totalVenues: Number(venueCount.rows?.[0]?.count || 0),
        byCategory: (categoryBreakdown.rows || []).map(r => ({
          category: r.category,
          count: Number(r.count)
        }))
      };
    } catch (err) {
      checks.venueCatalog = { status: 'error', message: err.message };
    }

    // Overall status
    const hasErrors = Object.values(checks).some(c => c.status === 'error');
    const overallStatus = hasErrors ? 'degraded' : 'healthy';

    res.json({
      ok: true,
      status: overallStatus,
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - startTime,
      checks
    });

  } catch (error) {
    console.error('[diagnostics] System check failed', { 
      correlation_id: correlationId, 
      error: error.message 
    });
    res.status(500).json({ 
      ok: false, 
      status: 'error',
      error: error.message 
    });
  }
});

export default router;
