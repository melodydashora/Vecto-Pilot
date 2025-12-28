# Notifications

Alert and notification system for operational events.

## Files

| File | Purpose |
|------|---------|
| `email-alerts.js` | Email notification service |

## Email Alerts

Sends email notifications for:
- Critical system errors
- AI pipeline failures
- Database connection issues
- Rate limit warnings

## Configuration

Requires email service configuration:

```bash
# Environment variables
EMAIL_SERVICE=sendgrid  # or smtp, ses
EMAIL_API_KEY=xxx
EMAIL_FROM=alerts@vectopilot.com
EMAIL_TO=ops@vectopilot.com
```

## Usage

```javascript
import { sendAlert } from './notifications/email-alerts.js';

await sendAlert({
  subject: 'Pipeline Failure',
  message: 'TRIAD pipeline failed for snapshot xyz',
  severity: 'critical'
});
```

## Alert Levels

| Level | Use Case |
|-------|----------|
| `critical` | Immediate attention needed |
| `warning` | Degraded performance |
| `info` | Operational events |

## See Also

- [server/jobs/](../../jobs/) - Background job monitoring
