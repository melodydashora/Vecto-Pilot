// server/api/events/admin-events.js
// 2026-04-25: Admin endpoints (requireAuth) for hosted_events POC.
// Plan: docs/plans/PLAN_event-signup-page-2026-04-25.md
//
// Routes (mounted at /api/admin/events, all requireAuth):
//   GET    /                       → list ALL events incl. drafts
//   POST   /                       → create event
//   GET    /:id                    → event detail with full signup roster
//   PATCH  /:id                    → update event
//   DELETE /:id                    → delete event
//   POST   /:id/generate-itinerary → AI itinerary from confirmed roster
//   POST   /:id/promote-waitlist   → move oldest waitlist row to confirmed (if seat available)

import express from 'express';
import rateLimit from 'express-rate-limit';
import { getPool } from '../../db/connection-manager.js';
import { requireAuth } from '../../middleware/auth.js';
import { computePrice } from '../../lib/events/pricing.js';
import { generateItinerary } from '../../lib/events/itinerary.js';

const router = express.Router();

const adminEventsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'too many requests' },
});

router.use(requireAuth);
router.use(adminEventsLimiter);

// GET /api/admin/events
router.get('/', async (_req, res) => {
  try {
    const pool = getPool();
    const { rows: events } = await pool.query(
      `SELECT e.*,
              (SELECT COUNT(*) FROM event_signups s WHERE s.event_id = e.id AND s.status = 'confirmed') AS confirmed_count,
              (SELECT COUNT(*) FROM event_signups s WHERE s.event_id = e.id AND s.status = 'waitlist')  AS waitlist_count
         FROM hosted_events e
        ORDER BY e.event_date DESC, e.start_time DESC NULLS LAST`
    );
    res.json({ ok: true, events });
  } catch (err) {
    console.error('[admin-events] list error:', err.message);
    res.status(500).json({ ok: false, error: 'failed to list events' });
  }
});

// POST /api/admin/events
router.post('/', async (req, res) => {
  const {
    slug, title, description,
    event_date, start_time, end_time,
    location_name, location_address,
    max_attendees, price_tiers, status,
  } = req.body || {};

  if (!slug || !title || !event_date) {
    return res.status(400).json({ ok: false, error: 'slug, title, event_date required' });
  }

  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO hosted_events
        (slug, title, description, event_date, start_time, end_time,
         location_name, location_address, max_attendees, price_tiers, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        slug, title, description || null,
        event_date, start_time || null, end_time || null,
        location_name || null, location_address || null,
        max_attendees || 6,
        JSON.stringify(price_tiers || [{ min_count: 1, price_cents: 12000 }]),
        status || 'draft',
        req.auth?.userId || null,
      ]
    );
    res.json({ ok: true, event: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ ok: false, error: 'slug already exists' });
    }
    console.error('[admin-events] create error:', err.message);
    res.status(500).json({ ok: false, error: 'failed to create event' });
  }
});

// GET /api/admin/events/:id
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const { rows: events } = await pool.query(
      `SELECT * FROM hosted_events WHERE id = $1`,
      [req.params.id]
    );
    if (events.length === 0) {
      return res.status(404).json({ ok: false, error: 'event not found' });
    }
    const event = events[0];
    const { rows: signups } = await pool.query(
      `SELECT * FROM event_signups WHERE event_id = $1 ORDER BY status, created_at ASC`,
      [event.id]
    );
    const confirmedCount = signups.filter(s => s.status === 'confirmed').length;
    res.json({
      ok: true,
      event: {
        ...event,
        current_price_cents: computePrice(event.price_tiers, confirmedCount),
      },
      signups,
    });
  } catch (err) {
    console.error('[admin-events] detail error:', err.message);
    res.status(500).json({ ok: false, error: 'failed to load event' });
  }
});

// PATCH /api/admin/events/:id
router.patch('/:id', async (req, res) => {
  const allowed = [
    'title', 'description',
    'event_date', 'start_time', 'end_time',
    'location_name', 'location_address',
    'max_attendees', 'price_tiers', 'status',
  ];
  const sets = [];
  const vals = [];
  let i = 1;
  for (const key of allowed) {
    if (key in req.body) {
      sets.push(`"${key}" = $${i++}`);
      vals.push(key === 'price_tiers' ? JSON.stringify(req.body[key]) : req.body[key]);
    }
  }
  if (sets.length === 0) return res.status(400).json({ ok: false, error: 'no fields to update' });
  sets.push(`"updated_at" = now()`);
  vals.push(req.params.id);

  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE hosted_events SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      vals
    );
    if (rows.length === 0) return res.status(404).json({ ok: false, error: 'event not found' });
    res.json({ ok: true, event: rows[0] });
  } catch (err) {
    console.error('[admin-events] update error:', err.message);
    res.status(500).json({ ok: false, error: 'failed to update event' });
  }
});

// DELETE /api/admin/events/:id
router.delete('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(
      `DELETE FROM hosted_events WHERE id = $1`,
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ ok: false, error: 'event not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin-events] delete error:', err.message);
    res.status(500).json({ ok: false, error: 'failed to delete event' });
  }
});

// POST /api/admin/events/:id/generate-itinerary
router.post('/:id/generate-itinerary', async (req, res) => {
  try {
    const pool = getPool();
    const { rows: events } = await pool.query(
      `SELECT * FROM hosted_events WHERE id = $1`,
      [req.params.id]
    );
    if (events.length === 0) return res.status(404).json({ ok: false, error: 'event not found' });
    const event = events[0];

    const { rows: signups } = await pool.query(
      `SELECT * FROM event_signups WHERE event_id = $1 AND status = 'confirmed' ORDER BY created_at ASC`,
      [event.id]
    );

    const result = await generateItinerary(event, signups);
    if (!result.ok) {
      return res.status(502).json({ ok: false, error: result.error || 'itinerary generation failed' });
    }

    await pool.query(
      `UPDATE hosted_events SET itinerary_md = $1, itinerary_generated_at = now(), updated_at = now() WHERE id = $2`,
      [result.markdown, event.id]
    );

    res.json({ ok: true, itinerary_md: result.markdown });
  } catch (err) {
    console.error('[admin-events] itinerary error:', err.message);
    res.status(500).json({ ok: false, error: 'failed to generate itinerary' });
  }
});

// POST /api/admin/events/:id/promote-waitlist
// Promotes the oldest waitlist row to confirmed if a seat is available.
router.post('/:id/promote-waitlist', async (req, res) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: events } = await client.query(
      `SELECT * FROM hosted_events WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (events.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'event not found' });
    }
    const event = events[0];

    const { rows: cRows } = await client.query(
      `SELECT COUNT(*) AS confirmed FROM event_signups WHERE event_id = $1 AND status = 'confirmed'`,
      [event.id]
    );
    const confirmedCount = Number(cRows[0]?.confirmed || 0);
    if (confirmedCount >= event.max_attendees) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'event is full; cannot promote' });
    }

    const { rows: nextRows } = await client.query(
      `SELECT * FROM event_signups
        WHERE event_id = $1 AND status = 'waitlist'
        ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
      [event.id]
    );
    if (nextRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'waitlist is empty' });
    }
    const next = nextRows[0];

    const newPrice = computePrice(event.price_tiers, confirmedCount + 1);
    const { rows: updated } = await client.query(
      `UPDATE event_signups SET status = 'confirmed', price_cents_at_signup = $1 WHERE id = $2 RETURNING *`,
      [newPrice, next.id]
    );

    await client.query('COMMIT');
    res.json({ ok: true, signup: updated[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[admin-events] promote error:', err.message);
    res.status(500).json({ ok: false, error: 'failed to promote waitlist' });
  } finally {
    client.release();
  }
});

export default router;
