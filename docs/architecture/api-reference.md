# API Reference

Complete frontend → backend API endpoint reference.

## Core Endpoints

### Strategy & Venues

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/blocks-fast` | POST | `server/api/strategy/blocks-fast.js` | Full TRIAD pipeline (strategy + venues) |
| `/api/blocks-fast` | GET | `server/api/strategy/blocks-fast.js` | Retrieve existing blocks |
| `/api/blocks/strategy/:id` | GET | `server/api/strategy/content-blocks.js` | Fetch strategy content blocks |
| `/api/strategy/:snapshotId` | GET | `server/api/strategy/strategy.js` | Fetch strategy for snapshot |

### Location & GPS

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/location/resolve` | POST | `server/api/location/location.js` | Resolve GPS → address + user_id |
| `/api/location/weather` | GET | `server/api/location/location.js` | Current weather for location |
| `/api/location/airquality` | GET | `server/api/location/location.js` | Air quality index for location |
| `/api/location/snapshot` | POST | `server/api/location/location.js` | Create location snapshot |
| `/api/geocode/reverse` | GET | `server/api/location/location.js` | Reverse geocode coordinates |
| `/api/timezone` | GET | `server/api/location/location.js` | Get timezone for coordinates |
| `/api/users/me` | GET | `server/api/location/location.js` | Get current user data |
| `/api/snapshot/:id` | GET | `server/api/location/snapshot.js` | Fetch snapshot by ID |

### Briefing Data

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/briefing/weather/:snapshotId` | GET | `server/api/briefing/briefing.js` | Weather briefing data |
| `/api/briefing/traffic/:snapshotId` | GET | `server/api/briefing/briefing.js` | Traffic conditions data |
| `/api/briefing/events/:snapshotId` | GET | `server/api/briefing/briefing.js` | Local events data |
| `/api/briefing/rideshare-news/:snapshotId` | GET | `server/api/briefing/briefing.js` | Rideshare-relevant news |
| `/api/briefing/school-closures/:snapshotId` | GET | `server/api/briefing/briefing.js` | School/college closures |

### Chat & Voice

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/chat` | POST | `server/api/chat/chat.js` | AI Coach chat with SSE streaming |
| `/api/realtime/token` | GET | `server/api/chat/realtime.js` | OpenAI Realtime API token for voice |
| `/api/tts` | POST | `server/api/chat/tts.js` | Text-to-speech generation |

### Feedback & Actions

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/feedback/venue` | POST | `server/api/feedback/feedback.js` | Venue thumbs up/down feedback |
| `/api/feedback/strategy` | POST | `server/api/feedback/feedback.js` | Strategy thumbs up/down feedback |
| `/api/feedback/app` | POST | `server/api/feedback/feedback.js` | General app feedback |
| `/api/actions` | POST | `server/api/feedback/actions.js` | Log user actions (view, select, navigate) |

### Venue Intelligence

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/closed-venue-reasoning` | POST | `server/api/venue/closed-venue-reasoning.js` | AI reasoning for closed venues |
| `/api/venues/:placeId` | GET | `server/api/venue/venue-intelligence.js` | Get venue details |

### Authentication

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/auth/token` | POST | `server/api/auth/auth.js` | Generate JWT from device_id |

### Health & Diagnostics

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/` | GET | `server/api/health/health.js` | Basic health check |
| `/health` | GET | `server/api/health/health.js` | Detailed health with DB/API status |
| `/ready` | GET | `server/api/health/health.js` | Kubernetes readiness probe |
| `/api/diagnostic/identity` | GET | `server/api/health/diagnostic-identity.js` | System identity check |

## Authentication

All API calls should include the JWT token:

```javascript
const headers = {
  'Authorization': `Bearer ${localStorage.getItem('vecto_auth_token')}`,
  'Content-Type': 'application/json'
};
```

## Error Responses

Standard error format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

Common HTTP codes:
- `400` - Bad request / validation error
- `401` - Unauthorized (missing/invalid token)
- `404` - Resource not found
- `429` - Rate limited
- `500` - Internal server error
- `504` - Gateway timeout (AI processing took too long)
