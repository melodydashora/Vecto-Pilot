// server/mcp/continuity-store.js
// Data access for the continuity tables (claude_memory, todo, lessons_learned,
// definitions, app_rules) used by the standalone MCP server.
//
// 2026-09-03: Created with the MCP server. Takes the Drizzle `db` as an
// argument (no import-time pool) so the tool layer can be unit-tested against
// a plain-object fake. Contract: ADDITIVE ONLY — inserts and explicit status /
// field updates by id. No DELETE anywhere (CLAUDE.md §5 hard limits;
// AI_PARTNERSHIP_AGREEMENT.md §9.3 "never delete memory entries; supersede or
// archive them"). app_rules is read-only here: it is Melody's doctrine table.

import { eq, desc, asc, and, or, ilike, inArray, sql } from 'drizzle-orm';
import { claudeMemory, todo, lessons_learned, definitions, app_rules } from '../../shared/schema.js';

// Vocabularies. claude_memory.status is NOT CHECK-enforced; the schema comment
// lists four values but the live table (verified 2026-09-03) also carries
// done / pending / resolved, and CLAUDE.md §6 tells sessions to flip rows to
// resolved / superseded. The union is the honest contract.
export const MEMORY_STATUSES = ['active', 'resolved', 'superseded', 'done', 'pending', 'archived', 'disputed'];
export const MEMORY_PRIORITIES = ['critical', 'high', 'normal', 'low'];
// todo.status IS CHECK-enforced (todo_status_check) — mirror it exactly.
export const TODO_STATUSES = ['open', 'in_progress', 'done', 'wontfix'];
export const LESSON_SEVERITIES = ['low', 'medium', 'high', 'critical'];
export const APP_RULE_STATUSES = ['active', 'superseded'];

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 200;

function clampLimit(limit) {
  const n = Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_LIMIT;
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

/**
 * @param {import('drizzle-orm/node-postgres').NodePgDatabase} db
 */
export function createContinuityStore(db) {
  if (!db) throw new Error('createContinuityStore: db is required');

  return {
    // ── claude_memory ────────────────────────────────────────────────────
    async searchMemory({ query, category, status = 'active', tag, limit } = {}) {
      const conditions = [];
      if (status && status !== 'any') conditions.push(eq(claudeMemory.status, status));
      if (category) conditions.push(eq(claudeMemory.category, category));
      if (query) {
        const like = `%${query}%`;
        conditions.push(or(ilike(claudeMemory.title, like), ilike(claudeMemory.content, like)));
      }
      if (tag) conditions.push(sql`${claudeMemory.tags} @> ${JSON.stringify([tag])}::jsonb`);
      let q = db.select().from(claudeMemory);
      if (conditions.length) q = q.where(and(...conditions));
      return q.orderBy(desc(claudeMemory.created_at)).limit(clampLimit(limit));
    },

    async getMemory(id) {
      const rows = await db.select().from(claudeMemory).where(eq(claudeMemory.id, id)).limit(1);
      return rows[0] || null;
    },

    /** Row + its parent chain (nearest first, capped) + direct children. */
    async getMemoryThread(id, { maxDepth = 5 } = {}) {
      const row = await this.getMemory(id);
      if (!row) return null;
      const parents = [];
      let cursor = row.parent_id;
      while (cursor && parents.length < maxDepth) {
        const p = await this.getMemory(cursor);
        if (!p) break;
        parents.push(p);
        cursor = p.parent_id;
      }
      const children = await db.select().from(claudeMemory)
        .where(eq(claudeMemory.parent_id, id))
        .orderBy(asc(claudeMemory.created_at));
      return { row, parents, children };
    },

    async addMemory(input) {
      const [row] = await db.insert(claudeMemory).values({
        session_id: input.session_id,
        category: input.category,
        title: input.title,
        content: input.content,
        source: input.source ?? 'mcp',
        priority: input.priority ?? 'normal',
        status: input.status ?? 'active',
        tags: input.tags ?? [],
        related_files: input.related_files ?? [],
        parent_id: input.parent_id ?? null,
        metadata: input.metadata ?? {},
      }).returning();
      return row;
    },

    async setMemoryStatus(id, status) {
      const [row] = await db.update(claudeMemory)
        .set({ status, updated_at: sql`now()` })
        .where(eq(claudeMemory.id, id))
        .returning();
      return row || null;
    },

    // ── todo ─────────────────────────────────────────────────────────────
    async listTodo({ statuses = ['open', 'in_progress'], limit } = {}) {
      let q = db.select().from(todo);
      if (statuses && statuses.length) q = q.where(inArray(todo.status, statuses));
      return q.orderBy(asc(todo.priority), desc(todo.created_at)).limit(clampLimit(limit));
    },

    async addTodo(input) {
      const [row] = await db.insert(todo).values({
        title: input.title,
        detail: input.detail ?? null,
        priority: input.priority ?? 3,
        source_memory_id: input.source_memory_id ?? null,
      }).returning();
      return row;
    },

    async setTodoStatus(id, status) {
      const [row] = await db.update(todo)
        .set({ status, updated_at: sql`now()` })
        .where(eq(todo.id, id))
        .returning();
      return row || null;
    },

    // ── lessons_learned ──────────────────────────────────────────────────
    async listLessons({ severity, limit } = {}) {
      let q = db.select().from(lessons_learned);
      if (severity) q = q.where(eq(lessons_learned.severity, severity));
      return q.orderBy(desc(lessons_learned.created_at)).limit(clampLimit(limit));
    },

    async addLesson(input) {
      const [row] = await db.insert(lessons_learned).values({
        lesson: input.lesson,
        trigger: input.trigger ?? null,
        rule: input.rule ?? null,
        severity: input.severity ?? 'medium',
      }).returning();
      return row;
    },

    // ── definitions ──────────────────────────────────────────────────────
    async lookupDefinitions({ query, limit } = {}) {
      let q = db.select().from(definitions);
      if (query) {
        const like = `%${query}%`;
        q = q.where(or(ilike(definitions.term, like), ilike(definitions.aliases, like), ilike(definitions.meaning, like)));
      }
      return q.orderBy(asc(definitions.term)).limit(clampLimit(limit));
    },

    async getDefinitionByTerm(term) {
      const rows = await db.select().from(definitions).where(ilike(definitions.term, term)).limit(1);
      return rows[0] || null;
    },

    async addDefinition(input) {
      const [row] = await db.insert(definitions).values({
        term: input.term,
        meaning: input.meaning,
        location: input.location ?? null,
        aliases: input.aliases ?? null,
      }).returning();
      return row;
    },

    async updateDefinition(id, patch) {
      const set = { updated_at: sql`now()` };
      if (patch.meaning !== undefined) set.meaning = patch.meaning;
      if (patch.location !== undefined) set.location = patch.location;
      if (patch.aliases !== undefined) set.aliases = patch.aliases;
      const [row] = await db.update(definitions).set(set).where(eq(definitions.id, id)).returning();
      return row || null;
    },

    // ── app_rules (read-only) ────────────────────────────────────────────
    async listAppRules({ status = 'active' } = {}) {
      let q = db.select().from(app_rules);
      if (status && status !== 'any') q = q.where(eq(app_rules.status, status));
      return q.orderBy(asc(app_rules.rule_key));
    },

    // ── boot context (CLAUDE.md §3 in one call) ──────────────────────────
    async bootContext({ limit = 30 } = {}) {
      const n = clampLimit(limit);
      const [rules, memory, todos, lessons, defs, counts] = await Promise.all([
        this.listAppRules({ status: 'active' }),
        db.select({
          id: claudeMemory.id, created_at: claudeMemory.created_at, category: claudeMemory.category,
          priority: claudeMemory.priority, title: claudeMemory.title,
        }).from(claudeMemory).where(eq(claudeMemory.status, 'active')).orderBy(desc(claudeMemory.created_at)).limit(n),
        this.listTodo({ statuses: ['open', 'in_progress'], limit: MAX_LIMIT }),
        db.select({
          id: lessons_learned.id, created_at: lessons_learned.created_at, severity: lessons_learned.severity,
          lesson: lessons_learned.lesson, rule: lessons_learned.rule,
        }).from(lessons_learned).orderBy(desc(lessons_learned.created_at)).limit(n),
        db.select({ term: definitions.term }).from(definitions).orderBy(asc(definitions.term)),
        db.execute(sql`select
          (select count(*)::int from claude_memory where status = 'active') as memory_active,
          (select count(*)::int from todo where status in ('open','in_progress')) as todo_open,
          (select count(*)::int from lessons_learned) as lessons,
          (select count(*)::int from definitions) as definitions`),
      ]);
      const countRow = (counts && counts.rows && counts.rows[0]) || {};
      return {
        counts: countRow,
        app_rules: rules.map(r => ({ rule_key: r.rule_key, provenance: r.provenance, rule_text: r.rule_text })),
        memory_active_newest: memory,
        todo_open: todos.map(t => ({ id: t.id, priority: t.priority, status: t.status, title: t.title })),
        lessons_newest: lessons,
        definition_terms: defs.map(d => d.term),
      };
    },
  };
}
