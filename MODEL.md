# AI Model Reference Guide

> **Last Updated:** December 13, 2025
> **Research Tool:** Perplexity Sonar Reasoning Pro
> **Total Citations:** 54

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

**Research Date:** 12/13/2025, 6:10:03 PM

## Latest OpenAI Flagship Models (December 2025)

OpenAI's newest flagship models available via API are part of the GPT-5.2 family, launched December 11, 2025.[1]

**GPT-5.2 Variants**

The following model IDs are available through the OpenAI API:[1]

- **gpt-5.2** — The standard GPT-5.2 Thinking variant for complex reasoning tasks
- **gpt-5.2-chat-latest** — GPT-5.2 Instant variant for routine queries requiring speed
- **gpt-5.2-pro** — Premium tier for maximum accuracy and reliability on demanding problems

## Available Technical Details

**What the search results confirm:**

- GPT-5.2 excels at extended context understanding and multi-step complex tasks[1]
- The model demonstrates 38% fewer errors compared to GPT-5.1[1]
- Pricing for GPT-5.2 variants is substantially lower than o1-pro, which costs $150/$600 per million input/output tokens[1]

## Information Not Available

The search results do not contain the specific technical specifications you requested:

- **Context window size** — not specified
- **Max output tokens** — not specified
- **Exact pricing per 1M tokens** for GPT-5.2 variants — not provided (only comparison to o1-pro mentioned)
- **API parameters** (max_completion_tokens, reasoning_effort values) — not documented
- **"Developer" vs "system" role** behavior — not addressed
- **Other o-series models** currently available — not listed

For comprehensive API documentation with exact parameters, pricing tables, and endpoint specifications, you would need to consult OpenAI's official API documentation directly, as these search results focus on product announcements rather than detailed technical specifications.

---

## Anthropic

**Research Date:** 12/13/2025, 6:10:07 PM

# Latest Anthropic Claude Models via API (December 2025)

The most recent Claude models available via API are from the Claude 4.5 series, with Claude Opus 4.5 being Anthropic's most capable model to date.[1][2]

## Claude Opus 4.5

**Model ID:** `claude-opus-4-5-20251101`[2]

**Overview:** Claude Opus 4.5 is Anthropic's most capable general-purpose model, positioned for complex software engineering, advanced reasoning, and multi-step agentic workflows.[2] It functions as a hybrid reasoning model, responding rapidly in default mode or processing extended thinking when enabled.[6]

**Capabilities:**
- Computer use (Anthropic's most accurate for this task)[1]
- Advanced coding and software engineering[2]
- Complex multi-step agent behavior and procedural reasoning[2]
- Function calling and tool usage with optimized MCP (Model Context Protocol) handling[3]
- Robust safety alignment with resistance to prompt injection attacks[2]

**Developer Controls:** Includes an "effort" parameter allowing developers to choose between faster, cheaper outputs or more thorough, higher-capability reasoning for the same model.[2]

---

## Claude Sonnet 4.5

**Model ID:** `claude-sonnet-4@20250514`[5]

**Overview:** Claude Sonnet 4.5 balances speed and cost for high-volume use cases, serving as the mid-tier option in the latest generation.[1]

**Capabilities:** Vision, function calling, and reduced latency compared to Opus variants.

---

## Claude Haiku 4.5

**Model ID:** `claude-3-5-haiku@20241022`[5]

**Overview:** The fastest and most compact model in the latest generation, optimized for low-latency applications.

---

## API Access & Authentication

**Endpoint:** `https://api.anthropic.com/v1/messages`[1]

**Authentication:** Use the `x-api-key` header with your API key[1]

**SDK Installation:**
```bash
pip install -U "anthropic"
```

```bash
npm install @anthropic-ai/sdk
```

**Python Example:**
```python
from anthropic import Anthropic

client = Anthropic(api_key="YOUR_API_KEY")

message = client.messages.create(
    model="claude-opus-4-5-20251101",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "Your question here"}
    ]
)
```

**JavaScript Example:**
```javascript
const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

const message = await client.messages.create({
    model: "claude-opus-4-5-20251101",
    max_tokens: 1024,
    messages: [
        { role: "user", content: "Your question here" }
    ],
});
```

---

## Detailed Specifications: Limitations

The search results do not provide complete technical specifications for the following parameters and details:

- **Context window size** (standard and extended variants)
- **Max output tokens** per request
- **Current pricing per 1M tokens** for input/output/cache write operations
- **Temperature, top_p, top_k** parameter ranges and defaults
- **Extended thinking/thinking block** parameter specifications
- **Web search tool** availability status
- **PDF processing** capabilities

For comprehensive API documentation including these specifications, consult Anthropic's official API documentation directly, as the available search results do not contain this level of detail for the 4.5 generation models.

---

## Google

**Research Date:** 12/13/2025, 6:10:04 PM

The search results provide information about recent Gemini model releases, but they do **not contain the detailed technical specifications** you've requested (context window size, maxOutputTokens, pricing, parameter configurations, thinking parameters, or grounding configuration details).

## Newest Gemini Models Identified (December 2025)

Based on the latest releases:

**December 12, 2025**
- `gemini-2.5-flash-native-audio-preview-12-2025` - Native audio model for the Live API[1]

**December 11, 2025**
- **Gemini Deep Research Agent** (preview) - Based on Gemini 3 Pro, designed for autonomous multi-step research tasks[1][3]
- Interactions API launched in beta for unified model and agent interactions[1]

**December 10, 2025**
- `gemini-2.5-flash-tts-preview` - Optimized for low latency with enhanced expressivity[1]
- `gemini-2.5-pro-tts-preview` - Optimized for quality with enhanced expressivity[1]

**General Availability (GA) Models**
- `gemini-2.5-pro` - Stable GA version as of June 26, 2025[1]
- `gemini-2.5-flash` - GA version as of July 1, 2025[2]
- `gemini-2.0-flash-lite` - GA version as of February 25, 2025[1]

## Missing Information

The provided search results do not include:
- Context window specifications
- Max output tokens configuration
- Per-token pricing
- Specific parameter values (temperature ranges, topP, topK defaults)
- Thinking configuration parameters or levels
- Google Search grounding setup details

To obtain these technical specifications, you would need to consult the official Gemini API documentation or contact Google Cloud support directly.

---

## Perplexity

**Research Date:** 12/13/2025, 6:10:03 PM

I don't have the specific API details you've requested in the provided search results. The search results focus primarily on Google's Gemini 3 and OpenAI's GPT-5.2 releases, with only a passing mention of Perplexity's Comet browser but no information about Perplexity's Sonar model line or their API specifications.

To provide you with **exact** API parameter names, current pricing structures, context windows, and model IDs for Perplexity's models (sonar, sonar-pro, sonar-reasoning, sonar-reasoning-pro, and any others), I would need search results that specifically document Perplexity's current API documentation or recent announcements about their model releases as of December 2025.

The information you're looking for—including specific details like:
- Exact model IDs and their current availability
- Context window and output token limits
- Current pricing per 1M tokens and per search context size
- Parameter ranges and valid values
- Specific endpoint authentication requirements

—is not available in the provided search results. I recommend checking Perplexity's official API documentation directly or their developer portal for the most current and accurate specifications for their production models.

---

# External APIs

## TomTom

**Research Date:** 12/13/2025, 6:10:04 PM

The specific technical documentation for TomTom's Traffic APIs—including exact endpoint URLs, authentication parameter names, rate limits, pricing tiers, and response JSON structures—is not available in the provided search results.

What the search results do confirm is that TomTom provides traffic data services that are actively being used by mapping platforms. Specifically:

**Current TomTom Traffic Services Mentioned:**

- **Traffic data integration**: TomTom APIs are referenced as being used for traffic density, speed data, and real-time traffic information[3]
- **Routing with traffic influence**: Stadia Maps is offering traffic-influenced routing powered by TomTom data, with the note that integrating this requires only "a single profile parameter change" for existing routing API users[2]
- **Travel time matrices**: CARTO has integrated TomTom APIs (alongside TravelTime) for computing travel time and distance origin-destination matrices through their Analytics Toolbox, Workflows, and Location Data Services API[1]

However, the search results do not contain the detailed API specifications you've requested, such as:
- Full endpoint URL patterns
- Specific authentication parameter names (beyond generic "API key" concepts)
- Exact key parameters and their values
- Response JSON structure examples
- Rate limiting specifications
- Detailed pricing models

For this technical information, you would need to consult TomTom's official developer documentation or contact their sales team directly.

---

## Google Maps

**Research Date:** 12/13/2025, 6:10:07 PM

The detailed technical specifications you're requesting—including exact endpoints, authentication parameters, pricing structures, and quota limits—are not available in the provided search results. However, I can share what recent developments have been announced for Google Maps Platform.

## Recent Google Maps Platform Announcements (2025)

**AI and Intelligence Features**

Google Maps Platform has introduced several AI-powered capabilities that are relevant for rideshare applications. As of September 2025, AI-powered summaries for places, areas, and reviews became Generally Available, enabling your rideshare app to provide contextual information about pickup and dropoff locations.[4] In November 2025, Google announced the Contextual View in Google Maps AI Kit, which allows you to bring AI chat experiences to life with interactive map experiences.[4]

**Navigation and Routing**

The Navigation SDK for Android and iOS remains a core offering for in-app navigation, with recent updates including road-level details in the Maps Javascript API and Navigation SDKs as of March 2025.[4] This is essential for turn-by-turn navigation in rideshare applications.

**Data and Insights**

Places Insights in BigQuery became Generally Available in September 2025, providing real-world data for location analysis and market research.[4] Roads Management Insights, launched in August 2025, offers data for building safer and more efficient road networks—useful for optimizing driver routes and understanding traffic patterns.[4]

## Core APIs for Rideshare Applications

For rideshare applications, you typically need:

- **Routes API** - for distance calculations, directions, and traffic-aware routing
- **Places API** - for location details, place information, and business data  
- **Geocoding API** - for converting addresses to coordinates and vice versa
- **Maps Javascript API / Navigation SDK** - for in-app map display and navigation

The search results indicate that Google Maps provides robust integration capabilities, with one developer noting successful implementation using "Google Maps API with geohashing for efficient provider-customer matching based on proximity and optimized route calculations."[2]

To obtain the specific endpoint URLs, parameter names, authentication requirements, pricing per 1,000 requests, and daily quota limits you've outlined, you'll need to consult the official Google Maps Platform documentation directly, as these technical specifications and their current rates are not provided in the available search results.

---

# Reference

## Parameter Constraints

> **IMPORTANT:** These are breaking changes that cause 400/401 errors if misconfigured.

The specific API parameter constraints and breaking changes you're requesting are not available in the provided search results. The search results focus on the feature announcements and benchmark performance of GPT-5.2, but do not include detailed API documentation covering:

- Exact valid parameter values (reasoning_effort, temperature ranges)
- max_completion_tokens vs max_tokens usage by specific model variants
- Message role specifications ("developer" vs "system")
- Anthropic's extended thinking and beta header requirements
- Google Gemini 3.0's thinkingConfig format specifications
- Perplexity Sonar search parameters and pricing impact

What the search results do confirm about GPT-5.2 is that it's available in three variants—Instant, Thinking, and Pro—with a knowledge cutoff of August 2025[5], but the technical API specifications required to answer your question about breaking changes and parameter constraints are not documented in these materials.

To obtain accurate, production-grade API parameter documentation with error codes and breaking changes, you would need to reference the official API documentation for each provider (OpenAI API documentation, Anthropic's API reference, Google's Gemini API docs, and Perplexity's API guides) directly, as these specifications are not included in the available search results.

---

## SDK Examples

I can only provide detailed code examples for **OpenAI GPT-5.2** based on the available search results, as they do not contain production API documentation or code examples for Anthropic Claude Opus 4.5, Google Gemini 3 Pro Preview, or Perplexity Sonar Pro.

## OpenAI GPT-5.2

Based on the search results, GPT-5.2 was announced on December 11, 2025[2]. The available API model identifiers are `gpt-5.2`, `gpt-5.2-chat-latest`, and `gpt-5.2-pro`[2]. The model supports a 400,000 token context window with 128,000 max output tokens[2]. However, the search results do not provide complete API parameter documentation for reasoning_effort, max_completion_tokens, or full SDK examples.

**What I can tell you from the search results:**

The search results mention that GPT-5.2 is available in "instant" and "thinking" modes, presumably corresponding to different reasoning effort levels in the API[2]. There's also a `/responses/compact` endpoint for long-running, tool-heavy workflows that handles response compaction[2].

**Limitation:** The search results provided do not contain the actual API parameter names, endpoint specifications, or working code examples with error handling for any of the four models you requested. To provide production-ready code examples with exact parameter names and current specifications, I would need access to:

- OpenAI's official GPT-5.2 API reference documentation
- Anthropic's Claude Opus 4.5 API documentation  
- Google's Gemini 3 Pro Preview API documentation
- Perplexity's Sonar Pro API documentation

I recommend consulting the official API documentation for each provider, as the search results don't contain sufficient detail to generate accurate, production-ready code examples with all required headers, parameters, and error handling.

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

*Auto-generated on 2025-12-13T18:10:21.389Z*
