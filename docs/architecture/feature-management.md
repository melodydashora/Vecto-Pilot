# Feature Management & Experimentation

**Last Updated:** 2026-02-10

This document outlines how features are managed, toggled, and tested.

## 1. Feature Flags

### Current Implementation
Feature flags are currently managed via **Environment Variables**.

| Flag | Description | Default |
| :--- | :--- | :--- |
| `ENABLE_BACKGROUND_WORKER` | Enables `job-queue.js` processing. | `false` (Auto-enabled in `worker` mode) |
| `USE_LISTEN_MODE` | Enables DB LISTEN/NOTIFY for real-time updates. | `false` |
| `LOG_LEVEL` | Controls verbosity (`debug`, `info`, `warn`, `error`). | `info` |

### Future Strategy (LaunchDarkly / GrowthBook)
As the team grows, we will migrate to a dedicated Feature Flagging service to allow:
- **Runtime Toggling:** Turn features on/off without redeploying.
- **User Targeting:** Enable features for specific `user_id` or `market`.
- **Percentage Rollouts:** Gradually release features to 10%, 50%, 100% of users.

## 2. A/B Testing

### Architecture
The database schema supports experimentation at the **Strategy** level.

- **Table:** `ranking_candidates`
- **Fields:**
    - `exploration_policy`: The algorithm used (e.g., `greedy`, `epsilon-greedy`, `bandit`).
    - `epsilon`: The exploration rate (0.0 - 1.0).
    - `model_score`: The raw score assigned by the AI.

### Workflow
1.  **Assignment:** When generating Smart Blocks, the `VENUE_SCORER` can optionally inject randomness or alternative scoring logic.
2.  **Tracking:** User actions (clicks, navigation) are logged in the `actions` table with the `ranking_id`.
3.  **Analysis:** Data Scientists query `actions` JOIN `ranking_candidates` to compare performance of different policies.

### Status
- ** Infrastructure:** Ready (Schema exists).
- ** Implementation:** Currently using deterministic `greedy` policy (Top N scores).
