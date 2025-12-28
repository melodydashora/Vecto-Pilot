# AI Model Reference Guide

> **Last Updated:** December 27, 2025
> **Research Tool:** Perplexity Sonar Reasoning Pro
> **Total Citations:** 67

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

**Research Date:** 12/27/2025, 11:35:46 PM

Based on the search results provided, I can identify OpenAI's latest models released by December 27, 2025, but the search results **do not contain the specific technical specifications you requested** (context windows, max output tokens, exact pricing, parameter details, or role information).

## Latest Flagship Models Available

**GPT-5.2** – Released December 11, 2025[1][3]
The most capable model series for professional knowledge work, with improved reasoning and factuality. Available to ChatGPT Plus, Pro, Team, Free, and Enterprise users via API with the identifier `gpt-5.2`[2]. Also includes a "Thinking" variant for deeper reasoning work[1].

**GPT-5.2-Codex** – Released December 18, 2025[1][2]
The most advanced agentic coding model with native context compaction, improved large refactors and migrations, enhanced Windows performance, and stronger cybersecurity capabilities. Available to paid Codex users; API access was planned to roll out in the weeks following release[1].

**GPT Image 1.5** – Released December 17, 2025[4]
Delivers 4× faster image generation with 20% reduced API costs compared to its predecessor[4].

## O-Series Reasoning Models

The search results mention **o3 and o4-mini** are available in ChatGPT's model picker[3], but provide no additional details about availability, specifications, or release dates.

## Missing Information

The search results do not include: context window sizes, max output tokens, exact API pricing per token, `max_completion_tokens` parameter values, `reasoning_effort` options, or clarification on "developer" vs "system" roles. For these specifications, you would need to consult OpenAI's official API documentation directly.

---

## Anthropic

**Research Date:** 12/27/2025, 11:35:39 PM

Based on the search results available, I can confirm the latest Claude models, but the sources provide limited API specification details.

## Latest Claude Models Available (December 2025)

The newest models confirmed as currently available are:

**Claude Opus 4.5** — API identifier: `claude-opus-4-5-20251101`[2]

**Claude Sonnet 4.5** — Referenced as available but without a specific snapshot date in the search results[2][5]

**Claude Haiku** — The Haiku line is available but search results show `claude-3-5-haiku@20241022` as an example identifier[4]

## Information Limitations

The search results confirm these models are production-available and describe their strategic positioning (Opus 4.5 specializes in "reasoning-first" capabilities for coding[6]), but they **do not include**:

- Exact context window sizes for each model tier
- Maximum output token limits
- Current pricing per 1M tokens
- Specific parameter ranges (temperature, top_p, top_k values)
- Extended thinking/reasoning configuration parameters
- Web search tool availability
- Complete capability matrices (vision, function calling, PDF handling, computer use)

The search results mention a **200k context window** advantage[1] attributed to Claude models generally, but don't specify which versions include this or if it varies by tier.

For complete and current API specifications, you would need to consult Anthropic's official documentation directly, as the search results provided focus primarily on product announcements and developer migration trends rather than detailed technical API documentation.

---

## Google

**Research Date:** 12/27/2025, 11:35:42 PM

Based on the search results, the **newest Gemini model available via API as of December 27, 2025 is Gemini 3 Flash**, released on December 17, 2025[1][2].

## Gemini 3 Flash

**Pricing:**
- Input: **$0.50 per million tokens**[2]
- Output: **$3 per million tokens**[2]

**Capabilities:**
Gemini 3 Flash combines Pro-grade reasoning with Flash-level speed, matching Gemini 3 Pro on many benchmarks while being 3x faster[2]. It uses 30% fewer tokens than 2.5 Pro on average while delivering higher performance[2].

**Limitations of Available Information:**

The search results do not provide the following technical specifications you requested:
- Exact model ID strings for API calls
- Context window size
- Max output tokens (maxOutputTokens)
- Parameter details (temperature, topP, topK values)
- Thinking parameters (thinkingConfig, thinkingLevel specifications)
- Google Search grounding configuration details

The search results confirm Gemini 3 Flash is now the default model in the Gemini app and AI Mode in Google Search globally[2], but do not include the detailed API parameter documentation needed for production implementation. You would need to consult Google's official API documentation at Google AI Studio or Vertex AI to access the complete technical specifications and model ID strings required for your API integration.

---

## Perplexity

**Research Date:** 12/27/2025, 11:35:41 PM

Based on the provided search results, I can identify some of Perplexity's current models, but the search results do not contain comprehensive details for all the specifications you've requested.

## Available Information from Search Results

**Confirmed Current Models:**

Perplexity's core online models are **pplx-7b-online** and **pplx-70b-online**, based on open-source foundations Mistral-7B and LLaMA2-70B respectively[2]. The search results also reference **Sonar** and **Sonar Pro** models in pricing discussions[3].

**API Details:**

The platform exposes an **OpenAI-compatible HTTP API** using the chat/completions endpoint style[5], allowing integration via standard OpenAI SDKs with a custom base_url.

**Pricing Structure:**

Perplexity operates on a **pay-as-you-go credit system** based on token usage and search depth rather than flat monthly rates[3]. Search mode cost multipliers apply:
- **Low Mode**: Maximum cost efficiency for straightforward queries
- **Medium Mode**: Balanced approach with moderate token consumption  
- **High Mode**: Maximum depth research with highest token consumption[3]

**Capabilities:**

Perplexity AI supports **multi-turn conversational queries**, **real-time web synthesis**, **citations**, and **multi-modal integration** planned for 2026[1][2].

## Information Not in Search Results

The search results do not contain the specific technical parameters you requested, including exact context window sizes, max output tokens, per-1M token pricing, parameter ranges (temperature, top_p), search recency filter values, or details about sonar-reasoning, sonar-reasoning-pro, or sonar-deep-research models. To obtain these current specifications, you would need to consult Perplexity's official API documentation directly.

---

# External APIs

## TomTom

**Research Date:** 12/27/2025, 11:35:39 PM

The provided search results do not contain detailed specifications for TomTom's current Traffic APIs, including the specific endpoints, authentication parameters, response formats, rate limits, and pricing you've requested.

The search results confirm that **TomTom offers APIs for tracking and logistics** including geofencing, location history tracking, and notifications management[1], and they mention **Map Display API** with raster and vector tiles[2]. However, the results don't include documentation for dedicated Traffic Flow, Traffic Incidents, Traffic Tiles, or detailed Route Planning APIs with the technical specifications you need.

To obtain the current technical details for TomTom's Traffic APIs as of December 2025, you would need to:

- **Access TomTom's official API documentation** directly at their developer portal
- **Review the API reference sections** for endpoint patterns, parameter specifications, and authentication requirements
- **Check the pricing page** for current rate limits and cost structures, as API pricing and features frequently update

The search results indicate that TomTom provides flexible endpoint options (synchronous and asynchronous), supports multiple pricing tiers (free evaluation, pay-as-you-grow, and enterprise)[1], and offers API documentation through their developer resources[2], but the specific technical parameters and endpoints you're seeking are not included in these results.

For authoritative, up-to-date information on API endpoints, request/response formats, and rate limiting, consulting TomTom's live developer documentation would be essential.

---

## Google Maps

**Research Date:** 12/27/2025, 11:35:39 PM

The search results provided do not contain the specific technical specifications you've requested for Google Maps Platform APIs. The search results discuss rideshare app development and mention that services like Google Maps are integrated for navigation and routing[1][2][5], but they do not include API endpoint URLs, authentication parameters, pricing details, daily quotas, or information about the Places API new vs. legacy versions.

To obtain the accurate, production-ready API specifications you need for rideshare development as of December 2025, I recommend consulting:

- **Google Maps Platform official documentation** - The authoritative source for current API endpoints, parameter names, authentication methods, and pricing models
- **Google Cloud Console** - For real-time quota limits and usage tracking specific to your project
- **API Release Notes** - For any 2025 updates to Places API, Routes API, Geocoding API, and other services

This approach is essential because:

- API endpoints and parameter specifications can change with platform updates
- Pricing models and quota limits are subject to change and vary by account tier
- The distinction between legacy and new Places API versions requires current documentation to avoid deprecated implementations
- Accurate pricing information is critical for project budgeting

If you have access to Google Cloud documentation or specific API details from your development environment, I'd be happy to help interpret them or answer questions about how these APIs integrate into rideshare architectures based on that information.

---

# Reference

## Parameter Constraints

> **IMPORTANT:** These are breaking changes that cause 400/401 errors if misconfigured.

The search results provided do not contain the specific API parameter constraints, breaking changes, or endpoint configurations you're requesting.

The available information covers **general capabilities** of recent models—such as GPT-5.2's three-tier architecture (Instant, Thinking, Pro), a 400,000-token context window, and an August 2025 knowledge cutoff[1][5]—but does not include:

- Exact parameter names (e.g., `max_completion_tokens` vs `max_tokens`) or their valid values
- Specific `reasoning_effort` settings for GPT-5 models
- Temperature support status across model variants
- Developer role vs system role specifications
- Anthropic Claude 4.5 extended thinking configurations or beta headers
- Google Gemini 3.0's `thinkingConfig` format or deprecation status
- Perplexity Sonar search parameters and pricing implications
- Confirmed 400/401 error conditions for any platform

To obtain this information, you would need to consult:
- OpenAI's official API documentation and release notes
- Anthropic's API reference for Claude models
- Google's Gemini API documentation
- Perplexity's developer guides

These sources would provide the authoritative, current parameter specifications and breaking changes necessary for production API integration.

---

## SDK Examples

I cannot provide the comprehensive production-ready code examples you've requested based on the available search results. The search results contain insufficient technical detail for the API implementations you need.

**What the search results confirm:**

GPT-5.2 was released in December 2025[4] with a specialized **GPT-5.2-Codex** variant optimized for agentic coding, released December 18[1][2]. The results mention that GPT-5.2 supports **reasoning_effort** parameters and use of a **CTCO Framework** (Context → Task → Constraints → Output) for prompting[3], but do not provide:

- Specific API endpoint URLs
- Exact authentication header formats
- Complete parameter specifications and their valid values
- Working code examples with error handling
- SDK initialization syntax for production use

**Critical gaps in the search results:**

The results provide no information about Claude Opus 4.5 API specifications, Google Gemini 3 Pro Preview details, or Perplexity Sonar Pro endpoints. While the search results mention GPT-5.2-Codex API access is "coming soon"[1][5], they don't provide the actual API interface details needed for functional code examples.

**Recommendation:**

To obtain production-ready code examples with accurate parameter names, endpoints, and authentication requirements, you should consult:

- The official OpenAI API documentation for GPT-5.2's current status and endpoint details
- Current SDK documentation for each provider
- The latest developer release notes for December 2025

This ensures your code uses the correct, current API specifications rather than potentially outdated information.

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

*Auto-generated on 2025-12-28T01:03:51.397Z*
