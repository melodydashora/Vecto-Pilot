# Observability Architecture

**Last Updated:** 2026-02-10

This document outlines the observability strategy for Vecto Co-Pilot, including performance monitoring, error tracking, and analytics.

## 1. Performance Monitoring

### Current State
Performance monitoring is currently distributed across various logs and database metrics.
- **Database:** `server/db/connection-manager.js` monitors connection pool usage and warns when capacity > 80%.
- **AI Latency:** `server/lib/ai/adapters/*` logs latency for each model call.
- **Pipeline Timing:** `server/lib/strategy/strategy-utils.js` tracks phase durations (`scoring_ms`, `planner_ms`) in the `rankings` table.

### Monitoring Gaps
- No centralized dashboard for API latency.
- No memory usage tracking over time (detected via process restarts).
- Frontend performance (FCP, LCP) is not tracked.

### Future Strategy
- **Centralized Metrics:** Implement OpenTelemetry to aggregate metrics from API, DB, and AI layers.
- **Alerting:** Configure alerts for:
    - AI Latency > 10s
    - DB Connection Pool saturation
    - 5xx Error Rate > 1%

## 2. Error Tracking

### Current State
- **Server:** Errors are logged to `stderr` via `console.error`.
- **Database:** Failed queries are logged with error codes (e.g., in `server/scripts/sync-events.mjs`).
- **AI:** Model failures (`response.ok === false`) are logged in `server/lib/ai/adapters`.
- **Client:** React Error Boundaries capture UI crashes (`client/src/components/ErrorBoundary.tsx`). `CriticalError` component handles fatal app states.

### Tracking Gaps
- No error aggregation system (e.g., Sentry, LogRocket).
- Client-side errors are not reported to the server.
- "Silent failures" in background jobs may go unnoticed if logs aren't polled.

### Future Strategy
- **Sentry Integration:**
    - **Server:** Capture unhandled exceptions and 500 responses.
    - **Client:** Capture React Error Boundary events and fetch failures.
- **Context:** Attach `snapshot_id` and `user_id` to all error reports for debugging.

## 3. Analytics (User Behavior)

### Current State
- **Database Logging:** Critical actions are stored in the database:
    - `actions` table: Tracks clicks, views, and dwells (via `POST /api/feedback/actions`).
    - `snapshots`: Tracks location usage and frequency.
    - `coach_conversations`: Tracks chat engagement.
- **Feedback:** `venue_feedback` and `strategy_feedback` tables capture explicit user sentiment.

### Analytics Gaps
- No session flow analysis (e.g., drop-off rates).
- No feature adoption tracking (e.g., "How many users use the Map Tab vs Strategy Tab?").

### Future Strategy
- **PostHog / Mixpanel:** Integrate for product analytics.
- **Key Metrics:**
    - Daily Active Users (DAU)
    - Strategies Generated per User
    - Click-through rate on Smart Blocks
    - Chat retention rate
