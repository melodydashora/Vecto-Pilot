# Mobile Subscription Architecture

This document outlines the architectural considerations for building subscription-based mobile services for iOS and Android platforms.

> **Key Insight**: iOS and Android require fundamentally different technical approaches for subscription services, particularly for real-time driver assistance applications.

## Platform Comparison

| Capability | iOS | Android |
|------------|-----|---------|
| Screenshot automation | iOS Shortcuts (no app required) | Requires published app |
| Background processing | Limited | Full service support |
| Overlay permissions | Not available | Accessibility service |
| App Store requirement | Shortcuts bypass for MVP | Required for automation |
| Subscription billing | In-app purchase | Play billing or external |

## iOS Architecture

### Phase 1: Shortcuts-Based MVP

iOS Shortcuts provide a rapid path to market without App Store approval.

```
User Flow:
1. Take screenshot of ping
2. Share to Vecto Pilot shortcut
3. Shortcut extracts text (native OCR)
4. Shortcut calls /api/ping/analyze-text
5. Result shown as notification + spoken
```

#### Shortcut Components

```yaml
Shortcut Name: "Analyze Ping"
Trigger: Share Sheet (Image)
Actions:
  1. Extract Text from Image
  2. Set Variable (ocr_text)
  3. Get Contents of URL:
      URL: https://api.vectopilot.com/api/ping/analyze-text
      Method: POST
      Headers:
        Authorization: Bearer {{API_KEY}}
        Content-Type: application/json
      Body: {"ocr_text": "{{ocr_text}}", "session_id": "{{DEVICE_ID}}"}
  4. Get Dictionary Value (verdict)
  5. Show Notification: {{verdict}}
  6. Speak Text: {{speak_text}}
```

#### Subscription Management

Without an iOS app, subscription management requires:

```
Options:
1. Web-based subscription portal
2. Stripe Customer Portal for billing
3. API key distribution via email/web
4. Usage tracking server-side
```

### Phase 2: Native iOS App

For enhanced features beyond Shortcuts capabilities:

| Feature | Shortcut | Native App |
|---------|----------|------------|
| Screenshot capture | Manual share | Auto-detect (limited) |
| Push notifications | Yes | Yes + rich media |
| Widget display | No | Yes |
| Siri integration | Basic | Full |
| Background refresh | No | Limited |
| In-app purchases | No | Yes |

---

## Android Architecture

### Required Components

Android requires a published application for full automation capabilities.

```
App Components:
1. Foreground Service - Runs during driving sessions
2. Accessibility Service - Monitors screen content
3. Notification Listener - Alternative to accessibility
4. Overlay View - Shows recommendations
```

#### Foreground Service Pattern

```kotlin
class PingAnalyzerService : Service() {

    companion object {
        private const val NOTIFICATION_ID = 1
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = createNotification()
        startForeground(NOTIFICATION_ID, notification)

        // Start screen monitoring
        startScreenMonitoring()

        return START_STICKY
    }

    private fun startScreenMonitoring() {
        // Option 1: Accessibility Service for screen content
        // Option 2: MediaProjection for screenshots
        // Option 3: Manual screenshot + share intent
    }
}
```

#### Screen Content Detection

```kotlin
class PingAccessibilityService : AccessibilityService() {
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        when (event?.eventType) {
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                val rootNode = rootInActiveWindow
                if (isRideshareApp(rootNode)) {
                    val pingData = extractPingData(rootNode)
                    if (pingData != null) {
                        analyzeAndNotify(pingData)
                    }
                }
            }
        }
    }

    private fun isRideshareApp(node: AccessibilityNodeInfo?): Boolean {
        val packageName = node?.packageName?.toString() ?: return false
        return packageName in listOf(
            "com.ubercab.driver",
            "com.lyft.android.driver"
        )
    }
}
```

### Play Store Requirements

| Requirement | Description |
|-------------|-------------|
| Accessibility disclosure | Must explain why service is needed |
| Privacy policy | Required for data collection |
| Target API level | API 33+ for new apps |
| Data safety form | Declare all data collection |

---

## Subscription Models

### Pricing Tiers

| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | 10 analyses/day, basic recommendations |
| Pro | $9.99/mo | Unlimited analyses, pattern alerts |
| Elite | $19.99/mo | + Market rate cards, surge predictions |

### Technical Implementation

```javascript
// Subscription validation middleware
async function validateSubscription(req, res, next) {
  const apiKey = req.headers.authorization?.replace('Bearer ', '');

  const subscription = await db.query(`
    SELECT tier, status, expires_at
    FROM subscriptions
    WHERE api_key = $1
  `, [apiKey]);

  if (!subscription || subscription.status !== 'active') {
    return res.status(403).json({ error: 'Invalid or expired subscription' });
  }

  // Check usage limits for free tier
  if (subscription.tier === 'free') {
    const todayUsage = await getDailyUsage(apiKey);
    if (todayUsage >= 10) {
      return res.status(429).json({
        error: 'Daily limit reached',
        upgrade_url: 'https://vectopilot.com/upgrade'
      });
    }
  }

  req.subscription = subscription;
  next();
}
```

### Database Schema

```sql
CREATE TABLE subscriptions (
  subscription_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(user_id),
  tier TEXT NOT NULL DEFAULT 'free', -- 'free', 'pro', 'elite'
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'canceled', 'expired'
  api_key TEXT UNIQUE NOT NULL,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ
);

CREATE TABLE usage_logs (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_usage_daily ON usage_logs(api_key, created_at);
```

---

## API Design for Mobile

### Optimizations for Mobile Clients

```javascript
// Compact response format for mobile
const MOBILE_RESPONSE = {
  // Essential fields only
  v: "ACCEPT",           // verdict (short)
  c: 0.88,               // confidence
  r: "Good fare...",     // reason (truncated)
  s: "ACCEPT. Good...",  // speak_text

  // Optional expanded data (only if requested)
  expanded: {
    algorithmic_insights: { /* ... */ },
    pattern_alerts: [ /* ... */ ]
  }
};

// Endpoint supports compact mode
app.post('/api/ping/analyze-text', async (req, res) => {
  const { compact = true } = req.query;

  const result = await analyzeText(req.body);

  if (compact) {
    return res.json({
      v: result.recommendation,
      c: result.confidence,
      r: result.reasoning.primary.substring(0, 100),
      s: `${result.recommendation}. ${result.reasoning.primary.substring(0, 50)}`
    });
  }

  return res.json(result);
});
```

### Response Time Targets

| Operation | Target | Notes |
|-----------|--------|-------|
| OCR text analysis | < 500ms | No AI model call |
| Screenshot analysis | < 2s | Claude Vision call |
| Full recommendation | < 3s | With enrichment |

---

## Security Considerations

### API Key Management

```javascript
// Generate secure API keys
function generateApiKey() {
  return `vp_${crypto.randomBytes(32).toString('hex')}`;
}

// Rate limiting per key
const rateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: (req) => {
    const tier = req.subscription?.tier;
    return tier === 'elite' ? 100 : tier === 'pro' ? 50 : 10;
  },
  keyGenerator: (req) => req.headers.authorization
});
```

### Data Privacy

| Data Type | Retention | Notes |
|-----------|-----------|-------|
| Screenshots | Not stored | Processed in memory only |
| OCR text | 24 hours | For debugging, then deleted |
| Recommendations | 30 days | For pattern analysis |
| Location | Session only | Not persisted |

---

## Deployment Architecture

```
                    ┌─────────────────┐
                    │   CloudFlare    │
                    │   (CDN + WAF)   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
      ┌───────▼───────┐ ┌───▼───┐ ┌───────▼───────┐
      │ iOS Shortcuts │ │  Web  │ │ Android App   │
      │   (direct)    │ │ Portal│ │   (direct)    │
      └───────┬───────┘ └───┬───┘ └───────┬───────┘
              │             │             │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼────────┐
                    │   API Gateway   │
                    │  (rate limit)   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Vecto Pilot    │
                    │     Server      │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
      ┌───────▼───────┐ ┌───▼───┐ ┌───────▼───────┐
      │   PostgreSQL  │ │ Redis │ │  AI Models    │
      │   (primary)   │ │(cache)│ │ (Claude, etc) │
      └───────────────┘ └───────┘ └───────────────┘
```

---

## Related Documentation

- [Rideshare Algorithm Research](rideshare-algorithm-research.md) - Detection rules and patterns
- [API Reference](../architecture/api-reference.md) - Endpoint documentation
- [Auth System](../architecture/auth-system.md) - Authentication patterns
