// server/api/events/public-events.js
// 2026-04-25: Public (no-auth) endpoints for the event sign-up POC.
// Plan: docs/plans/PLAN_event-signup-page-2026-04-25.md
//
// Routes (mounted at /api/public/events):
//   GET  /                  → list published events with current confirmed-count + price
//   GET  /:slug             → single event detail
//   POST /:slug/signup      → public signup (auto-assigns confirmed vs waitlist)

import express from 'express';
import { getPool } from '../../db/connection-manager.js';
import { computePrice } from '../../lib/events/pricing.js';
import { sendEventSignupAlert } from '../../lib/notifications/email-alerts.js';

const router = express.Router();

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function loadEventCounts(pool, eventId) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
       COUNT(*) FILTER (WHERE status = 'waitlist')  AS waitlist
     FROM event_signups WHERE event_id = $1`,
    [eventId]
  );
  return {
    confirmed: Number(rows[0]?.confirmed || 0),
    waitlist: Number(rows[0]?.waitlist || 0),
  };
}

function decorateEvent(event, counts) {
  const seatsLeft = Math.max(0, event.max_attendees - counts.confirmed);
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description,
    event_date: event.event_date,
    start_time: event.start_time,
    end_time: event.end_time,
    location_name: event.location_name,
    location_address: event.location_address,
    max_attendees: event.max_attendees,
    confirmed_count: counts.confirmed,
    waitlist_count: counts.waitlist,
    seats_left: seatsLeft,
    is_full: seatsLeft === 0,
    current_price_cents: computePrice(event.price_tiers, counts.confirmed),
    price_tiers: event.price_tiers,
    status: event.status,
  };
}

// GET /api/public/events
// Lists published, non-past events.
router.get('/', async (_req, res) => {
  try {
    const pool = getPool();
    const { rows: events } = await pool.query(
      `SELECT * FROM hosted_events
        WHERE status = 'published' AND event_date >= CURRENT_DATE
        ORDER BY event_date ASC, start_time ASC NULLS LAST`
    );
    const decorated = await Promise.all(
      events.map(async (e) => decorateEvent(e, await loadEventCounts(pool, e.id)))
    );
    res.json({ ok: true, events: decorated });
  } catch (err) {
    console.error('[public-events] list error:', err.message);
    res.status(500).json({ ok: false, error: 'failed to list events' });
  }
});

// GET /api/public/events/:slug
router.get('/:slug', async (req, res) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM hosted_events WHERE slug = $1 AND status = 'published' LIMIT 1`,
      [req.params.slug]
    );
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'event not found' });
    }
    const event = rows[0];
    const counts = await loadEventCounts(pool, event.id);
    res.json({ ok: true, event: decorateEvent(event, counts) });
  } catch (err) {
    console.error('[public-events] detail error:', err.message);
    res.status(500).json({ ok: false, error: 'failed to load event' });
  }
});

// POST /api/public/events/:slug/signup
// Body: { full_name, email, phone?, pickup_address?, notes? }
router.post('/:slug/signup', async (req, res) => {
  const { full_name, email, phone, pickup_address, notes } = req.body || {};

  if (!full_name || typeof full_name !== 'string' || full_name.trim().length < 2) {
    return res.status(400).json({ ok: false, error: 'full_name required (min 2 chars)' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: 'valid email required' });
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: eventRows } = await client.query(
      `SELECT * FROM hosted_events WHERE slug = $1 AND status = 'published' FOR UPDATE`,
      [req.params.slug]
    );
    if (eventRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'event not found or not open' });
    }
    const event = eventRows[0];

    const counts = await loadEventCounts(client, event.id);
    const status = counts.confirmed < event.max_attendees ? 'confirmed' : 'waitlist';
    const priceCents = status === 'confirmed'
      ? computePrice(event.price_tiers, counts.confirmed + 1)
      : computePrice(event.price_tiers, event.max_attendees);

    let signupRow;
    try {
      const { rows } = await client.query(
        `INSERT INTO event_signups
           (event_id, full_name, email, phone, pickup_address, notes, status, price_cents_at_signup)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          event.id,
          full_name.trim(),
          email.trim().toLowerCase(),
          phone || null,
          pickup_address || null,
          notes || null,
          status,
          priceCents,
        ]
      );
      signupRow = rows[0];
    } catch (insertErr) {
      if (insertErr.code === '23505') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          ok: false,
          error: 'this email is already signed up for this event',
        });
      }
      throw insertErr;
    }

    await client.query('COMMIT');

    const newCounts = status === 'confirmed'
      ? { confirmed: counts.confirmed + 1, waitlist: counts.waitlist }
      : { confirmed: counts.confirmed, waitlist: counts.waitlist + 1 };

    // Fire-and-forget email — never block the response on Resend.
    sendEventSignupAlert({
      event,
      signup: signupRow,
      confirmedCount: newCounts.confirmed,
      maxAttendees: event.max_attendees,
      priceCentsAtSignup: priceCents,
    }).catch((e) => console.error('[public-events] alert error:', e.message));

    res.json({
      ok: true,
      status,
      price_cents: priceCents,
      seats_left: Math.max(0, event.max_attendees - newCounts.confirmed),
      message: status === 'confirmed'
        ? "You're confirmed! Melody will be in touch by email."
        : "The 6 confirmed seats are taken — you're on the waitlist. Melody will email if a seat opens up.",
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[public-events] signup error:', err.message);
    res.status(500).json({ ok: false, error: 'signup failed' });
  } finally {
    client.release();
  }
});

export default router;
