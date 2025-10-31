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

// GET /api/diagnostics/db-data - Show actual database records
router.get('/db-data', async (req, res) => {
  try {
    const snapshots = await db.execute(sql`
      SELECT snapshot_id, city, state, created_at, 
             news_briefing IS NOT NULL as has_news_briefing,
             news_briefing::text as news_briefing_preview,
             weather IS NOT NULL as has_weather,
             air IS NOT NULL as has_air
      FROM snapshots 
      ORDER BY created_at DESC 
      LIMIT 5
    `);
    
    const jobs = await db.execute(sql`
      SELECT id, snapshot_id, status, created_at 
      FROM triad_jobs 
      ORDER BY created_at DESC 
      LIMIT 5
    `);
    
    const strategies = await db.execute(sql`
      SELECT id, snapshot_id, status, created_at,
             strategy IS NOT NULL as has_strategy,
             strategy,
             error_code,
             error_message,
             latency_ms,
             tokens,
             attempt
      FROM strategies 
      ORDER BY created_at DESC 
      LIMIT 5
    `);
    
    res.json({
      ok: true,
      snapshots: snapshots.rows || [],
      jobs: jobs.rows || [],
      strategies: strategies.rows || []
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/diagnostics/migrate - Run database migrations
router.post('/migrate', async (req, res) => {
  try {
    const results = [];
    
    // Add news_briefing column if missing
    try {
      const checkCol = await db.execute(sql`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'snapshots' AND column_name = 'news_briefing'
      `);
      
      if (checkCol.rows.length === 0) {
        await db.execute(sql`ALTER TABLE snapshots ADD COLUMN news_briefing jsonb`);
        results.push({ table: 'snapshots', column: 'news_briefing', action: 'added' });
      } else {
        results.push({ table: 'snapshots', column: 'news_briefing', action: 'exists' });
      }
    } catch (err) {
      results.push({ table: 'snapshots', column: 'news_briefing', action: 'error', error: err.message });
    }
    
    // Add unique constraints to memory tables
    const memoryTables = ['assistant_memory', 'eidolon_memory', 'cross_thread_memory'];
    
    for (const tableName of memoryTables) {
      try {
        const constraintName = `${tableName}_scope_key_user_id_key`;
        const checkConstraint = await db.execute(sql.raw(`
          SELECT constraint_name 
          FROM information_schema.table_constraints 
          WHERE table_name = '${tableName}' 
            AND constraint_type = 'UNIQUE'
            AND constraint_name = '${constraintName}'
        `));
        
        if (checkConstraint.rows.length === 0) {
          await db.execute(sql.raw(`
            ALTER TABLE ${tableName} 
            ADD CONSTRAINT ${constraintName} 
            UNIQUE (scope, key, user_id)
          `));
          results.push({ table: tableName, constraint: constraintName, action: 'added' });
        } else {
          results.push({ table: tableName, constraint: constraintName, action: 'exists' });
        }
      } catch (err) {
        results.push({ table: tableName, constraint: `unique`, action: 'error', error: err.message });
      }
    }
    
    // List all columns in snapshots
    const cols = await db.execute(sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'snapshots'
      ORDER BY ordinal_position
    `);
    
    res.json({
      ok: true,
      migrations: results,
      snapshotsColumns: cols.rows.map(r => ({ name: r.column_name, type: r.data_type }))
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/diagnostics/worker-status - Check worker configuration
router.get('/worker-status', async (req, res) => {
  try {
    const status = {
      env: {
        ENABLE_BACKGROUND_WORKER: process.env.ENABLE_BACKGROUND_WORKER,
        REPL_ID: !!process.env.REPL_ID,
        K_SERVICE: !!process.env.K_SERVICE,
        CLOUD_RUN_AUTOSCALE: process.env.CLOUD_RUN_AUTOSCALE
      },
      computed: {
        isReplit: !!process.env.REPL_ID,
        isCloudRun: !!(process.env.K_SERVICE || process.env.CLOUD_RUN_AUTOSCALE === '1'),
        isAutoscale: !!(process.env.K_SERVICE || process.env.CLOUD_RUN_AUTOSCALE === '1') && !process.env.REPL_ID,
        shouldEnableWorker: process.env.ENABLE_BACKGROUND_WORKER === 'true' && (!((process.env.K_SERVICE || process.env.CLOUD_RUN_AUTOSCALE === '1') && !process.env.REPL_ID))
      }
    };
    
    // Check for pending/queued jobs
    const pendingJobs = await db.execute(sql`
      SELECT COUNT(*) as count FROM triad_jobs 
      WHERE status IN ('queued', 'running')
    `);
    
    const recentStrategies = await db.execute(sql`
      SELECT snapshot_id, status, 
             strategy IS NOT NULL as has_claude,
             strategy_for_now IS NOT NULL as has_gpt5,
             created_at
      FROM strategies 
      WHERE created_at > NOW() - INTERVAL '10 minutes'
      ORDER BY created_at DESC
      LIMIT 3
    `);
    
    status.jobs = {
      pending: Number(pendingJobs.rows?.[0]?.count || 0)
    };
    
    status.recentStrategies = recentStrategies.rows || [];
    
    res.json(status);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
