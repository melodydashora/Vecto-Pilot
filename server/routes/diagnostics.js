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

// GET /diagnostics/workflow-prereqs - Check workflow prerequisites
router.get('/workflow-prereqs', async (req, res) => {
  try {
    const result = { checks: {} };

    // 1. DB connectivity
    try {
      await db.execute(sql`SELECT 1`);
      result.checks.db = 'ok';
    } catch (err) {
      result.checks.db = { status: 'error', message: err.message };
    }

    // 2. Current window (latest snapshot with valid strategy)
    try {
      const latestSnapshot = await db.execute(sql`
        SELECT s.snapshot_id, s.created_at, st.snapshot_id as has_strategy
        FROM snapshots s
        LEFT JOIN strategies st ON st.snapshot_id = s.snapshot_id
        ORDER BY s.created_at DESC
        LIMIT 1
      `);
      
      if (latestSnapshot.rows?.length > 0) {
        const snap = latestSnapshot.rows[0];
        result.checks.window = snap.has_strategy ? 'present_with_strategy' : 'present_no_strategy';
        result.latestSnapshotId = snap.snapshot_id;
      } else {
        result.checks.window = 'no_snapshots';
      }
    } catch (err) {
      result.checks.window = { status: 'error', message: err.message };
    }

    // 3. Queued triad jobs
    try {
      const jobCounts = await db.execute(sql`
        SELECT status, COUNT(*) as count 
        FROM triad_jobs 
        WHERE created_at > NOW() - INTERVAL '1 hour'
        GROUP BY status
      `);

      const jobs = {};
      for (const row of jobCounts.rows || []) {
        jobs[row.status] = Number(row.count);
      }

      result.checks.jobs = jobs;
      result.checks.queuedCount = jobs.queued || 0;
    } catch (err) {
      result.checks.jobs = { status: 'error', message: err.message };
    }

    // 4. Worker locks
    try {
      const activeLocks = await db.execute(sql`
        SELECT lock_key, owner_id, 
               EXTRACT(EPOCH FROM (expires_at - NOW()))::int as ttl_seconds
        FROM worker_locks 
        WHERE expires_at > NOW()
      `);

      result.checks.activeLocks = activeLocks.rows?.length || 0;
      if (activeLocks.rows?.length > 0) {
        result.lockDetails = activeLocks.rows;
      }
    } catch (err) {
      result.checks.activeLocks = { status: 'error', message: err.message };
    }

    const allOk = 
      result.checks.db === 'ok' && 
      (result.checks.window === 'present_with_strategy' || result.checks.window === 'present_no_strategy');

    res.json({ 
      ok: allOk, 
      ...result,
      timestamp: new Date().toISOString() 
    });
  } catch (err) {
    console.error('[diagnostics/workflow-prereqs] Error:', err);
    res.status(500).json({ 
      ok: false, 
      error: err.message,
      timestamp: new Date().toISOString() 
    });
  }
});

// GET /diagnostics/model-ping - Test model reachability with minimal prompts
router.get('/model-ping', async (req, res) => {
  const results = {};
  const timeout = 8000; // 8s timeout per model

  // Claude (Anthropic)
  try {
    const start = Date.now();
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    
    if (!process.env.ANTHROPIC_API_KEY) {
      results.claude = { status: 'no_api_key' };
    } else {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const modelId = process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';
        const response = await anthropic.messages.create({
          model: modelId,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'ping' }]
        });

        clearTimeout(timeoutId);
        results.claude = {
          status: 'ok',
          latency_ms: Date.now() - start,
          response_preview: response.content[0]?.text?.substring(0, 50)
        };
      } catch (err) {
        clearTimeout(timeoutId);
        results.claude = {
          status: err.name === 'AbortError' ? 'timeout' : 'error',
          latency_ms: Date.now() - start,
          message: err.message
        };
      }
    }
  } catch (err) {
    results.claude = { status: 'error', message: err.message };
  }

  // Gemini (Google)
  try {
    const start = Date.now();
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    
    if (!process.env.GOOGLEAQ_API_KEY) {
      results.gemini = { status: 'no_api_key' };
    } else {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const genAI = new GoogleGenerativeAI(process.env.GOOGLEAQ_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
        const result = await model.generateContent('ping', { signal: controller.signal });
        
        clearTimeout(timeoutId);
        results.gemini = {
          status: 'ok',
          latency_ms: Date.now() - start,
          response_preview: result.response.text()?.substring(0, 50)
        };
      } catch (err) {
        clearTimeout(timeoutId);
        results.gemini = {
          status: err.name === 'AbortError' ? 'timeout' : 'error',
          latency_ms: Date.now() - start,
          message: err.message
        };
      }
    }
  } catch (err) {
    results.gemini = { status: 'error', message: err.message };
  }

  // OpenAI (GPT)
  try {
    const start = Date.now();
    const { default: OpenAI } = await import('openai');
    
    if (!process.env.OPENAI_API_KEY) {
      results.gpt = { status: 'no_api_key' };
    } else {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const response = await openai.chat.completions.create({
          model: 'gpt-4o',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'ping' }]
        }, { signal: controller.signal });

        clearTimeout(timeoutId);
        results.gpt = {
          status: 'ok',
          latency_ms: Date.now() - start,
          response_preview: response.choices[0]?.message?.content?.substring(0, 50)
        };
      } catch (err) {
        clearTimeout(timeoutId);
        results.gpt = {
          status: err.name === 'AbortError' ? 'timeout' : 'error',
          latency_ms: Date.now() - start,
          message: err.message
        };
      }
    }
  } catch (err) {
    results.gpt = { status: 'error', message: err.message };
  }

  const allOk = Object.values(results).every(r => r.status === 'ok');
  
  console.log(`[diagnostics/model-ping] Claude:${results.claude?.status} Gemini:${results.gemini?.status} GPT:${results.gpt?.status}`);

  res.json({
    ok: allOk,
    models: results,
    timestamp: new Date().toISOString()
  });
});

// GET /diagnostics/workflow-dry-run - Minimal workflow dry-run without DB writes
router.get('/workflow-dry-run', async (req, res) => {
  const report = { steps: {} };

  try {
    // Step 1: Latest snapshot
    const snapshotResult = await db.execute(sql`
      SELECT snapshot_id, lat, lng, formatted_address, city, state, created_at
      FROM snapshots
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (!snapshotResult.rows?.length) {
      report.steps.snapshot = { status: 'no_data', message: 'No snapshots in database' };
      return res.json({ ok: false, report, timestamp: new Date().toISOString() });
    }

    const snapshot = snapshotResult.rows[0];
    report.steps.snapshot = { status: 'ok', snapshot_id: snapshot.snapshot_id };

    // Step 2: Check for existing strategy
    const strategyResult = await db.execute(sql`
      SELECT snapshot_id, created_at
      FROM strategies
      WHERE snapshot_id = ${snapshot.snapshot_id}
      LIMIT 1
    `);

    if (strategyResult.rows?.length > 0) {
      report.steps.strategy = { 
        status: 'exists', 
        snapshot_id: strategyResult.rows[0].snapshot_id,
        note: 'Strategy already generated for this snapshot'
      };
    } else {
      report.steps.strategy = { 
        status: 'missing',
        note: 'Would trigger strategy generation in real workflow'
      };
    }

    // Step 3: Minimal model call (just test reachability, don't generate full strategy)
    const start = Date.now();
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const modelId = process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';
      
      await anthropic.messages.create({
        model: modelId,
        max_tokens: 20,
        messages: [{ 
          role: 'user', 
          content: `Test prompt for location: ${snapshot.city}, ${snapshot.state}` 
        }]
      });

      report.steps.model_call = {
        status: 'ok',
        latency_ms: Date.now() - start
      };
    } catch (err) {
      report.steps.model_call = {
        status: 'error',
        latency_ms: Date.now() - start,
        message: err.message
      };
    }

    // Step 4: Check venues available for ranking
    const venueResult = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM venue_catalog
      WHERE city = ${snapshot.city}
    `);

    report.steps.venues = {
      status: 'ok',
      count: Number(venueResult.rows?.[0]?.count || 0)
    };

    const allOk = 
      report.steps.snapshot.status === 'ok' &&
      report.steps.model_call?.status === 'ok' &&
      report.steps.venues.status === 'ok';

    res.json({
      ok: allOk,
      report,
      snapshotContext: {
        snapshot_id: snapshot.snapshot_id,
        location: `${snapshot.city}, ${snapshot.state}`,
        created_at: snapshot.created_at
      },
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('[diagnostics/workflow-dry-run] Error:', err);
    res.status(500).json({
      ok: false,
      error: err.message,
      report,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
