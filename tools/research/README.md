> **Last Verified:** 2026-01-06

# Research Tools (`tools/research/`)

## Purpose

AI model discovery, comparison, and documentation generation tools.

## Script Files

| File | Purpose |
|------|---------|
| `event-model-comparison.mjs` | **Event Discovery** - Compare AI models for event search |
| `parse-flagship-json.mjs` | Parse flagship model JSON data |
| `perplexity-flagship-search.mjs` | Search for flagship models via Perplexity |

## Output Files

| File | Purpose |
|------|---------|
| `model-research-*.json` | Raw model discovery results |
| `flagship-models-*.json` | Flagship model data snapshots |
| `claude-models-*.txt` | Claude model catalog snapshots |

## Event Model Comparison

Compare 8 AI models for event discovery performance:

```bash
node tools/research/event-model-comparison.mjs
```

**Models Tested:**
1. SerpAPI (Google Events engine)
2. GPT-5.2 (OpenAI Responses API)
3. Gemini 3 Pro (Google Search grounding)
4. Gemini 2.5 Pro (Google Search grounding)
5. Claude Sonnet (web_search_20250305)
6. Perplexity Sonar Pro
7. Perplexity Reasoning Pro
8. TomTom Events API

**Output:** JSON with events found, timing, and events/second for each model.

See [Event Discovery Architecture](../../docs/architecture/event-discovery.md) for the production implementation.

## Usage

### Event Model Comparison

```bash
node tools/research/event-model-comparison.mjs
```

Compares multiple AI providers for event discovery.

### Parse Flagship Models

```bash
node tools/research/parse-flagship-json.mjs
```

### Search Flagship Models

```bash
node tools/research/perplexity-flagship-search.mjs
```

## When to Run

- After AI provider announces new models
- When updating model configurations
- To verify model availability
