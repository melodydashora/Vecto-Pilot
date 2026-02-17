# Database Schema Reference

This document details the database schema definitions found in `shared/schema.js`.

## Overview
The schema is designed around three core tables serving distinct purposes:
1.  **`driver_profiles`**: Identity (Permanent).
2.  **`users`**: Session Tracking (Ephemeral).
3.  **`snapshots`**: Activity & Context (Permanent).
4.  **`strategies`**: AI Output (Permanent).

---

## 1. Users Table (`users`)
**Purpose:** Session Tracking Only (Ephemeral).
**Updated:** 2026-01-05 (Simplified Architecture).

*   **Retention:** Temporary (60 min TTL).
*   **Session Rules:**
    *   **Highlander Rule:** One device per user (login on a new device terminates the old session).
    *   **Sliding Window:** `last_active_at` updates on every request.
    *   **Lazy Cleanup:** Expired sessions are deleted on the next `requireAuth` check.

| Column | Type | Description |
| :--- | :--- | :--- |
| `user_id` | UUID | **Primary Key**. Links to `driver_profiles`. |
| `device_id` | Text | Device identifier making the request. |
| `session_id` | UUID | Current session UUID. |
| `current_snapshot_id` | UUID | The user's ONE active snapshot. |
| `session_start_at`