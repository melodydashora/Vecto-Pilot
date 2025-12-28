#!/usr/bin/env node
/**
 * Memory CLI - Convenience script for memory operations
 *
 * Usage:
 *   node scripts/memory-cli.mjs get [key]              - Get a specific memory
 *   node scripts/memory-cli.mjs list [scope] [limit]   - List memories in scope
 *   node scripts/memory-cli.mjs set [key] [value]      - Store a memory
 *   node scripts/memory-cli.mjs log [topic] [summary]  - Log a conversation
 *   node scripts/memory-cli.mjs context                - Get full context
 *   node scripts/memory-cli.mjs stats                  - Get memory statistics
 *
 * Environment:
 *   BASE_URL - API base URL (default: http://localhost:5000)
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

async function fetchJson(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    return await res.json();
  } catch (err) {
    console.error(`Request failed: ${err.message}`);
    process.exit(1);
  }
}

async function getContext() {
  const data = await fetchJson('/agent/context');
  if (data.ok) {
    console.log('\n=== Memory Context ===\n');

    console.log('📊 Database Stats:');
    console.log(`   Snapshots: ${data.context.recentSnapshots?.length || 0} recent`);
    console.log(`   Strategies: ${data.context.recentStrategies?.length || 0} recent`);
    console.log(`   Actions: ${data.context.recentActions?.length || 0} recent`);

    console.log('\n🧠 Memory Stats:');
    console.log(`   Preferences: ${Object.keys(data.context.agentPreferences || {}).length} entries`);
    console.log(`   Session History: ${Object.keys(data.context.sessionHistory || {}).length} entries`);
    console.log(`   Project State: ${Object.keys(data.context.projectState || {}).length} entries`);
    console.log(`   Conversations: ${data.context.conversationHistory?.length || 0} logged`);

    console.log('\n⚙️ Capabilities:');
    const caps = data.context.capabilities || {};
    const enabled = Object.entries(caps).filter(([_, v]) => v).length;
    console.log(`   ${enabled}/${Object.keys(caps).length} capabilities enabled`);

    console.log('\n🔄 Self-Healing:');
    const sh = data.context.selfHealing || {};
    console.log(`   Enabled: ${sh.enabled}`);
    console.log(`   Health Score: ${sh.healthScore}`);
    console.log(`   Last Check: ${sh.lastCheck}`);
  } else {
    console.error('Failed to get context:', data.error);
  }
}

async function getStats() {
  const data = await fetchJson('/agent/context/summary');
  if (data.ok) {
    console.log('\n=== Workspace Statistics ===\n');

    const db = data.summary.databaseStats || {};
    console.log('📊 Database:');
    console.log(`   Total Snapshots: ${db.totalSnapshots || 0}`);
    console.log(`   Total Strategies: ${db.totalStrategies || 0}`);
    console.log(`   Total Actions: ${db.totalActions || 0}`);
    console.log(`   Total Rankings: ${db.totalRankings || 0}`);
    console.log(`   Snapshots (24h): ${db.snapshots24h || 0}`);
    console.log(`   Strategies (24h): ${db.strategies24h || 0}`);

    const mem = data.summary.memoryStats || {};
    console.log('\n🧠 Memory Tables:');
    console.log(`   agent_memory: ${mem.agentEntries || 0} entries`);
    console.log(`   assistant_memory: ${mem.assistantEntries || 0} entries`);
    console.log(`   eidolon_memory: ${mem.eidolonEntries || 0} entries`);

    const recent = data.summary.recentActivity || {};
    console.log('\n📍 Recent Activity:');
    console.log(`   Last Snapshot: ${recent.lastSnapshot || 'none'}`);
    console.log(`   Location: ${recent.lastLocation || 'unknown'}`);
    console.log(`   Day Part: ${recent.lastDayPart || 'unknown'}`);
  } else {
    console.error('Failed to get stats:', data.error);
  }
}

async function listConversations(limit = 10) {
  const data = await fetchJson(`/agent/memory/conversations?limit=${limit}`);
  if (data.ok) {
    console.log(`\n=== Recent Conversations (${data.conversations?.length || 0}) ===\n`);
    for (const conv of data.conversations || []) {
      console.log(`📝 ${conv.topic || 'Untitled'}`);
      console.log(`   ${conv.summary?.slice(0, 100) || 'No summary'}...`);
      console.log(`   ${conv.timestamp || ''}\n`);
    }
  } else {
    console.error('Failed to list conversations:', data.error);
  }
}

async function logConversation(topic, summary) {
  const data = await fetchJson('/agent/memory/conversation', {
    method: 'POST',
    body: JSON.stringify({ topic, summary, userId: 'cli' })
  });
  if (data.ok) {
    console.log(`✅ Conversation logged: "${topic}"`);
  } else {
    console.error('Failed to log conversation:', data.error);
  }
}

async function setPreference(key, value) {
  // Try to parse value as JSON
  let parsedValue;
  try {
    parsedValue = JSON.parse(value);
  } catch {
    parsedValue = value;
  }

  const data = await fetchJson('/agent/memory/preference', {
    method: 'POST',
    body: JSON.stringify({ key, value: parsedValue, userId: 'system' })
  });
  if (data.ok) {
    console.log(`✅ Preference saved: ${key}`);
  } else {
    console.error('Failed to save preference:', data.error);
  }
}

async function setSession(key, value) {
  let parsedValue;
  try {
    parsedValue = JSON.parse(value);
  } catch {
    parsedValue = value;
  }

  const data = await fetchJson('/agent/memory/session', {
    method: 'POST',
    body: JSON.stringify({ key, data: parsedValue, userId: 'system' })
  });
  if (data.ok) {
    console.log(`✅ Session state saved: ${key}`);
  } else {
    console.error('Failed to save session state:', data.error);
  }
}

async function setProject(key, value) {
  let parsedValue;
  try {
    parsedValue = JSON.parse(value);
  } catch {
    parsedValue = value;
  }

  const data = await fetchJson('/agent/memory/project', {
    method: 'POST',
    body: JSON.stringify({ key, data: parsedValue, userId: 'system' })
  });
  if (data.ok) {
    console.log(`✅ Project state saved: ${key}`);
  } else {
    console.error('Failed to save project state:', data.error);
  }
}

// Command line parsing
const [,, command, ...args] = process.argv;

switch (command) {
  case 'context':
    await getContext();
    break;

  case 'stats':
    await getStats();
    break;

  case 'list':
  case 'conversations':
    await listConversations(parseInt(args[0]) || 10);
    break;

  case 'log':
    if (args.length < 2) {
      console.error('Usage: memory-cli.mjs log [topic] [summary]');
      process.exit(1);
    }
    await logConversation(args[0], args.slice(1).join(' '));
    break;

  case 'pref':
  case 'preference':
    if (args.length < 2) {
      console.error('Usage: memory-cli.mjs pref [key] [value]');
      process.exit(1);
    }
    await setPreference(args[0], args.slice(1).join(' '));
    break;

  case 'session':
    if (args.length < 2) {
      console.error('Usage: memory-cli.mjs session [key] [value]');
      process.exit(1);
    }
    await setSession(args[0], args.slice(1).join(' '));
    break;

  case 'project':
    if (args.length < 2) {
      console.error('Usage: memory-cli.mjs project [key] [value]');
      process.exit(1);
    }
    await setProject(args[0], args.slice(1).join(' '));
    break;

  case 'help':
  default:
    console.log(`
Memory CLI - Manage AI memory system

Usage:
  node scripts/memory-cli.mjs <command> [args]

Commands:
  context           Get full memory context (preferences, history, stats)
  stats             Get workspace statistics (DB counts, memory entries)
  list [n]          List recent conversations (default: 10)
  log <topic> <msg> Log a conversation to memory
  pref <key> <val>  Store a user preference (365 day TTL)
  session <k> <v>   Store session state (7 day TTL)
  project <k> <v>   Store project state (30 day TTL)
  help              Show this help message

Examples:
  node scripts/memory-cli.mjs context
  node scripts/memory-cli.mjs stats
  node scripts/memory-cli.mjs list 5
  node scripts/memory-cli.mjs log "Router Refactor" "Completed React Router migration"
  node scripts/memory-cli.mjs pref ai_models '{"strategist":"claude-opus-4-5"}'
  node scripts/memory-cli.mjs session current_task "Working on memory integration"

Environment:
  BASE_URL  API base URL (default: http://localhost:5000)
`);
}
