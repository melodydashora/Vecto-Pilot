import { memoryGet, memoryPut, memoryQuery } from "../eidolon/memory/pg.js";
import { db } from "../db/drizzle.js";
import { snapshots, strategies, actions, rankings } from "../../shared/schema.js";
import { desc, eq, sql } from "drizzle-orm";

const ASSISTANT_TABLE = "assistant_memory";
const EIDOLON_TABLE = "eidolon_memory";

export async function getProjectContext() {
  const context = {
    currentTime: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    workspace: process.cwd(),
    
    recentSnapshots: [],
    recentStrategies: [],
    recentActions: [],
    
    userPreferences: {},
    sessionHistory: {},
    projectState: {},
  };
  
  try {
    const snaps = await db.select().from(snapshots).orderBy(desc(snapshots.created_at)).limit(5);
    context.recentSnapshots = snaps.map(s => ({
      id: s.snapshot_id,
      city: s.city,
      state: s.state,
      dayPart: s.day_part_key,
      created: s.created_at,
    }));
  } catch {}
  
  try {
    const strats = await db.select().from(strategies).orderBy(desc(strategies.created_at)).limit(3);
    context.recentStrategies = strats.map(s => ({
      id: s.id,
      snapshotId: s.snapshot_id,
      preview: s.strategy?.substring(0, 100),
      created: s.created_at,
    }));
  } catch {}
  
  try {
    const acts = await db.select().from(actions).orderBy(desc(actions.created_at)).limit(10);
    context.recentActions = acts.map(a => ({
      id: a.action_id,
      action: a.action,
      blockId: a.block_id,
      created: a.created_at,
    }));
  } catch {}
  
  try {
    const prefs = await memoryQuery({ 
      table: ASSISTANT_TABLE, 
      scope: "user_preferences", 
      userId: "system", 
      limit: 20 
    });
    context.userPreferences = Object.fromEntries(
      prefs.map(p => [p.key, p.content])
    );
  } catch {}
  
  try {
    const session = await memoryQuery({ 
      table: EIDOLON_TABLE, 
      scope: "session_state", 
      userId: "system", 
      limit: 10 
    });
    context.sessionHistory = Object.fromEntries(
      session.map(s => [s.key, s.content])
    );
  } catch {}
  
  try {
    const state = await memoryQuery({ 
      table: EIDOLON_TABLE, 
      scope: "project_state", 
      userId: "system", 
      limit: 10 
    });
    context.projectState = Object.fromEntries(
      state.map(s => [s.key, s.content])
    );
  } catch {}
  
  return context;
}

export async function saveUserPreference(key, value, userId = "system") {
  await memoryPut({
    table: ASSISTANT_TABLE,
    scope: "user_preferences",
    key,
    userId,
    content: value,
    ttlDays: 365,
  });
  
  return { ok: true, key, value };
}

export async function saveSessionState(key, value, userId = "system") {
  await memoryPut({
    table: EIDOLON_TABLE,
    scope: "session_state",
    key,
    userId,
    content: value,
    ttlDays: 7,
  });
  
  return { ok: true, key, value };
}

export async function saveProjectState(key, value, userId = "system") {
  await memoryPut({
    table: EIDOLON_TABLE,
    scope: "project_state",
    key,
    userId,
    content: value,
    ttlDays: 365,
  });
  
  return { ok: true, key, value };
}

export async function rememberConversation(topic, summary, userId = "system") {
  const timestamp = Date.now();
  await memoryPut({
    table: ASSISTANT_TABLE,
    scope: "conversations",
    key: `conv_${timestamp}`,
    userId,
    content: { topic, summary, timestamp },
    ttlDays: 30,
  });
  
  return { ok: true, topic, timestamp };
}

export async function getRecentConversations(userId = "system", limit = 10) {
  const convs = await memoryQuery({
    table: ASSISTANT_TABLE,
    scope: "conversations",
    userId,
    limit,
  });
  
  return convs.map(c => c.content);
}

export async function getProjectSummary() {
  const ctx = await getProjectContext();
  
  const summary = {
    status: "operational",
    lastActivity: ctx.recentSnapshots[0]?.created || null,
    totalSnapshots: ctx.recentSnapshots.length,
    totalStrategies: ctx.recentStrategies.length,
    totalActions: ctx.recentActions.length,
    environment: ctx.environment,
    currentLocation: ctx.recentSnapshots[0] ? 
      `${ctx.recentSnapshots[0].city}, ${ctx.recentSnapshots[0].state}` : 
      null,
    userPreferences: Object.keys(ctx.userPreferences).length,
  };
  
  try {
    const stats = await db.execute(sql`
      SELECT 
        (SELECT COUNT(*) FROM snapshots) as snapshot_count,
        (SELECT COUNT(*) FROM strategies) as strategy_count,
        (SELECT COUNT(*) FROM actions) as action_count,
        (SELECT COUNT(*) FROM rankings) as ranking_count
    `);
    
    if (stats.rows && stats.rows[0]) {
      summary.totalSnapshotsEver = parseInt(stats.rows[0].snapshot_count);
      summary.totalStrategiesEver = parseInt(stats.rows[0].strategy_count);
      summary.totalActionsEver = parseInt(stats.rows[0].action_count);
      summary.totalRankingsEver = parseInt(stats.rows[0].ranking_count);
    }
  } catch {}
  
  return summary;
}
