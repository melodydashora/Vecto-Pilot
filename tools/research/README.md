# Research Tools (`tools/research/`)

## Purpose

AI model discovery, comparison, and documentation generation tools.

## Files

| File | Purpose |
|------|---------|
| `event-model-comparison.mjs` | **Event Discovery** - Compare AI models for event search |
| `model-discovery.mjs` | Discover available models from AI providers |
| `claude-model-search.mjs` | Search Anthropic's model catalog |
| `generate-model-md.mjs` | Generate MODEL.md from research data |
| `update-model-md.mjs` | Update MODEL.md with latest model info |

## Output Files

| File | Purpose |
|------|---------|
| `model-research-*.json` | Raw model discovery results |
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

### Discover All Models

```bash
node tools/research/model-discovery.mjs
```

Queries OpenAI, Anthropic, and Google for available models.

### Search Claude Models

```bash
node tools/research/claude-model-search.mjs
```

### Generate MODEL.md

```bash
node tools/research/generate-model-md.mjs
```

Creates `MODEL.md` from the latest research JSON.

## When to Run

- After AI provider announces new models
- When updating model configurations
- To verify model availability
