> **Gemini Analysis (2026-02-15):**
> **Core Function:** This directory manages all AI interactions, enforcing the "Adapter Pattern" to decouple application logic from specific providers (OpenAI, Anthropic, Google).
> **Key Architecture:** It houses the **TRIAD Pipeline** (Strategist -> Planner -> Validator), which orchestrates multi-model strategy generation.
> **Critical Rule:** Direct LLM API calls are forbidden here; all calls must route through `adapters/index.js` using semantic roles (e.g., `STRATEGY_CORE`).
> **Recent Updates:** Enforced strict `thinkingLevel` validation for Gemini 3 models (Pro vs. Flash) and added SDK key conflict resolution.

> **Last Verified:** 2026-02-15

# AI Module (`server/lib/ai/`)

## Purpose

Centralized AI model management: adapters for different providers (Anthropic, OpenAI, Google), strategy providers, and supporting utilities.

## Structure


ai/
├── adapters/           # Model API adapters (call these, not providers directly)
│   └── index.js        # Main dispatcher: callModel(role, {system, user})
├── context/            # Shared context gathering logic (Agent, Assistant, Eidolon)
├── providers/          # Strategy generation providers
│   ├── briefing.js     # Events, traffic, news (Gemini + Search)
│   └── consolidator.js # Strategy generation (GPT-5.2