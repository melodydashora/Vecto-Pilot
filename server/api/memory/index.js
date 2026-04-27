// server/api/memory/index.js
// CRUD endpoints for claude_memory table — Claude Code's persistent knowledge base
// 2026-04-14: Created for memory-keeper agent and internal tooling
//
// NOTE: No auth middleware — this API is for Claude Code internal use,
// not exposed to end users. If exposed publicly, add requireAuth.

import { Router } from 'express';
import { db } from '../../db/drizzle.js';
import { claudeMemory } from '../../../shared/schema.js';
import { eq, desc, and, ilike, sql } from 'drizzle-orm';

const router = Router();

// ============================================================================
// GET /api/memory — List memories with optional filters
// ============================================================================
router.get('/', async (req, res) => {
  try {
    const { category, status, search, limit = 50 } = req.query;
    const conditions = [];

    if (category) conditions.push(eq(claudeMemory.category, category));
    if (status) conditions.push(eq(claudeMemory.status, status));
    if (search) conditions.push(ilike(claudeMemory.content, `%${search}%`));

    let query = db.select().from(claudeMemory);
    if (conditions.length > 0) query = query.where(and(...conditions));

    const results = await query
      .orderBy(desc(claudeMemory.created_at))
      .limit(Number(limit));

    res.json(results);
  } catch (err) {
    console.error('[MEMORY] GET / error:', err.message);
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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

    const entry = await db.insert(claudeMemory).values(req.body).returning();
    res.json(entry[0]);
  } catch (err) {
    console.error('[MEMORY] POST / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// PATCH /api/memory/:id — Update a memory entry
// ============================================================================
router.patch('/:id', async (req, res) => {
  try {
    const entry = await db.update(claudeMemory)
      .set({ ...req.body, updated_at: new Date() })
      .where(eq(claudeMemory.id, Number(req.params.id)))
      .returning();

    if (!entry.length) {
      return res.status(404).json({ error: 'Memory entry not found' });
    }
    res.json(entry[0]);
  } catch (err) {
    console.error('[MEMORY] PATCH /:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
