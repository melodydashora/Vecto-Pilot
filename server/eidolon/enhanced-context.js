
import { memoryPut, memoryQuery } from "./memory/pg.js";
import { db } from "../db/drizzle.js";
import { snapshots, strategies, actions } from "../../shared/schema.js";
import { desc } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";

const EIDOLON_TABLE = "eidolon_memory";
const CROSS_THREAD_TABLE = "cross_thread_memory";
const AGENT_MEMORY_TABLE = "agent_memory";
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
    eidolonPreferences: {},
    sessionHistory: {},
    projectState: {},
    conversationHistory: [],

    // Thread awareness
    threadContext: null,

    // Repository structure
    repositoryStructure: {},
    configFiles: {},
    rootFiles: [],

    // Unified Maximum Capabilities (shared across all AI systems)
    capabilities: {
      // Intelligence & Research
      internetSearch: true,
      claudeWebSearch: true,
      webFetch: true,
      codeExecution: true,
      enhancedMemory: true,
      deepContextAwareness: true,
      threadAwareness: true,
      semanticSearch: true,
      patternRecognition: true,
      extendedThinking: true,
      
      // File System (IDE Integration)
      fullRepoAccess: true,
      fsRead: true,
      fsWrite: true,
      fsDelete: true,
      fsCreate: true,
      fsRename: true,
      
      // Shell & System
      shellExec: true,
      shellUnrestricted: true,
      systemDiagnostics: true,
      processManagement: true,
      
      // Database
      sqlQuery: true,
      sqlExecute: true,
      sqlDDL: true,
      sqlDML: true,
      schemaIntrospection: true,
      
      // Network & API
      httpFetch: true,
      apiIntegration: true,
      websocketAccess: true,
      
      // IDE & Workspace
      ideFullAccess: true,
      workspaceModification: true,
      configManagement: true,
      dependencyManagement: true,
      
      // Autonomy & Self-Healing
      autonomousMode: true,
      selfHealing: true,
      autoRecovery: true,
      errorPrediction: true,
      autoRemediation: true,
      healthMonitoring: true
    },
    
    // Self-healing status
    selfHealing: {
      enabled: true,
      healthScore: 1.0,
      lastCheck: new Date().toISOString(),
      activeRecoveries: 0
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
    console.warn('[Eidolon Enhanced Context] Failed to load recent snapshots:', err.message);
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
    console.warn('[Eidolon Enhanced Context] Failed to load recent strategies:', err.message);
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
    console.warn('[Eidolon Enhanced Context] Failed to load recent actions:', err.message);
  }

  // Gather memory context
  try {
    const prefs = await memoryQuery({ 
      table: EIDOLON_TABLE, 
      scope: "eidolon_preferences", 
      userId: null,
      limit: 50 
    });
    context.eidolonPreferences = Object.fromEntries(
      prefs.map(p => [p.key, p.content])
    );
  } catch (err) {
    console.warn('[Eidolon Enhanced Context] Failed to load preferences:', err.message);
  }

  try {
    const session = await memoryQuery({ 
      table: EIDOLON_TABLE, 
      scope: "session_state", 
      userId: null,
      limit: 20 
    });
    context.sessionHistory = Object.fromEntries(
      session.map(s => [s.key, s.content])
    );
  } catch (err) {
    console.warn('[Eidolon Enhanced Context] Failed to load session history:', err.message);
  }

  try {
    const state = await memoryQuery({ 
      table: EIDOLON_TABLE, 
      scope: "project_state", 
      userId: null,
      limit: 20 
    });
    context.projectState = Object.fromEntries(
      state.map(s => [s.key, s.content])
    );
  } catch (err) {
    console.warn('[Eidolon Enhanced Context] Failed to load project state:', err.message);
  }

  try {
    const convs = await memoryQuery({
      table: EIDOLON_TABLE,
      scope: "conversations",
      userId: null,
      limit: 30,
    });
    context.conversationHistory = convs.map(c => c.content);
  } catch (err) {
    console.warn('[Eidolon Enhanced Context] Failed to load conversation history:', err.message);
  }

  // Scan repository structure
  try {
    const rootFiles = await fs.readdir(BASE_DIR);
    context.rootFiles = rootFiles;

    // Read key config files
    const configFilesToRead = [
      ".env.example",
      ".replit",
      "package.json",
      "tsconfig.json",
      "drizzle.config.ts",
      "config/assistant-policy.json",
      "config/agent-policy.json",
      "config/eidolon-policy.json",
      "server/config/assistant-policy.json",
      "server/config/agent-policy.json",
      "server/config/eidolon-policy.json",
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

// Internet search capabilities using Claude Opus 4.5 with web_search tool
export async function performInternetSearch(query, userId = null) {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!ANTHROPIC_API_KEY) {
    return {
      ok: false,
      error: "ANTHROPIC_API_KEY not configured",
      suggestion: "Add ANTHROPIC_API_KEY to .env to enable internet search"
    };
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-fetch-2025-09-10",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-opus-4-5-20251101",
        max_tokens: 4096,
        system: "You are Eidolon, a research assistant with deep technical knowledge. Provide accurate, up-to-date information with citations from web search results.",
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 5,
            user_location: {
              type: "approximate",
              country: "US",
              timezone: "America/Chicago"
            }
          },
          {
            type: "web_fetch_20250910",
            name: "web_fetch",
            max_uses: 5
          }
        ],
        tool_choice: { type: "auto" },
        messages: [
          {
            role: "user",
            content: query
          }
        ]
      })
    });

    const data = await response.json();
    const result = data.content?.find(c => c.type === "text")?.text || "";

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
        model: "claude-opus-4-5-20251101",
        tool_used: "web_search",
        identity: "eidolon"
      },
      ttlDays: 30,
    });

    return {
      ok: true,
      query,
      result,
      timestamp: new Date().toISOString(),
      model: "claude-opus-4-5-20251101",
      identity: "eidolon"
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
    identity: "eidolon"
  };

  // Database statistics
  try {
    const { sql } = await import("drizzle-orm");
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
    const { sql } = await import("drizzle-orm");
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

// Store agent-specific memory
export async function storeAgentMemory(title, content, metadata = {}, ttlDays = 730) {
  try {
    const { getSharedPool } = await import("../db/pool.js");
    const pool = getSharedPool();
    if (!pool) return false;
    
    await pool.query(
      `INSERT INTO ${AGENT_MEMORY_TABLE} (session_id, entry_type, title, content, metadata, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'eidolon',
        'context',
        title,
        content,
        JSON.stringify(metadata),
        new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
      ]
    );
    return true;
  } catch (err) {
    console.warn('[Eidolon Enhanced Context] Failed to store agent memory:', err.message);
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

// Get agent memory
export async function getAgentMemory(userId = null, limit = 50) {
  try {
    const { getSharedPool } = await import("../db/pool.js");
    const pool = getSharedPool();
    if (!pool) return [];
    
    const result = await pool.query(
      `SELECT id, entry_type, title, content, metadata, created_at 
       FROM ${AGENT_MEMORY_TABLE} 
       WHERE session_id = 'eidolon'
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
      timestamp: r.created_at,
      identity: "eidolon"
    }));
  } catch (err) {
    console.warn('[Eidolon Enhanced Context] Failed to load agent memory:', err.message);
    return [];
  }
}
