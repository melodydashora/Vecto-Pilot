# Disaster Recovery & Backup

**Last Updated:** 2026-02-10

This document outlines the backup and recovery procedures for the Vecto Co-Pilot platform.

## 1. Database Backups

### Infrastructure
The primary database is **PostgreSQL** managed by Replit.

- **Automated Backups:** Replit performs automated daily backups of the persistent storage.
- **Point-in-Time Recovery (PITR):** Available via Replit support for critical data loss.

### Manual Backup Procedure (Dev/Admin)
To create a manual snapshot of critical tables:
```bash
pg_dump $DATABASE_URL -t users -t driver_profiles -t venue_catalog > backup_$(date +%F).sql
```

## 2. Recovery Procedures

### Scenario A: Deployment Failure
If a new deployment breaks the application:
1.  **Revert:** Use Git to revert to the last known stable commit.
    ```bash
    git revert HEAD
    git push origin main
    ```
2.  **Redeploy:** Replit will automatically rebuild and restart.

### Scenario B: Database Corruption
1.  **Stop Writes:** Scale down application instances to 0.
2.  **Restore:** Import the latest valid backup.
    ```bash
    psql $DATABASE_URL < backup_latest.sql
    ```
3.  **Validate:** Check `driver_profiles` and `venue_catalog` integrity.
4.  **Restart:** Scale up application instances.

### Scenario C: External API Outage (e.g., Google Maps)
1.  **Circuit Breakers:** The system has built-in circuit breakers for Google APIs (`server/api/location/location.js`).
2.  **Fallback Mode:**
    - **Geocoding:** Fails hard (Safety first - no bad locations).
    - **Traffic/Briefing:** Returns "Data unavailable" placeholder, allows app to function with limited features.
    - **Strategy:** Falls back to heuristic-based advice if AI APIs fail (configured in `model-registry.js`).

## 3. Data Retention Policies

- **Snapshots:** Retained indefinitely for ML training (currently). *Planned: 90-day retention.*
- **Logs:** Replit logs retained for 7 days.
- **User Accounts:** `driver_profiles` retained until user deletion request.
- **Session Data:** `users` table rows are ephemeral (60 min TTL).
