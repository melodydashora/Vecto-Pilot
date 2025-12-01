# AI Model Reference - Production Configuration
**Last Updated**: December 1, 2025  
**Research Source**: Perplexity AI via `tools/research/model-discovery.mjs`

---

## 🎯 Verified Production Models

### OpenAI GPT-5
**Status**: ✅ Production (Latest)

```env
OPENAI_MODEL=gpt-5
```

**API Details**:
- **Endpoint**: `POST https://api.openai.com/v1/chat/completions`
- **Model ID**: `gpt-5` (latest flagship reasoning model)
- **Context Window**: 256K tokens
- **Headers**:
  - `Authorization: Bearer <API_KEY>`
  - `Content-Type: application/json`

**Supported Parameters** (⚠️ BREAKING CHANGES):
```javascript
{
  "model": "gpt-5",
  "messages": [...],
  "reasoning_effort": "minimal" | "low" | "medium" | "high",  // ✅ USE THIS
  "max_completion_tokens": 32000,
  "stream": true,
  "stop": [...],
  "tools": [...]
}
```

**❌ DEPRECATED PARAMETERS** (GPT-5 does NOT support):
- `temperature` → Use `reasoning_effort` instead
- `top_p` → Use `reasoning_effort` instead  
- `frequency_penalty` → Not supported
- `presence_penalty` → Not supported

---

### Anthropic Claude Sonnet 4.5
**Status**: ✅ Verified Working

```env
CLAUDE_MODEL=claude-sonnet-4-5-20250929
ANTHROPIC_API_VERSION=2023-06-01
```

**API Details**:
- **Endpoint**: `POST https://api.anthropic.com/v1/messages`
- **Model ID**: `claude-sonnet-4-5-20250929`
- **Context Window**: 200K tokens (1M with beta header)
- **Headers**:
  - `x-api-key: <API_KEY>`
  - `anthropic-version: 2023-06-01`
  - `Content-Type: application/json`

**Supported Parameters**:
```javascript
{
  "model": "claude-sonnet-4-5-20250929",
  "messages": [...],
  "max_tokens": 64000,
  "temperature": 0.7,
  "top_p": 0.95,
  "system": "...",
  "stop_sequences": [...]
}
```

---

### Google Gemini 2.5 Pro
**Status**: ✅ Production

```env
GEMINI_MODEL=gemini-2.5-pro-latest
```

**API Details**:
- **Endpoint**: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- **Model ID**: `gemini-2.5-pro-latest`
- **Context Window**: 1M tokens
- **Headers**:
  - `Authorization: Bearer <API_KEY>`
  - `Content-Type: application/json`

**Supported Parameters**:
```javascript
{
  "model": "gemini-2.5-pro-latest",
  "contents": [...],
  "generationConfig": {
    "temperature": 0.7,
    "topP": 0.95,
    "maxOutputTokens": 2048,
    "stopSequences": [...]
  }
}
```

---

## 📰 News & Events Discovery APIs

### Perplexity AI - Real-Time Local Events
**Status**: ✅ Best for Local Event Discovery

```env
PERPLEXITY_API_KEY=<your_key>
PERPLEXITY_MODEL=sonar-pro
```

**API Details**:
- **Endpoint**: `POST https://api.perplexity.ai/chat/completions`
- **Best For**: Games, concerts, comedy, live music, festivals within 50 miles TODAY
- **Context Window**: Unlimited (web search)

**Optimal Parameters for Local Events**:
```javascript
{
  "model": "sonar-pro",
  "messages": [
    {
      "role": "user",
      "content": "Find local events within 50 miles of LAT,LNG happening TODAY. Focus: concerts, games, comedy, live music."
    }
  ],
  "search_recency_filter": "day",      // ✅ TODAY only (alternatives: week, month)
  "return_related_questions": false,
  "stream": false,
  "temperature": 0.2,                   // ✅ Low temp for factual results
  "max_tokens": 2000
}
```

**Web Search Parameters**:
- `search_recency_filter`: "day" | "week" | "month" - Restricts results to time period
- Perplexity automatically performs web search when querying current events
- Returns citations with source URLs for verification

**Response Format**: JSON-parseable event list or cited text with coordinates

---

### SerpAPI - Google Search Events Engine
**Status**: ✅ Alternative for Local Events

```env
SERP_API_KEY=<your_key>
```

**API Details**:
- **Endpoint**: `https://serpapi.com/search.json`
- **Best For**: Google Events listings (faster than news)
- **Query Cost**: 0.1 credit per successful search

**Optimal Parameters for Local Events**:
```javascript
{
  "engine": "google_events",           // ✅ Use events engine, not news
  "q": "games concerts comedy live music performances",
  "location": "Irving, TX",            // ✅ Explicit location
  "gl": "us",                          // ✅ Country
  "tbm": "evt",                        // ✅ Event results type
  "ijn": "0",
  "api_key": SERP_API_KEY
}
```

**Alt: Google News with Web Search**:
```javascript
{
  "engine": "google",
  "q": "concerts games performances events Irving TX",
  "tbm": "nws",                        // ✅ News results
  "tbs": "qdr:d",                      // ✅ Last 24 hours
  "api_key": SERP_API_KEY
}
```

**Key Differences**:
- `google_events`: Structured event listings (times, locations, RSVP links)
- `tbm=nws`: News articles about events (good for demand indicators)
- `tbs=qdr:d`: Time filter - "d" (day), "w" (week), "m" (month)

---

### NewsAPI - National/Regional Event Coverage
**Status**: ⚠️ Fallback (Less Local Precision)

```env
NEWS_API_KEY=<your_key>
```

**API Details**:
- **Endpoint**: `https://newsapi.org/v2/everything`
- **Best For**: Event coverage, demand signals, festival announcements
- **Rate Limit**: 500 requests/day (free tier)

**Optimal Parameters**:
```javascript
{
  "q": "games concerts comedy shows live music events",
  "sortBy": "publishedAt",             // ✅ Most recent first
  "language": "en",
  "pageSize": 10,                      // ✅ Limit results
  "searchIn": "title,description",     // ✅ Deep search
  "apiKey": NEWS_API_KEY
}
```

**Limitations**:
- No location filtering in query (must filter response)
- Broader coverage (national/international) - less precise for local
- ~5-10 second indexing lag

---

### Gemini - Event Filtering & Geocoding
**Status**: ✅ Post-Processing & Coordinate Extraction

**Use Case**: Convert raw API responses → structured event data with coordinates

```javascript
{
  "model": "gemini-2.5-pro-latest",
  "contents": [
    {
      "parts": [
        {
          "text": `Convert to JSON array with event details:
          - title: Event name
          - location: Venue address
          - latitude: Geocoded lat
          - longitude: Geocoded lng
          - distance_miles: From LAT,LNG
          - event_date: ISO string
          - event_time: HH:MM format
          
          Input: [raw event data]
          Output: JSON array only`
        }
      ]
    }
  ],
  "generationConfig": {
    "temperature": 0.1,                // ✅ Deterministic extraction
    "maxOutputTokens": 2000,
    "responseMimeType": "application/json"
  }
}
```

---

## 🔄 Vecto Pilot Configuration

### Multi-API Fallback Chain (Local Events)

```env
# Primary: Perplexity (web search, real-time, local)
PERPLEXITY_API_KEY=<key>
PERPLEXITY_MODEL=sonar-pro
PERPLEXITY_SEARCH_RECENCY=day

# Fallback 1: SerpAPI (Google Events engine)
SERP_API_KEY=<key>
SERP_ENGINE=google_events

# Fallback 2: NewsAPI (event coverage)
NEWS_API_KEY=<key>

# Post-processor: Gemini (geocoding, filtering)
GEMINI_MODEL=gemini-2.5-pro-latest
GOOGLE_API_KEY=<key>

# Briefing config
LOCAL_EVENT_RADIUS_MILES=50
LOCAL_EVENT_FILTER_TODAY_ONLY=true
LOCAL_EVENT_TYPES=concert,game,comedy,live_music,festival,sports,performance
```

---

## 🧪 Testing & Verification

### Test Perplexity Local Events
```bash
curl -X POST "https://api.perplexity.ai/chat/completions" \
  -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "sonar-pro",
    "messages": [{
      "role": "user",
      "content": "Find concerts and live music events in Irving, TX within 50 miles TODAY. Return JSON array with: title, location, time, type."
    }],
    "search_recency_filter": "day",
    "temperature": 0.2,
    "max_tokens": 2000
  }' | jq .
```

### Test SerpAPI Events
```bash
curl "https://serpapi.com/search.json?engine=google_events&q=concerts+games+Irving+TX&location=Irving,TX&gl=us&api_key=$SERP_API_KEY" | jq '.events_results | .[0:3]'
```

### Test NewsAPI
```bash
curl "https://newsapi.org/v2/everything?q=concerts+games+comedy&sortBy=publishedAt&language=en&pageSize=5&apiKey=$NEWS_API_KEY" | jq '.articles | .[0:2]'
```

### Test Gemini Filtering
```bash
node -e "
const events = [
  {title: 'Dallas Concert', location: 'Irving TX', details: '7pm tonight'},
  {title: 'Football Game', location: '50 miles away', details: '8pm'}
];

fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=' + process.env.GOOGLE_API_KEY, {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    contents: [{parts: [{text: 'Convert to JSON with coordinates: ' + JSON.stringify(events)}]}],
    generationConfig: {temperature: 0.1, responseMimeType: 'application/json'}
  })
}).then(r => r.json()).then(d => console.log(d.candidates?.[0]?.content?.parts?.[0]?.text))
"
```

---

## 📚 Research Sources

Full research report available at:
- `tools/research/model-research-December 1, 2025.json`

Key sources:
- OpenAI: https://platform.openai.com/docs
- Anthropic: https://www.anthropic.com/docs
- Google AI: https://ai.google.dev/gemini-api
- Perplexity: https://docs.perplexity.ai
- SerpAPI: https://serpapi.com/docs
- NewsAPI: https://newsapi.org/docs

---

## 🔄 Update Workflow

1. **Run Research**: `node tools/research/model-discovery.mjs`
2. **Generate MODEL.md**: `node tools/research/generate-model-md.mjs`
3. **Review Output**: Check `MODEL.md` and `tools/research/model-research-YYYY-MM-DD.json`
4. **Update Code**: Sync `server/lib/briefing-service.js` with new parameters
5. **Test APIs**: Use curl examples above
6. **Commit Changes**: Git commit with research findings

---

*Auto-generated from Perplexity research. Update frequency: Monthly recommended.*
