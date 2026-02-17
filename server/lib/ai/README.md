> **Gemini Analysis (2026-02-16):**
> **Core Function:** This directory manages all AI interactions, enforcing the "Adapter Pattern" to decouple application logic from specific providers (OpenAI, Anthropic, Google, Vertex AI).
> **Key Architecture:** It houses the **TRIAD Pipeline** (Strategist -> Planner -> Validator), which orchestrates multi-model strategy generation.
> **Critical Rule:** Direct LLM API calls are forbidden here; all calls must route through `adapters/index.js` using semantic roles (e.g., `STRATEGY_CORE`).
> **Recent Updates:** Enforced strict `thinkingLevel` validation for Gemini 3 models (Pro vs. Flash), added SDK key conflict resolution, enabled multimodal image support (Vision), integrated **Vertex AI**, and implemented **Hedged Router** for cross-provider fallback and reliability.

> **Last Verified:** 2026-02-16

# AI Module (`server/lib/ai/`)

## Purpose

Centralized AI model management: adapters for different providers (Anthropic, OpenAI, Google, Vertex AI), strategy providers, and supporting utilities.

## Structure

ai/
├── adapters/           # Model API adapters (call these, not providers directly)
│   ├── anthropic-adapter.js # Anthropic adapter (Claude, Web Search)
│   ├── gemini-adapter.js    # Google GenAI adapter (Gemini 3, Vision, Thinking)
│   ├── openai-adapter.js    # OpenAI adapter (GPT-4o, O-series, Web Search)
│   ├── vertex-adapter.js    # Vertex AI adapter (Thinking, Search)
│   └── index.js             # Main dispatcher (Hedged Router): callModel(role, {system, user, messages, images})
├── router/             # Reliability layer
│   └── hedged-router.js     # Latency-hedged routing logic with fallback support
├── context/            # Shared context gathering logic (Agent, Assistant, Eidolon)
├── providers/          # Strategy generation providers
│   ├── briefing.js     # Events, traffic, news (Gemini + Search)
│   └── consolidator.js # Strategy generation (GPT-5.2