// server/mcp/continuity-tools.js
// MCP tool registrations over the continuity tables.
//
// 2026-09-03: Created with the MCP server. Every write stamps provenance
// (metadata.mcp_client = the connected client's name/version from the MCP
// initialize handshake) so a row written from Cowork / Claude Desktop / a
// custom connector is distinguishable from a Claude Code psql write
// (AI_PARTNERSHIP_AGREEMENT.md §4 provenance rule). Writes are skipped
// entirely (not registered, so not even listed) when readOnly is true.

import { z } from 'zod';
import {
  MEMORY_STATUSES, MEMORY_PRIORITIES, TODO_STATUSES, LESSON_SEVERITIES, APP_RULE_STATUSES,
  DEFAULT_LIMIT, MAX_LIMIT,
} from './continuity-store.js';

const limitSchema = z.number().int().min(1).max(MAX_LIMIT).optional()
  .describe(`Max rows (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`);

/** Uniform tool result: text for humans/LLMs + structuredContent for programs. */
export function toolResult(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: Array.isArray(data) ? { rows: data } : data,
  };
}

/** Client identity from the initialize handshake, for provenance stamps. */
function clientStamp(server) {
  const info = server.server && typeof server.server.getClientVersion === 'function'
    ? server.server.getClientVersion()
    : undefined;
  return info ? { name: info.name, version: info.version } : { name: 'unknown', version: 'unknown' };
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {ReturnType<import('./continuity-store.js').createContinuityStore>} store
 * @param {{ readOnly?: boolean, audit?: (name: string, fn: Function) => Function }} options
 */
export function registerContinuityTools(server, store, { readOnly = false, audit = (_n, fn) => fn } = {}) {
  const ro = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const add = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  const upd = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  // ── read tools ─────────────────────────────────────────────────────────
  server.registerTool('boot_context', {
    title: 'Boot context (CLAUDE.md §3 wake-up pack)',
    description: 'One call returning what a new session must read before acting: active app_rules (verbatim doctrine), newest active claude_memory titles, every open/in_progress todo, newest lessons_learned, and the definitions glossary terms. Read this first.',
    inputSchema: { limit: limitSchema },
    annotations: ro,
  }, audit('boot_context', async ({ limit }) => toolResult(await store.bootContext({ limit }))));

  server.registerTool('memory_search', {
    title: 'Search claude_memory',
    description: 'Search the claude_memory continuity table. Defaults to status=active, newest first. Use query for ILIKE on title/content, tag for an exact tag match, category for an exact category.',
    inputSchema: {
      query: z.string().min(1).max(200).optional().describe('Substring to match in title or content'),
      category: z.string().min(1).max(64).optional(),
      status: z.enum([...MEMORY_STATUSES, 'any']).optional().describe("Row status filter (default 'active'; 'any' disables)"),
      tag: z.string().min(1).max(64).optional(),
      limit: limitSchema,
    },
    annotations: ro,
  }, audit('memory_search', async (args) => toolResult(await store.searchMemory(args))));

  server.registerTool('memory_get', {
    title: 'Get one claude_memory row with its thread',
    description: 'Fetch a claude_memory row by id plus its parent chain (via parent_id, nearest first) and direct children.',
    inputSchema: { id: z.number().int().positive() },
    annotations: ro,
  }, audit('memory_get', async ({ id }) => {
    const thread = await store.getMemoryThread(id);
    if (!thread) throw new Error(`claude_memory id ${id} not found`);
    return toolResult(thread);
  }));

  server.registerTool('todo_list', {
    title: 'List todo rows',
    description: "List the todo queue. Defaults to open + in_progress, ordered by priority (1 = highest) then newest.",
    inputSchema: {
      statuses: z.array(z.enum(TODO_STATUSES)).min(1).optional().describe("Default ['open','in_progress']"),
      limit: limitSchema,
    },
    annotations: ro,
  }, audit('todo_list', async (args) => toolResult(await store.listTodo(args))));

  server.registerTool('lessons_list', {
    title: 'List lessons_learned',
    description: 'Newest-first list of lessons_learned (mistake + trigger + the rule it produced).',
    inputSchema: { severity: z.enum(LESSON_SEVERITIES).optional(), limit: limitSchema },
    annotations: ro,
  }, audit('lessons_list', async (args) => toolResult(await store.listLessons(args))));

  server.registerTool('definitions_lookup', {
    title: 'Look up glossary definitions',
    description: 'Search the definitions glossary (term, aliases, meaning) with ILIKE. Omit query to list every term. Resolve a term here BEFORE touching a table, column, or flag by that name.',
    inputSchema: { query: z.string().min(1).max(120).optional(), limit: limitSchema },
    annotations: ro,
  }, audit('definitions_lookup', async (args) => toolResult(await store.lookupDefinitions(args))));

  server.registerTool('app_rules_list', {
    title: 'List app_rules (product doctrine, verbatim)',
    description: "Melody's product invariants, verbatim with provenance. Read-only by design: this table is never written through MCP.",
    inputSchema: { status: z.enum([...APP_RULE_STATUSES, 'any']).optional().describe("Default 'active'") },
    annotations: ro,
  }, audit('app_rules_list', async (args) => toolResult(await store.listAppRules(args))));

  if (readOnly) return;

  // ── write tools (additive only; no deletes exist) ──────────────────────
  server.registerTool('memory_add', {
    title: 'Add a claude_memory row',
    description: 'Insert one continuity row. Capture the WHY, not just the decision. Use parent_id to thread a follow-up/resolution under its antecedent. Never duplicates: search first.',
    inputSchema: {
      session_id: z.string().min(1).max(200).describe('Identifier of the session/conversation writing this row'),
      category: z.string().min(1).max(64).describe('e.g. decision | session | audit_finding | reference | rule | insight | feedback'),
      title: z.string().min(1).max(500),
      content: z.string().min(1).max(20000),
      source: z.string().min(1).max(64).optional().describe("Default 'mcp'"),
      priority: z.enum(MEMORY_PRIORITIES).optional().describe("Default 'normal'"),
      tags: z.array(z.string().min(1).max(64)).max(30).optional(),
      related_files: z.array(z.string().min(1).max(500)).max(50).optional(),
      parent_id: z.number().int().positive().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    },
    annotations: add,
  }, audit('memory_add', async (args) => {
    if (args.parent_id) {
      const parent = await store.getMemory(args.parent_id);
      if (!parent) throw new Error(`parent_id ${args.parent_id} does not exist in claude_memory`);
    }
    const row = await store.addMemory({
      ...args,
      metadata: { ...(args.metadata || {}), mcp_client: clientStamp(server) },
    });
    return toolResult(row);
  }));

  server.registerTool('memory_set_status', {
    title: 'Set a claude_memory row status',
    description: `Flip a row's status (${MEMORY_STATUSES.join(' | ')}). Use resolved when the work landed, superseded when replaced. Rows are never deleted.`,
    inputSchema: { id: z.number().int().positive(), status: z.enum(MEMORY_STATUSES) },
    annotations: upd,
  }, audit('memory_set_status', async ({ id, status }) => {
    const row = await store.setMemoryStatus(id, status);
    if (!row) throw new Error(`claude_memory id ${id} not found`);
    return toolResult(row);
  }));

  server.registerTool('todo_add', {
    title: 'Add a todo row',
    description: 'Insert an actionable task. priority: 1 = highest. source_memory_id links to the claude_memory row that produced it.',
    inputSchema: {
      title: z.string().min(1).max(500),
      detail: z.string().max(20000).optional(),
      priority: z.number().int().min(1).max(99).optional().describe('Default 3'),
      source_memory_id: z.number().int().positive().optional(),
    },
    annotations: add,
  }, audit('todo_add', async (args) => toolResult(await store.addTodo(args))));

  server.registerTool('todo_set_status', {
    title: 'Set a todo row status',
    description: `Set status to one of ${TODO_STATUSES.join(' | ')} (CHECK-enforced by the table).`,
    inputSchema: { id: z.number().int().positive(), status: z.enum(TODO_STATUSES) },
    annotations: upd,
  }, audit('todo_set_status', async ({ id, status }) => {
    const row = await store.setTodoStatus(id, status);
    if (!row) throw new Error(`todo id ${id} not found`);
    return toolResult(row);
  }));

  server.registerTool('lesson_add', {
    title: 'Add a lessons_learned row',
    description: 'Record a mistake worth never repeating: the lesson, what triggered it, and the rule it produced.',
    inputSchema: {
      lesson: z.string().min(1).max(20000),
      trigger: z.string().max(20000).optional(),
      rule: z.string().max(20000).optional(),
      severity: z.enum(LESSON_SEVERITIES).optional().describe("Default 'medium'"),
    },
    annotations: add,
  }, audit('lesson_add', async (args) => toolResult(await store.addLesson(args))));

  server.registerTool('definition_add', {
    title: 'Add a glossary definition',
    description: 'Insert a new term. Fails loud (with the existing row) if the term already exists — use definition_update by id to change one.',
    inputSchema: {
      term: z.string().min(1).max(200),
      meaning: z.string().min(1).max(20000),
      location: z.string().max(500).optional().describe('Canonical file/path/tab where it lives'),
      aliases: z.string().max(500).optional(),
    },
    annotations: add,
  }, audit('definition_add', async (args) => {
    const existing = await store.getDefinitionByTerm(args.term);
    if (existing) throw new Error(`definition '${args.term}' already exists as id ${existing.id}: ${existing.meaning}`);
    return toolResult(await store.addDefinition(args));
  }));

  server.registerTool('definition_update', {
    title: 'Update a glossary definition by id',
    description: 'Explicit by-id update of meaning / location / aliases. The term itself is immutable here.',
    inputSchema: {
      id: z.number().int().positive(),
      meaning: z.string().min(1).max(20000).optional(),
      location: z.string().max(500).optional(),
      aliases: z.string().max(500).optional(),
    },
    annotations: upd,
  }, audit('definition_update', async ({ id, ...patch }) => {
    if (patch.meaning === undefined && patch.location === undefined && patch.aliases === undefined) {
      throw new Error('definition_update: provide at least one of meaning, location, aliases');
    }
    const row = await store.updateDefinition(id, patch);
    if (!row) throw new Error(`definition id ${id} not found`);
    return toolResult(row);
  }));
}
