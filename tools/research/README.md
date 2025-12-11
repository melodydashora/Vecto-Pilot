# Research Tools (`tools/research/`)

## Purpose

AI model discovery and documentation generation tools.

## Files

| File | Purpose |
|------|---------|
| `model-discovery.mjs` | Discover available models from AI providers |
| `claude-model-search.mjs` | Search Anthropic's model catalog |
| `generate-model-md.mjs` | Generate MODEL.md from research data |
| `update-model-md.mjs` | Update MODEL.md with latest model info |

## Output Files

| File | Purpose |
|------|---------|
| `model-research-*.json` | Raw model discovery results |
| `claude-models-*.txt` | Claude model catalog snapshots |

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
