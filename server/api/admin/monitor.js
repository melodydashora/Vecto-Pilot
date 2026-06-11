// server/api/admin/monitor.js
// Read-only PRODUCTION observability bridge for the terminal dev agent.
//
// WHY THIS EXISTS: on current Replit infrastructure the prod database is app-scoped —
// only the deployed app's runtime can reach it (psql/external clients cannot). So the
// dev agent monitors prod by calling THESE endpoints over HTTPS; the app reaches prod
// via Drizzle (structured) or a dedicated read-only pool (raw). See
// docs/architecture/PROD_QUERY_BRIDGE.md and claude_memory #351.
//
// SECURITY MODEL — capability, not validation:
//   - ALL routes require an agent/bridge token (requireAgentOnly) — no end-user sessions.
//   - GET /offer-monitor: FIXED Drizzle SELECTs only → zero user-SQL surface.
//   - POST /query: arbitrary SELECT, but executed under a DEDICATED READ-ONLY ROLE
//     (VECTO_READONLY_DATABASE_URL) whose GRANTs allow SELECT only on allowlisted
//     analytical tables, with statement_timeout + default_transaction_read_only. The
//     ROLE — not a regex — is the guarantee. The code checks (single-statement,
//     SELECT/WITH prefix, row cap, per-txn READ ONLY) are defense-in-depth. If the
//     read-only role is not configured, raw /query is DISABLED (503) and NEVER falls
//     back to the app's full-privilege pool.

import express, { Router } from 'express';
import pkg from 'pg';
import { sql } from 'drizzle-orm';
import { db } from '../../db/drizzle.js';
import { offer_intelligence } from '../../../shared/schema.js';
import { requireAgentOnly } from '../../middleware/auth.js';

const { Pool } = pkg;
const router = Router();

// Auth first (reject unauthenticated before parsing a body), then JSON parsing.
router.use(requireAgentOnly);
router.use(express.json({ limit: '64kb' }));

const MAX_ROWS = 1000;
const STMT_TIMEOUT_MS = 10000;

// ─── Dedicated READ-ONLY pool (raw /query only — NEVER the app pool) ──────────
let roPool = null;
function getReadonlyPool() {
  if (!process.env.VECTO_READONLY_DATABASE_URL) return null;
  if (!roPool) {
    roPool = new Pool({
      connectionString: process.env.VECTO_READONLY_DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 5000,        // 2026-06-11: never queue forever if the RO DB is unreachable
      statement_timeout: STMT_TIMEOUT_MS,
      idle_in_transaction_session_timeout: 15000,
    });
  }
  return roPool;
}

// ─── GET /api/admin/offer-monitor ─────────────────────────────────────────────
// Fleet-wide recent offers + aggregate stats. Fixed Drizzle query (no user SQL).
router.get('/offer-monitor', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    const rows = await db
      .select({
        id: offer_intelligence.id,
        created_at: offer_intelligence.created_at,
        input_mode: offer_intelligence.input_mode,
        decision: offer_intelligence.decision,
        ai_model: offer_intelligence.ai_model,
        response_time_ms: offer_intelligence.response_time_ms,
        confidence_score: offer_intelligence.confidence_score,
        parse_confidence: offer_intelligence.parse_confidence,
        per_mile: offer_intelligence.per_mile,
        total_miles: offer_intelligence.total_miles,
        product_type: offer_intelligence.product_type,
      })
      .from(offer_intelligence)
      .orderBy(sql`created_at DESC`)
      .limit(limit);

    const byModel = {};
    const byDecision = {};
    let latencySum = 0;
    let latencyN = 0;
    for (const r of rows) {
      const m = r.ai_model || 'unknown';
      const d = r.decision || 'unknown';
      byModel[m] = (byModel[m] || 0) + 1;
      byDecision[d] = (byDecision[d] || 0) + 1;
      if (typeof r.response_time_ms === 'number') {
        latencySum += r.response_time_ms;
        latencyN += 1;
      }
    }

    res.json({
      success: true,
      count: rows.length,
      stats: {
        by_model: byModel,
        by_decision: byDecision,
        avg_p1_latency_ms: latencyN ? Math.round(latencySum / latencyN) : null,
      },
      offers: rows,
    });
  } catch (err) {
    console.error('[admin/offer-monitor] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/admin/query ────────────────────────────────────────────────────
// Arbitrary read-only SELECT, executed under the dedicated read-only role.
router.post('/query', async (req, res) => {
  const pool = getReadonlyPool();
  if (!pool) {
    return res.status(503).json({
      error: 'readonly_role_not_configured',
      message: 'Raw query disabled: set VECTO_READONLY_DATABASE_URL (a SELECT-only role) in deployment secrets. See docs/architecture/PROD_QUERY_BRIDGE.md.',
    });
  }

  const raw = typeof req.body?.sql === 'string' ? req.body.sql.trim() : '';
  if (!raw) {
    return res.status(400).json({ error: 'missing_sql', message: 'Provide { "sql": "SELECT ..." }' });
  }

  // Defense-in-depth (the read-only ROLE is the real guard): single statement,
  // must begin with SELECT or WITH. A trailing ';' is allowed and stripped.
  const queryText = raw.replace(/;\s*$/, '');
  if (queryText.includes(';')) {
    return res.status(400).json({ error: 'single_statement_only', message: 'Only one statement is allowed (no inner ";").' });
  }
  if (!/^(select|with)\b/i.test(queryText)) {
    return res.status(400).json({ error: 'select_only', message: 'Only SELECT / WITH queries are permitted.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SET TRANSACTION READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${STMT_TIMEOUT_MS}`);
    // Cap rows at the DATABASE level (LIMIT in an outer subquery) so a huge result set
    // can never be materialized into the app's memory before we slice — prevents OOM.
    // MAX_ROWS+1 lets us detect truncation.
    const capped = `SELECT * FROM ( ${queryText} ) AS _bridge_sub LIMIT ${MAX_ROWS + 1}`;
    const result = await client.query(capped);
    await client.query('ROLLBACK');
    const rows = result.rows.slice(0, MAX_ROWS);
    res.json({
      success: true,
      rowCount: result.rowCount,
      returned: rows.length,
      truncated: result.rows.length > MAX_ROWS,
      fields: (result.fields || []).map((f) => f.name),
      rows,
    });
  } catch (err) {
    // The read-only role rejects writes / non-granted tables → clean error here.
    if (client) {
      try { await client.query('ROLLBACK'); } catch { /* already aborted */ }
    }
    res.status(400).json({ error: 'query_failed', message: err.message });
  } finally {
    if (client) client.release();
  }
});

export default router;
