// server/api/coach/notes.js
// CRUD endpoints for user_intel_notes (Coach's memory about drivers)
// Created: 2026-01-05
//
// These endpoints allow users to view, create, edit, and delete notes
// that the AI Coach has saved about them.

import { Router } from 'express';
import { db } from '../../db/drizzle.js';
import { user_intel_notes } from '../../../shared/schema.js';
import { eq, and, desc, asc, sql } from 'drizzle-orm';
import { noteSchema } from './validate.js';

const router = Router();

// ============================================================================
// GET /api/coach/notes - List user's notes
// ============================================================================

/**
 * GET /api/coach/notes
 * List all notes for the authenticated user
 *
 * Query params:
 * - limit: number (default 50, max 100)
 * - offset: number (default 0)
 * - sort: 'recent' | 'importance' | 'pinned' (default 'recent')
 * - type: filter by note_type
 * - category: filter by category
 * - active_only: boolean (default true)
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      limit = 50,
      offset = 0,
      sort = 'recent',
      type,
      category,
      active_only = 'true'
    } = req.query;

    // Build conditions
    const conditions = [eq(user_intel_notes.user_id, userId)];

    if (active_only === 'true') {
      conditions.push(eq(user_intel_notes.is_active, true));
    }
    if (type) {
      conditions.push(eq(user_intel_notes.note_type, type));
    }
    if (category) {
      conditions.push(eq(user_intel_notes.category, category));
    }

    // Build sort order
    let orderBy;
    switch (sort) {
      case 'importance':
        orderBy = [desc(user_intel_notes.importance), desc(user_intel_notes.created_at)];
        break;
      case 'pinned':
        orderBy = [desc(user_intel_notes.is_pinned), desc(user_intel_notes.importance), desc(user_intel_notes.created_at)];
        break;
      case 'recent':
      default:
        orderBy = [desc(user_intel_notes.created_at)];
    }

    // Execute query
    const notes = await db
      .select()
      .from(user_intel_notes)
      .where(and(...conditions))
      .orderBy(...orderBy)
      .limit(Math.min(parseInt(limit) || 50, 100))
      .offset(parseInt(offset) || 0);

    // Get total count
    const [{ count }] = await db
      .select({ count: sql`count(*)::int` })
      .from(user_intel_notes)
      .where(and(...conditions));

    res.json({
      ok: true,
      notes,
      pagination: {
        total: count,
        limit: Math.min(parseInt(limit) || 50, 100),
        offset: parseInt(offset) || 0,
        has_more: (parseInt(offset) || 0) + notes.length < count
      }
    });
  } catch (err) {
    console.error('[CoachNotes] List error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to fetch notes' });
  }
});

// ============================================================================
// GET /api/coach/notes/:id - Get single note
// ============================================================================

router.get('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const [note] = await db
      .select()
      .from(user_intel_notes)
      .where(and(
        eq(user_intel_notes.id, id),
        eq(user_intel_notes.user_id, userId)
      ))
      .limit(1);

    if (!note) {
      return res.status(404).json({ ok: false, error: 'Note not found' });
    }

    res.json({ ok: true, note });
  } catch (err) {
    console.error('[CoachNotes] Get error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to fetch note' });
  }
});

// ============================================================================
// POST /api/coach/notes - Create note
// ============================================================================

/**
 * POST /api/coach/notes
 * Create a new note (manual creation by user)
 *
 * Body: { note_type, title, content, category?, importance?, market_slug? }
 */
router.post('/', async (req, res) => {
  try {
    const userId = req.user.id;

    // Validate input
    const validation = noteSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        ok: false,
        error: 'VALIDATION_ERROR',
        details: validation.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message
        }))
      });
    }

    const data = validation.data;

    // Insert note
    const [note] = await db
      .insert(user_intel_notes)
      .values({
        user_id: userId,
        note_type: data.note_type,
        category: data.category || null,
        title: data.title,
        content: data.content,
        importance: data.importance || 50,
        confidence: data.confidence || 80,
        market_slug: data.market_slug || null,
        neighborhoods: data.neighborhoods || null,
        context: data.context || null,
        created_by: 'user', // Distinguish from AI-created notes
        is_active: true,
        is_pinned: false,
        times_referenced: 0
      })
      .returning();

    console.log(`[CoachNotes] Created note ${note.id} for user ${userId}`);

    res.status(201).json({ ok: true, note });
  } catch (err) {
    console.error('[CoachNotes] Create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create note' });
  }
});

// ============================================================================
// PUT /api/coach/notes/:id - Update note
// ============================================================================

/**
 * PUT /api/coach/notes/:id
 * Update an existing note
 *
 * Body: { title?, content?, importance?, category?, is_pinned? }
 */
router.put('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Check note exists and belongs to user
    const [existing] = await db
      .select({ id: user_intel_notes.id })
      .from(user_intel_notes)
      .where(and(
        eq(user_intel_notes.id, id),
        eq(user_intel_notes.user_id, userId)
      ))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Note not found' });
    }

    // Build update object (only include fields that were provided)
    const updates = {};
    const allowedFields = ['title', 'content', 'importance', 'category', 'is_pinned', 'market_slug', 'neighborhoods', 'context'];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ ok: false, error: 'No fields to update' });
    }

    // Always update updated_at
    updates.updated_at = new Date();

    // Execute update
    const [note] = await db
      .update(user_intel_notes)
      .set(updates)
      .where(eq(user_intel_notes.id, id))
      .returning();

    console.log(`[CoachNotes] Updated note ${id} for user ${userId}`);

    res.json({ ok: true, note });
  } catch (err) {
    console.error('[CoachNotes] Update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update note' });
  }
});

// ============================================================================
// DELETE /api/coach/notes/:id - Soft delete note
// ============================================================================

/**
 * DELETE /api/coach/notes/:id
 * Soft delete (sets is_active = false)
 */
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Check note exists and belongs to user
    const [existing] = await db
      .select({ id: user_intel_notes.id })
      .from(user_intel_notes)
      .where(and(
        eq(user_intel_notes.id, id),
        eq(user_intel_notes.user_id, userId)
      ))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Note not found' });
    }

    // Soft delete
    await db
      .update(user_intel_notes)
      .set({
        is_active: false,
        updated_at: new Date()
      })
      .where(eq(user_intel_notes.id, id));

    console.log(`[CoachNotes] Soft-deleted note ${id} for user ${userId}`);

    res.json({ ok: true, message: 'Note deleted' });
  } catch (err) {
    console.error('[CoachNotes] Delete error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to delete note' });
  }
});

// ============================================================================
// POST /api/coach/notes/:id/pin - Toggle pin status
// ============================================================================

router.post('/:id/pin', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Get current pin status
    const [existing] = await db
      .select({ id: user_intel_notes.id, is_pinned: user_intel_notes.is_pinned })
      .from(user_intel_notes)
      .where(and(
        eq(user_intel_notes.id, id),
        eq(user_intel_notes.user_id, userId)
      ))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Note not found' });
    }

    // Toggle pin
    const newPinned = !existing.is_pinned;

    const [note] = await db
      .update(user_intel_notes)
      .set({
        is_pinned: newPinned,
        updated_at: new Date()
      })
      .where(eq(user_intel_notes.id, id))
      .returning();

    console.log(`[CoachNotes] ${newPinned ? 'Pinned' : 'Unpinned'} note ${id} for user ${userId}`);

    res.json({ ok: true, note, pinned: newPinned });
  } catch (err) {
    console.error('[CoachNotes] Pin error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to toggle pin' });
  }
});

// ============================================================================
// POST /api/coach/notes/:id/restore - Restore soft-deleted note
// ============================================================================

router.post('/:id/restore', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Check note exists (including inactive)
    const [existing] = await db
      .select({ id: user_intel_notes.id, is_active: user_intel_notes.is_active })
      .from(user_intel_notes)
      .where(and(
        eq(user_intel_notes.id, id),
        eq(user_intel_notes.user_id, userId)
      ))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Note not found' });
    }

    if (existing.is_active) {
      return res.status(400).json({ ok: false, error: 'Note is already active' });
    }

    // Restore
    const [note] = await db
      .update(user_intel_notes)
      .set({
        is_active: true,
        updated_at: new Date()
      })
      .where(eq(user_intel_notes.id, id))
      .returning();

    console.log(`[CoachNotes] Restored note ${id} for user ${userId}`);

    res.json({ ok: true, note });
  } catch (err) {
    console.error('[CoachNotes] Restore error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to restore note' });
  }
});

// ============================================================================
// GET /api/coach/notes/stats - Get note statistics
// ============================================================================

router.get('/stats/summary', async (req, res) => {
  try {
    const userId = req.user.id;

    // Get counts by type
    const typeStats = await db
      .select({
        note_type: user_intel_notes.note_type,
        count: sql`count(*)::int`
      })
      .from(user_intel_notes)
      .where(and(
        eq(user_intel_notes.user_id, userId),
        eq(user_intel_notes.is_active, true)
      ))
      .groupBy(user_intel_notes.note_type);

    // Get total and pinned counts
    const [totals] = await db
      .select({
        total: sql`count(*)::int`,
        pinned: sql`count(*) filter (where is_pinned = true)::int`,
        ai_created: sql`count(*) filter (where created_by = 'ai_coach')::int`,
        user_created: sql`count(*) filter (where created_by = 'user')::int`
      })
      .from(user_intel_notes)
      .where(and(
        eq(user_intel_notes.user_id, userId),
        eq(user_intel_notes.is_active, true)
      ));

    res.json({
      ok: true,
      stats: {
        total: totals.total,
        pinned: totals.pinned,
        by_source: {
          ai_coach: totals.ai_created,
          user: totals.user_created
        },
        by_type: Object.fromEntries(typeStats.map(s => [s.note_type, s.count]))
      }
    });
  } catch (err) {
    console.error('[CoachNotes] Stats error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to fetch stats' });
  }
});

export default router;
