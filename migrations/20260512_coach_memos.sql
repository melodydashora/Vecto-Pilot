-- migrations/20260512_coach_memos.sql
-- Adds coach_memos: Coach → Claude Code memo queue, DB-backed for Cloud Run survivability.
--
-- Replaces the prior fs.appendFile-only path in server/api/chat/chat.js that died on every
-- Cloud Run redeploy (ephemeral container filesystem). Rows here persist in Neon (prod) /
-- Helium (dev) and are materialized into docs/coach-inbox.md by the workspace operator
-- script `npm run pull-coach-memos`.
--
-- Background:
--   - Plan:  docs/review-queue/PLAN_coach-memo-db-route-and-workspace-pull-2026-05-12.md
--   - Audit: docs/architecture/audits/pass-f-issue-logging-survivability.md
--   - CLAUDE.md Rule 8 lists this table as a Coach write target.
--
-- status lifecycle:
--   new       → just written by chat.js (auto-marked exported in dev workspace)
--   exported  → workspace pull script has materialized into docs/coach-inbox.md
--   reviewed  → Claude Code picked it up at session start
--   implemented → fix shipped
--   rejected  → won't implement

CREATE TABLE IF NOT EXISTS coach_memos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Validated COACH_MEMO payload (mirrors rideshareCoachMemoSchema in server/api/rideshare-coach/validate.js)
  type           TEXT NOT NULL,
  title          TEXT NOT NULL,
  detail         TEXT NOT NULL,
  priority       TEXT NOT NULL DEFAULT 'medium',
  related_files  JSONB,

  -- Status state machine
  status         TEXT NOT NULL DEFAULT 'new',
  source         TEXT NOT NULL DEFAULT 'coach',
  exported_at    TIMESTAMPTZ,

  -- Provenance (optional, for cross-referencing back to the original chat)
  triggering_user_id          UUID REFERENCES users(user_id) ON DELETE SET NULL,
  triggering_conversation_id  UUID,
  triggering_snapshot_id      UUID REFERENCES snapshots(snapshot_id) ON DELETE SET NULL,

  -- Timestamps
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coach_memos_status
  ON coach_memos (status);

CREATE INDEX IF NOT EXISTS idx_coach_memos_created_at
  ON coach_memos (created_at DESC);
