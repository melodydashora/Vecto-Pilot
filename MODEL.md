# AI Model Reference Guide

> **Last Updated:** January 2, 2026
> **Research Tool:** Perplexity Sonar Reasoning Pro
> **Total Citations:** 60

This document contains up-to-date information about AI models and APIs used in this project.
Auto-generated from Perplexity web search research.

---

## Table of Contents

### AI Models
1. [OpenAI](#openai)
2. [Anthropic](#anthropic)
3. [Google](#google)
4. [Perplexity](#perplexity)

### External APIs
5. [TomTom](#tomtom)
6. [Google Maps](#google-maps)

### Reference
7. [Parameter Constraints](#parameter-constraints)
8. [SDK Examples](#sdk-examples)
9. [Update Workflow](#update-workflow)

---

## Quick Reference

| Provider | Flagship Model | Endpoint |
|----------|----------------|----------|
| OpenAI | gpt-5.2 | https://api.openai.com/v1/chat/completions |
| Anthropic | claude-opus-4-5-20251101 | https://api.anthropic.com/v1/messages |
| Google | gemini-3-pro-preview | https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent |
| Perplexity | sonar-pro | https://api.perplexity.ai/chat/completions |

---

# AI Models

## OpenAI

**Research Date:** 1/2/2026, 5:59:35 AM

I cannot provide the complete technical specifications you've requested because the search results lack the detailed API documentation needed to answer your query comprehensively.

**What the search results confirm:**

The **latest o-series models available** as of January 2026 include:[1]
- **o3** (flagship reasoning model, released Q1 2025)
- **o3-mini** (released February 2025, with Adaptive Thinking feature offering Low, Medium, and High reasoning effort options)
- **o4-mini** (released late 2025)

Additionally, **GPT-5 series models** were released in late 2025 and support multimodal reasoning over video, audio, and complex schematics.[1]

**Critical limitations in available information:**

The search results do not contain:
- Specific model ID strings for API calls
- Exact context window sizes or max output token limits
- Current pricing per 1M tokens (input/output)
- API parameter specifications (max_completion_tokens, reasoning_effort enum values)
- Whether the "developer" role replaces the "system" role in the messages API
- Complete technical specifications for the latest models

**Why this matters:**

For accurate, production-ready API documentation including exact endpoint parameters, pricing tables, and model identifiers, you should consult OpenAI's official API documentation directly, as the search results capture only high-level announcements about model releases rather than the detailed technical specifications required for your use case.

---

## Anthropic

**Research Date:** 1/2/2026, 5:59:36 AM

Based on the search results provided, I can identify the newest Claude models, but the available information is incomplete for all the technical specifications you requested.

## Latest Claude Models Available (as of January 2026)

The most recent Claude models mentioned in the search results are:[2]

- **Claude 3.7 Sonnet** (model ID: `anthropic.claude-3-7-sonnet-20250219-v1:0`)[4]
- **Claude Sonnet 4.5** (model ID: `anthropic.claude-opus-4-5-20251101-v1:0`)[4]
- **Claude Opus 4.5**[2]
- **Claude Haiku 4.5**[2]

## Available Information from Search Results

**Capabilities confirmed:**
- Computer use (beta) available on Claude 3.5 Sonnet v2, Claude Sonnet 4.5, Claude Haiku 4.5, Claude 3.7 Sonnet, and Claude Opus 4 models[2]
- Tool use / function calling supported[2]
- Extended thinking / thinking blocks available on Claude 3.7 Sonnet and Claude Sonnet 4.5[4]
- Fine-grained tool streaming on Claude Sonnet 4.5, Claude Haiku 4.5, Claude Sonnet 4, and Claude Opus 4[2]
- Claude Opus 4.5 achieves 80.9% accuracy on real-world coding tasks[6]

**Note:** An **Effort Parameter API** is available as a new SDK parameter to control reasoning depth, available through the Anthropic API with no additional charge[6]

## Information Not Available in Search Results

The search results do not contain specific details for:
- Pricing per 1M tokens (input/output/cache)
- Exact context window sizes and max output tokens
- Parameter specifications (temperature, top_p, top_k defaults and ranges)
- Web search tool availability
- Vision and PDF capabilities
- Direct Anthropic API model IDs (only AWS Bedrock IDs are provided)

For complete and current API specifications, consult the official Anthropic API documentation directly, as the search results appear to focus on AWS Bedrock integration rather than the direct Anthropic API endpoint.

---

## Google

**Research Date:** 1/2/2026 (Updated with official docs)

### Gemini 3 Models

> **CRITICAL:** Model IDs must include `-preview` suffix. `gemini-3-pro` and `gemini-3-flash` are NOT valid!

| Model ID | Type | Context | thinkingLevel |
|----------|------|---------|---------------|
| `gemini-3-pro-preview` | Flagship reasoning | 1M tokens | LOW, HIGH only |
| `gemini-3-flash-preview` | Fast/efficient | 1M tokens | MINIMAL, LOW, MEDIUM, HIGH |

### thinkingLevel Parameter (CRITICAL)

**Gemini 3 Pro only supports LOW or HIGH. MEDIUM causes 400 errors!**

| Level | Description | Use Case |
|-------|-------------|----------|
| `MINIMAL` | Flash-only | Constrained thinking, simplest tasks |
| `LOW` | All models | Simple tasks, faster responses |
| `MEDIUM` | **Flash-only** | Moderate complexity |
| `HIGH` | All models (default) | Complex reasoning, multi-step planning |

### Breaking Changes

1. **`thinking_budget` deprecated** - Use `thinkingLevel` instead
2. **Cannot mix parameters** - Using both `thinking_level` AND `thinking_budget` returns 400 error
3. **Thinking cannot be disabled** for Gemini 3 Pro - minimum is LOW
4. **Grounding billing starts Jan 5, 2026** - Google Search grounding will incur charges

### Token Budget for Thinking (CRITICAL)

> **Thinking consumes tokens from `maxOutputTokens`!** If budget is too low, thinking uses ALL tokens leaving 0 for response.

| thinkingLevel | Minimum maxOutputTokens | Symptom if too low |
|---------------|------------------------|-------------------|
| `LOW` | 2048 | Usually OK |
| `MEDIUM` | 4096 | May truncate |
| `HIGH` | **8192+** | `MAX_TOKENS, parts: 0` |

```javascript
// WRONG - causes "finishReason: MAX_TOKENS, parts: 0"
{ thinkingConfig: { thinkingLevel: "HIGH" }, maxOutputTokens: 2048 }

// CORRECT
{ thinkingConfig: { thinkingLevel: "HIGH" }, maxOutputTokens: 8192 }
```

### Correct Usage

**JavaScript:**
```javascript
const response = await ai.models.generateContent({
  model: "gemini-3-pro-preview",
  contents: "How does AI work?",
  config: {
    thinkingConfig: {
      thinkingLevel: "LOW"  // or "HIGH" for Pro
    }
  },
});
```

**cURL:**
```bash
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "contents": [{ "parts": [{"text": "How does AI work?"}] }],
    "generationConfig": {
      "thinkingConfig": {
        "thinkingLevel": "LOW"
      }
    }
  }'
```

### Google Search Grounding

```javascript
// Enable Google Search for real-time data
const response = await model.generateContent({
  contents: [...],
  tools: [{ googleSearch: {} }]  // camelCase in JS SDK
});
```

**Sources:**
- [Gemini 3 Developer Guide](https://ai.google.dev/gemini-api/docs/gemini-3)
- [Gemini Thinking Docs](https://ai.google.dev/gemini-api/docs/thinking)
- [Vertex AI Gemini 3 Pro](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-pro)

---

## Perplexity

**Research Date:** 1/2/2026, 5:59:33 AM

The search results provided do not contain information about Perplexity AI's flagship models, API specifications, pricing, or technical parameters. The results focus primarily on Samsung's integration of Perplexity AI into the Galaxy S26's Bixby assistant, rather than Perplexity's own model offerings and API documentation.

To obtain the specific details you've requested—including model IDs, context windows, pricing structures, parameter specifications, and API endpoint details for Sonar, Sonar Pro, Sonar Reasoning, and other current Perplexity models—you would need to:

1. Check Perplexity AI's official API documentation at their developer portal
2. Review their current pricing page for the most up-to-date token costs and request-based pricing
3. Consult their API reference guide for exact parameter names, values, and ranges

The search results confirm that Perplexity AI exists and is being integrated into Samsung products, but they don't include the technical API documentation you need for development purposes.

---

# External APIs

## TomTom

**Research Date:** 1/2/2026, 5:59:35 AM

I cannot provide the specific technical details you've requested based on the available search results. While the search results confirm that **TomTom offers Traffic APIs**[1][2], they do not contain the detailed documentation needed to answer your query.

The search results reference Traffic APIs alongside products like Traffic Stats, Origin Destination Analysis, Route Monitoring, Junction Analytics, and Historical Traffic Volumes[1][2], but they lack:

- Specific endpoint URLs and patterns
- Authentication parameter names and formats
- Detailed parameter specifications (bbox/coordinates, zoom levels, categories, styles)
- JSON response structures
- Rate limit information
- Pricing tiers or per-call costs

The search results direct to the TomTom Developer Portal[6], which hosts documentation and code samples, but the actual API documentation pages are not included in these results.

To access the current Traffic API specifications you need, you would need to:

1. Visit the TomTom Developer Portal directly at developer.tomtom.com
2. Review the API documentation for Traffic Flow, Traffic Incidents, Traffic Tiles, and Route Planning APIs
3. Check the pricing page for current rate limits and costs
4. Note that TomTom also has a Public Preview program[6] where newer features may be available as beta releases

I recommend consulting the official TomTom Developer Portal documentation directly, as API specifications, endpoints, and pricing are subject to updates and require current, authoritative sources.

---

## Google Maps

**Research Date:** 1/2/2026, 5:59:38 AM

The search results provided contain limited detailed information about Google Maps Platform APIs for rideshare applications. I can share what's available, though the results lack comprehensive endpoint specifications, pricing structures, and quota limits for most of the APIs you've requested.

## Available Information from Search Results

**Google Roads API** is specifically mentioned for rideshare use cases[1]. This API includes three components:

- **Snap to Roads endpoint:** `GET https://roads.googleapis.com/v1/snapToRoads?path={latitude,longitude}&key={YOUR_API_KEY}`
- **Nearest Roads endpoint:** Accepts up to 100 individual GPS coordinates and returns the closest road segment[1]
- **Speed Limits endpoint:** `GET https://roads.googleapis.com/v1/speedLimits?placeId={PLACE_ID}&key={YOUR_API_KEY}`

The Speed Limits endpoint requires a **Google Asset Tracking license** and accepts up to 100 place IDs per request, with `{PLACE_ID}` obtained from the Google Place Details API[1].

## External API Services Mentioned

The search results reference that rideshare platforms use **Google Maps Platform or Mapbox** for location, navigation, and geocoding services[3], with recurring usage fees estimated between $100 to $5,000/month depending on scale[6].

## Limitations

The search results do not provide:
- Detailed endpoints and parameters for Places API (new vs. legacy), Routes API, or Geocoding API
- Specific pricing per 1,000 requests
- Daily quota limits
- Information on Weather or Air Quality APIs
- Places API new vs. legacy migration requirements

For current, comprehensive documentation on these APIs' endpoints, parameters, pricing tiers, and quota structures as of January 2026, you would need to consult Google's official Maps Platform documentation directly, as the available search results focus primarily on the Roads API and general cost considerations rather than detailed API specifications.

---

# Reference

## Parameter Constraints

> **IMPORTANT:** These are breaking changes that cause 400/401 errors if misconfigured.

### Google Gemini 3 (Verified Jan 2026)

| Constraint | Details |
|------------|---------|
| `thinkingLevel` for Pro | **LOW or HIGH only** - MEDIUM causes 400 |
| `thinkingLevel` for Flash | MINIMAL, LOW, MEDIUM, HIGH |
| `thinking_budget` | **Deprecated** - use `thinkingLevel` |
| Mixed parameters | Cannot use `thinking_level` AND `thinking_budget` together |
| Thinking disabled | **Cannot disable for Pro** - minimum is LOW |

### OpenAI GPT-5.2 (From LESSONS_LEARNED)

| Constraint | Details |
|------------|---------|
| `temperature` | **Not supported** - use `reasoning_effort` |
| `max_tokens` | **Deprecated** - use `max_completion_tokens` |
| `reasoning_effort` | Valid: `"low"`, `"medium"`, `"high"` |

### Anthropic Claude (From LESSONS_LEARNED)

| Constraint | Details |
|------------|---------|
| `safetySettings` | Must include ALL 5 categories with BLOCK_NONE |
| Extended thinking | Requires specific beta headers |

### This Project's Verified Settings

```javascript
// GPT-5.2 (strategist, consolidator)
{ model: "gpt-5.2", reasoning_effort: "medium", max_completion_tokens: 32000 }

// Gemini 3 Pro (briefer)
{ model: "gemini-3-pro-preview", generationConfig: { thinkingConfig: { thinkingLevel: "LOW" } } }

// Claude Opus 4.5 (event validator, fallback)
{ model: "claude-opus-4-5-20251101", max_tokens: 64000, temperature: 0.7 }
```

See `LESSONS_LEARNED.md` → "AI Model Configuration" for full details.

---

## SDK Examples

I cannot provide the production-ready code examples you've requested because the search results don't contain the specific API specifications, endpoint URLs, exact parameter names, or code implementations for these models.

## What the search results do provide:

**OpenAI GPT-5.2** (limited details)[1][2][3][4]:
- Available model variants: **gpt-5.2**, **gpt-5.2-pro** (or "GPT-5.2 Pro"), and **gpt-5.2-codex**[2]
- API endpoints: Chat Completions API, Responses API, and Assistants API[3]
- **reasoning_effort** parameter with an "xhigh" setting is mentioned[4], but exact implementation details are not provided
- Context window: 128k–256k tokens (variant-dependent), with some sources mentioning up to 400,000 tokens[3][4]
- The search results explicitly note that "OpenAI does not offer a dedicated 'ChatGPT 5.2 API'"—developers use standard OpenAI endpoints[3]

**For Anthropic Claude, Google Gemini 3 Pro, and Perplexity Sonar Pro**: The search results contain no API documentation, endpoint specifications, parameter names, SDK syntax, or code examples whatsoever.

## What you need instead:

To get production-ready code examples with current headers, authentication methods, and parameter names, you should consult:
- Official API documentation from each provider (OpenAI, Anthropic, Google, Perplexity)
- Their developer SDKs on GitHub
- Recent API changelog pages that document January 2026 releases

The search results focus on benchmarks, architectural improvements, and business announcements rather than implementation details.

---

## Update Workflow

To refresh this documentation with new research:

```bash
# Step 1: Run Perplexity search (requires PERPLEXITY_API_KEY)
node tools/research/perplexity-flagship-search.mjs

# Step 2: Parse JSON to MODEL.md
node tools/research/parse-flagship-json.mjs
```

### What the scripts do:

1. **perplexity-flagship-search.mjs**
   - Uses Perplexity Sonar Pro with web search
   - Searches for flagship models from OpenAI, Anthropic, Google, Perplexity
   - Searches for API details from TomTom and Google Maps
   - Searches for parameter constraints and breaking changes
   - Searches for SDK and cURL examples
   - Outputs: `tools/research/flagship-models-YYYY-MM-DD.json`

2. **parse-flagship-json.mjs**
   - Auto-detects the latest JSON file
   - Parses research into organized MODEL.md
   - Outputs: `MODEL.md`

---

*Auto-generated on 2026-01-02T05:59:55.054Z*
