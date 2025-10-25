import { memoryGet, memoryPut, memoryQuery } from "../eidolon/memory/pg.js";
import { db } from "../db/drizzle.js";
import { snapshots, strategies, actions, rankings } from "../../shared/schema.js";
import { desc, eq, sql } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";
import { getThreadAwareContext } from "./thread-context.js";

const ASSISTANT_TABLE = "assistant_memory";
const EIDOLON_TABLE = "eidolon_memory";
const CROSS_THREAD_TABLE = "cross_thread_memory"; // Assuming this table exists
const AGENT_MEMORY_TABLE = "agent_memory"; // Assuming this table exists
const BASE_DIR = process.env.BASE_DIR || process.cwd();

// Enhanced context gathering with full repo access
export async function getEnhancedProjectContext(options = {}) {
  const { threadId = null, includeThreadContext = true } = options;

  const context = {
    currentTime: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    workspace: process.cwd(),

    // Database context
    recentSnapshots: [],
    recentStrategies: [],
    recentActions: [],

    // Memory context
    userPreferences: {},
    sessionHistory: {},
    projectState: {},
    conversationHistory: [],

    // Thread awareness (ENHANCED)
    threadContext: null,

    // Repository structure
    repositoryStructure: {},
    configFiles: {},
    rootFiles: [],

    // Capabilities
    capabilities: {
      internetSearch: true,
      perplexityResearch: true,
      fullRepoAccess: true,
      enhancedMemory: true,
      deepContextAwareness: true,
      threadAwareness: true // NEW capability
    }
  };

  // Gather database context
  try {
    const snaps = await db.select().from(snapshots).orderBy(desc(snapshots.created_at)).limit(10);
    context.recentSnapshots = snaps.map(s => ({
      id: s.snapshot_id,
      city: s.city,
      state: s.state,
      dayPart: s.day_part_key,
      created: s.created_at,
      weather: s.weather_condition,
      temperature: s.temperature_f,
    }));
  } catch (err) {
    console.warn('[Enhanced Context] Failed to load recent snapshots:', err.message);
  }

  try {
    const strats = await db.select().from(strategies).orderBy(desc(strategies.created_at)).limit(5);
    context.recentStrategies = strats.map(s => ({
      id: s.id,
      snapshotId: s.snapshot_id,
      preview: s.strategy?.substring(0, 150),
      created: s.created_at,
    }));
  } catch (err) {
    console.warn('[Enhanced Context] Failed to load recent strategies:', err.message);
  }

  try {
    const acts = await db.select().from(actions).orderBy(desc(actions.created_at)).limit(20);
    context.recentActions = acts.map(a => ({
      id: a.action_id,
      action: a.action,
      blockId: a.block_id,
      created: a.created_at,
    }));
  } catch (err) {
    console.warn('[Enhanced Context] Failed to load recent actions:', err.message);
  }

  // Gather memory context
  try {
    const prefs = await memoryQuery({ 
      table: ASSISTANT_TABLE, 
      scope: "user_preferences", 
      userId: null, // Use null for system-level data (UUID field)
      limit: 50 
    });
    context.userPreferences = Object.fromEntries(
      prefs.map(p => [p.key, p.content])
    );
  } catch (err) {
    console.warn('[Enhanced Context] Failed to load user preferences:', err.message);
  }

  try {
    const session = await memoryQuery({ 
      table: EIDOLON_TABLE, 
      scope: "session_state", 
      userId: null, // Use null for system-level data (UUID field)
      limit: 20 
    });
    context.sessionHistory = Object.fromEntries(
      session.map(s => [s.key, s.content])
    );
  } catch (err) {
    console.warn('[Enhanced Context] Failed to load session history:', err.message);
  }

  try {
    const state = await memoryQuery({ 
      table: EIDOLON_TABLE, 
      scope: "project_state", 
      userId: null, // Use null for system-level data (UUID field)
      limit: 20 
    });
    context.projectState = Object.fromEntries(
      state.map(s => [s.key, s.content])
    );
  } catch (err) {
    console.warn('[Enhanced Context] Failed to load project state:', err.message);
  }

  try {
    const convs = await memoryQuery({
      table: ASSISTANT_TABLE,
      scope: "conversations",
      userId: null, // Use null for system-level data (UUID field)
      limit: 30,
    });
    context.conversationHistory = convs.map(c => c.content);
  } catch (err) {
    console.warn('[Enhanced Context] Failed to load conversation history:', err.message);
  }

  // Thread awareness with cross-thread memory (ENHANCED)
  if (includeThreadContext) {
    try {
      const threadAwareContext = await getThreadAwareContext(threadId);
      context.threadContext = threadAwareContext;

      // Add cross-thread agent memory
      const crossThreadMemory = await memoryQuery({
        table: CROSS_THREAD_TABLE,
        scope: "cross_thread_context",
        userId: null, // Use null for system-level data (UUID field)
        limit: 50
      });
      context.threadContext.crossThreadMemory = crossThreadMemory.map(m => m.content);

      // Agent memory already included in threadAwareContext
      // (agent_memory has different schema, queried directly in getThreadAwareContext)

    } catch (err) {
      console.warn('[Enhanced Context] Thread context unavailable:', err.message);
    }
  }

  // Scan repository structure
  try {
    const rootFiles = await fs.readdir(BASE_DIR);
    context.rootFiles = rootFiles;

    // Read key config files
    const configFilesToRead = [
      ".env.example",
      ".replit",
      ".replit-assistant-override.json",
      "package.json",
      "tsconfig.json",
      "drizzle.config.ts",
      "config/assistant-policy.json",
      "server/config/assistant-policy.json",
    ];

    for (const file of configFilesToRead) {
      try {
        const filePath = path.join(BASE_DIR, file);
        const content = await fs.readFile(filePath, "utf8");
        context.configFiles[file] = {
          path: file,
          preview: content.substring(0, 500),
          size: content.length
        };
      } catch {}
    }
  } catch {}

  return context;
}

// Internet search capabilities
export async function performInternetSearch(query, userId = null) {
  const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

  if (!PERPLEXITY_API_KEY) {
    return {
      ok: false,
      error: "PERPLEXITY_API_KEY not configured",
      suggestion: "Add PERPLEXITY_API_KEY to .env to enable internet search"
    };
  }

  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          {
            role: "system",
            content: "You are a helpful research assistant. Provide accurate, up-to-date information with citations."
          },
          {
            role: "user",
            content: query
          }
        ]
      })
    });

    const data = await response.json();
    const result = data.choices?.[0]?.message?.content || "";

    // Store search result in memory
    await memoryPut({
      table: EIDOLON_TABLE,
      scope: "internet_searches",
      key: `search_${Date.now()}`,
      userId,
      content: {
        query,
        result,
        timestamp: new Date().toISOString(),
      },
      ttlDays: 30,
    });

    return {
      ok: true,
      query,
      result,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message
    };
  }
}

// Deep context analysis
export async function analyzeWorkspaceDeep() {
  const analysis = {
    timestamp: new Date().toISOString(),
    databaseStats: {},
    memoryStats: {},
    codebaseInsights: {},
    recentActivity: {},
  };

  // Database statistics
  try {
    const stats = await db.execute(sql`
      SELECT 
        (SELECT COUNT(*) FROM snapshots) as snapshot_count,
        (SELECT COUNT(*) FROM strategies) as strategy_count,
        (SELECT COUNT(*) FROM actions) as action_count,
        (SELECT COUNT(*) FROM rankings) as ranking_count,
        (SELECT COUNT(*) FROM snapshots WHERE created_at > NOW() - INTERVAL '24 hours') as snapshots_24h,
        (SELECT COUNT(*) FROM strategies WHERE created_at > NOW() - INTERVAL '24 hours') as strategies_24h
    `);

    if (stats.rows && stats.rows[0]) {
      analysis.databaseStats = {
        totalSnapshots: parseInt(stats.rows[0].snapshot_count),
        totalStrategies: parseInt(stats.rows[0].strategy_count),
        totalActions: parseInt(stats.rows[0].action_count),
        totalRankings: parseInt(stats.rows[0].ranking_count),
        snapshots24h: parseInt(stats.rows[0].snapshots_24h),
        strategies24h: parseInt(stats.rows[0].strategies_24h),
      };
    }
  } catch {}

  // Memory statistics
  try {
    const memCount = await db.execute(sql`
      SELECT 
        (SELECT COUNT(*) FROM assistant_memory) as assistant_entries,
        (SELECT COUNT(*) FROM eidolon_memory) as eidolon_entries
    `);

    if (memCount.rows && memCount.rows[0]) {
      analysis.memoryStats = {
        assistantEntries: parseInt(memCount.rows[0].assistant_entries),
        eidolonEntries: parseInt(memCount.rows[0].eidolon_entries),
      };
    }
  } catch {}

  // Recent activity patterns
  try {
    const recentSnap = await db.select().from(snapshots).orderBy(desc(snapshots.created_at)).limit(1);
    if (recentSnap.length > 0) {
      analysis.recentActivity = {
        lastSnapshot: recentSnap[0].created_at,
        lastLocation: `${recentSnap[0].city}, ${recentSnap[0].state}`,
        lastDayPart: recentSnap[0].day_part_key,
      };
    }
  } catch {}

  return analysis;
}

// Store cross-thread memory
export async function storeCrossThreadMemory(key, content, userId = null, ttlDays = 730) {
  return await memoryPut({
    table: CROSS_THREAD_TABLE,
    scope: "cross_thread_context",
    key,
    userId,
    content,
    ttlDays,
  });
}

// Store agent-specific memory - agent_memory has different schema, insert directly
export async function storeAgentMemory(title, content, metadata = {}, ttlDays = 730) {
  try {
    const { getSharedPool } = await import("../db/pool.js");
    const pool = getSharedPool();
    if (!pool) return false;
    
    await pool.query(
      `INSERT INTO agent_memory (session_id, entry_type, title, content, metadata, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'system',
        'context',
        title,
        content,
        JSON.stringify(metadata),
        new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
      ]
    );
    return true;
  } catch (err) {
    console.warn('[Enhanced Context] Failed to store agent memory:', err.message);
    return false;
  }
}

// Get cross-thread memory
export async function getCrossThreadMemory(userId = null, limit = 50) {
  const memory = await memoryQuery({
    table: CROSS_THREAD_TABLE,
    scope: "cross_thread_context",
    userId,
    limit
  });
  return memory.map(m => m.content);
}

// Get agent memory - agent_memory has different schema, query directly via pool
export async function getAgentMemory(userId = null, limit = 50) {
  try {
    const { getSharedPool } = await import("../db/pool.js");
    const pool = getSharedPool();
    if (!pool) return [];
    
    const result = await pool.query(
      `SELECT id, entry_type, title, content, metadata, created_at 
       FROM agent_memory 
       ORDER BY created_at DESC 
       LIMIT $1`,
      [limit]
    );
    
    return result.rows.map(r => ({
      id: r.id,
      type: r.entry_type,
      title: r.title,
      content: r.content,
      metadata: r.metadata,
      timestamp: r.created_at
    }));
  } catch (err) {
    console.warn('[Enhanced Context] Failed to load agent memory:', err.message);
    return [];
  }
}