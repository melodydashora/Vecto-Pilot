// server/api/memory/index.js
// CRUD endpoints for claude_memory table — Claude Code's persistent knowledge base
// 2026-04-14: Created for memory-keeper agent and internal tooling
//
// 2026-05-12 SECURITY (Item 3 of auth-hardening): this router IS mounted
// publicly under /api (see server/bootstrap/routes.js, the '/api/memory' entry). The prior comment
// claimed it was internal-only — that was wrong. requireAuth is now applied
// at the top to gate every route below. Authenticated callers (bearer JWT or
// x-vecto-agent-secret / x-claude-bridge-token service-account headers) are
// required.

import { Router } from 'express';
import { db } from '../../db/drizzle.js';
import { claudeMemory } from '../../../shared/schema.js';
import { eq, desc, and, ilike, sql } from 'drizzle-orm';
import { requireAuth } from '../../middleware/auth.js';
import { requireOperator } from '../../middleware/require-operator.js';

const router = Router();

// Columns a caller may set. Everything else (id, created_at, updated_at) is server-owned.
const WRITABLE_FIELDS = ['session_id', 'category', 'title', 'content', 'source', 'priority', 'status', 'tags', 'related_files', 'parent_id', 'metadata'];
function pickWritable(body) {
  const out = {};
  for (const k of WRITABLE_FIELDS) if (body && Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  return out;
}

// 2026-09-10 (security finding [1]): requireAuth proves "a driver"; this is Claude's private
// continuity store (Melody's context rows included) and POST/PATCH take raw req.body.
// Operators and service accounts only — see require-operator.js.
router.use(requireAuth, requireOperator);

// ============================================================================
// GET /api/memory — List memories with optional filters
// ============================================================================
router.get('/', async (req, res) => {
  try {
    const { category, status, search, limit = 50 } = req.query;
    // 2026-09-10: caller-controlled limit was uncapped (one request dumped the table); same
    // clamp as server/mcp/continuity-store.js.
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const conditions = [];

    if (category) conditions.push(eq(claudeMemory.category, category));
    if (status) conditions.push(eq(claudeMemory.status, status));
    if (search) conditions.push(ilike(claudeMemory.content, `%${search}%`));

    let query = db.select().from(claudeMemory);
    if (conditions.length > 0) query = query.where(and(...conditions));

    const results = await query
      .orderBy(desc(claudeMemory.created_at))
      .limit(safeLimit);

    res.json(results);
  } catch (err) {
    console.error('[MEMORY] GET / error:', err.message);
    res.status(500).json({ error: 'memory_request_failed' });
  }
});

// ============================================================================
// GET /api/memory/stats — Summary statistics by category
// ============================================================================
router.get('/stats', async (req, res) => {
  try {
    const stats = await db.select({
      category: claudeMemory.category,
      count: sql`count(*)::int`,
    }).from(claudeMemory)
      .where(eq(claudeMemory.status, 'active'))
      .groupBy(claudeMemory.category);

    res.json(stats);
  } catch (err) {
    console.error('[MEMORY] GET /stats error:', err.message);
    res.status(500).json({ error: 'memory_request_failed' });
  }
});

// ============================================================================
// GET /api/memory/rules — All active rules (quick access for agents)
// ============================================================================
router.get('/rules', async (req, res) => {
  try {
    const rules = await db.select().from(claudeMemory)
      .where(and(
        eq(claudeMemory.category, 'rule'),
        eq(claudeMemory.status, 'active')
      ))
      .orderBy(desc(claudeMemory.priority));

    res.json(rules);
  } catch (err) {
    console.error('[MEMORY] GET /rules error:', err.message);
    res.status(500).json({ error: 'memory_request_failed' });
  }
});

// ============================================================================
// GET /api/memory/session/:sessionId — All memories from a specific session
// ============================================================================
router.get('/session/:sessionId', async (req, res) => {
  try {
    const results = await db.select().from(claudeMemory)
      .where(eq(claudeMemory.session_id, req.params.sessionId))
      .orderBy(desc(claudeMemory.created_at));

    res.json(results);
  } catch (err) {
    console.error('[MEMORY] GET /session error:', err.message);
    res.status(500).json({ error: 'memory_request_failed' });
  }
});

// ============================================================================
// POST /api/memory — Create a new memory entry
// ============================================================================
router.post('/', async (req, res) => {
  try {
    const { session_id, category, title, content } = req.body;
    if (!session_id || !category || !title || !content) {
      return res.status(400).json({ error: 'Missing required fields: session_id, category, title, content' });
    }

    // 2026-09-10: never pass req.body straight to the ORM — `id`, `created_at`, `updated_at`
    // were assignable (mass assignment). Only these columns may be set by a caller.
    const entry = await db.insert(claudeMemory).values(pickWritable(req.body)).returning();
    res.json(entry[0]);
  } catch (err) {
    console.error('[MEMORY] POST / error:', err.message);
    res.status(500).json({ error: 'memory_request_failed' });
  }
});

// ============================================================================
// PATCH /api/memory/:id — Update a memory entry
// ============================================================================
router.patch('/:id', async (req, res) => {
  try {
    const patch = pickWritable(req.body);
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No writable fields in body' });
    }
    const entry = await db.update(claudeMemory)
      .set({ ...patch, updated_at: new Date() })
      .where(eq(claudeMemory.id, Number(req.params.id)))
      .returning();

    if (!entry.length) {
      return res.status(404).json({ error: 'Memory entry not found' });
    }
    res.json(entry[0]);
  } catch (err) {
    console.error('[MEMORY] PATCH /:id error:', err.message);
    res.status(500).json({ error: 'memory_request_failed' });
  }
});

export default router;
