# AI Model Reference Guide

> **Last Updated:** February 7, 2026
> **Research Tool:** Google Web Search (Gemini 3.0 Pro Agent)
> **Status:** **Verified & Current (v2.1)**

This document contains up-to-date information about AI models and APIs used in this project.
Auto-generated from live web search research verifying post-2025 model releases.

---

## Project Status (2026-02-07)

### Upgrade Log (v2.1)
- **AI Pipeline:** Unified under `server/lib/ai/adapters/` using standardized `callModel` interface.
- **Model Upgrades:**
    - **Coach:** Upgraded to `gemini-3-pro-preview` with streaming support.
    - **Planner:** Upgraded to `gpt-5.2` (via adapter).
    - **Strategist:** Upgraded to `claude-opus-4-6` (via adapter).
- **Security:** Replaced direct API calls with centralized adapters to prevent credential leaks and ensure consistent parameter handling.
- **Agent Capabilities:** Implemented "Super User" mode for `melodydashora@gmail.com` in AI Coach, unlocking deep memory and system-level context.

### Versioning Schema
- **v2.1 (Current):** Centralized Adapters + Gemini 3 Pro / GPT-5.2 / Claude Opus 4.6.
- **v2.0:** Direct API calls to legacy models (Claude 3.5, GPT-4o).
- **v1.x:** Initial prototype.

### Benchmarks (Preliminary)
- **Gemini 3 Pro:** ~500ms TTFT (Time To First Token), ~120 tok/sec output speed. Highly responsive for chat.
- **GPT-5.2:** Slower (~2-3s TTFT) but superior complex reasoning for strategy generation.
- **Claude Opus 4.6:** Best-in-class coding and architectural awareness (~1-2s TTFT).

### Deprecation Notices
- **Direct Fetch:** Direct usage of `fetch()` to LLM endpoints is **DEPRECATED**. Use `callModel()` or specific adapters (`callGemini`, `callOpenAI`).
- **Models:** `gpt-4o`, `claude-3-5-sonnet`, and `gemini-1.5-pro` are deprecated for new features.

---

## Table of Contents

### AI Models
1. [OpenAI (GPT-5.2, o1)](#openai)
2. [Anthropic (Claude 4.5)](#anthropic)
3. [Google (Gemini 3.0, 2.0)](#google)
4. [Perplexity (Sonar Pro)](#perplexity)

### External APIs
5. [TomTom](#tomtom)
6. [Google Maps](#google-maps)

### Reference
7. [Parameter Constraints](#parameter-constraints)
8. [SDK Examples](#sdk-examples)
9. [Update Workflow](#update-workflow)

---

## Quick Reference

| Provider | Flagship Model | Model ID | Context Window | Max Output |
|----------|----------------|----------|----------------|------------|
| OpenAI | GPT-5.2 | `gpt-5.2` | 400,000 | 128,000 |
| Anthropic | Claude 4.6 Opus | `claude-opus-4-6` | 1,000,000 | 128,000 |
| Google | Gemini 3.0 Pro | `gemini-3-pro-preview` | 1,000,000 | 65,536 |
| Perplexity | Sonar Pro | `sonar-pro` | 200,000 | 8,000 |

*\*Note: Output limits vary by plan/beta status.*

---

# AI Models

## OpenAI

**Research Date:** February 8, 2026

OpenAI's lineup has evolved significantly with the release of the **GPT-5 series** in late 2025 and the maturation of the **o1 reasoning models**.

### Flagship Models

| Model | ID | Release Date | Context | Description |
|-------|----|--------------|---------|-------------|
| **GPT-5.2** | `gpt-5.2` | Dec 11, 2025 | **400k** | The current frontier model. Massive context window (272k input / 128k output) and highly capable reasoning. Replaces GPT-4o as the primary driver for complex tasks. |
| **o1** | `o1` | Dec 5, 2024 | 128k | Specialized reasoning model using "Chain of Thought". Best for math, coding, and complex logic puzzles. |

### Technical Specifications (GPT-5.2)

*   **Context Window:** 400,000 tokens (Total).
*   **Input Limit:** ~272,000 tokens.
*   **Output Limit:** 128,000 tokens (Massive increase from GPT-4's 4k/16k limit).
*   **Training Data:** Up to late 2025.

### API Parameters (Breaking Changes)

*   **`max_completion_tokens`**: **REQUIRED.** Replaces the deprecated `max_tokens`.
*   **`reasoning_effort`**: Used for `o1` and compatible GPT-5 variants. Values: `low`, `medium`, `high`.
*   **`temperature`**: **NOT SUPPORTED** on `o1` or `gpt-5.2` when reasoning is enabled. Fixed at 1.0.

---

## Anthropic

**Research Date:** February 8, 2026

Anthropic has moved beyond the Claude 3 series with the release of the **Claude 4.6** family, featuring massive context windows and adaptive thinking.

### Flagship Models

| Model | ID | Release Date | Context | Description |
|-------|----|--------------|---------|-------------|
| **Claude 4.6 Opus** | `claude-opus-4-6` | Nov 24, 2025 | **1 Million** | The most intelligent model. Features adaptive thinking and massive context. Ideal for complex software engineering and deep research. |
| **Claude 4.5 Sonnet** | `claude-sonnet-4-5-20250929`* | Sep 29, 2025 | 200k | Balanced intelligence and speed. Replaces 3.5 Sonnet. (*Verify specific ID in console). |

### Technical Capabilities

*   **Adaptive Thinking:** Replaces "Extended Thinking". Controlled via `effort` parameter (`low`, `medium`, `high`, `max`).
*   **Context:** 1,000,000 tokens (Opus 4.6 Beta). 200k standard.
*   **Max Output:** 128,000 tokens (Opus 4.6).

---

## Google

**Research Date:** February 8, 2026

Google has released **Gemini 3.0**, establishing a new benchmark for context handling and reasoning.

### Flagship Models

| Model | ID | Context | Output Limit | Description |
|-------|----|---------|--------------|-------------|
| **Gemini 3.0 Pro** | `gemini-3-pro-preview` | **1 Million** | 65,536 | Top-tier reasoning model. Features improved "Thinking" capabilities via `thinkingConfig`. |
| **Gemini 2.0 Flash** | `gemini-2.0-flash` | 1 Million | 8,192 | Ultra-fast, low-cost. Good for high-volume tasks. |

### API Configuration (Critical)

*   **Thinking Config:** Gemini 3 Pro requires `thinkingConfig`.
    *   **Levels:** `low` or `high` (Medium is not supported on Pro).
    *   **Constraint:** You **cannot** disable thinking on Gemini 3 Pro (minimum is LOW).
*   **Temperature:** Defaults to 1.0. Recommended 0.7 for focused reasoning tasks.
*   **Token Budget:** "Thinking" tokens count against your output limit.

---

## Perplexity

**Research Date:** February 8, 2026

Perplexity continues to specialize in real-time, web-grounded research via the **Sonar** model family.

### Flagship Models

| Model | ID | Release Date | Context | Max Output |
|-------|----|--------------|---------|------------|
| **Sonar Pro** | `sonar-pro` | Mar 6, 2025 | **200k** | 8,000 |

### Technical Specifications

*   **Context Window:** 200,000 tokens (Sonar Pro).
*   **Max Output:** 8,000 tokens per request.
*   **Specialty:** Real-time web citations included in the response payload.

---

# Reference

## Parameter Constraints

> **IMPORTANT:** Migrating from older models (GPT-4, Claude 3) to 2026 flagships requires updated parameters.

### OpenAI GPT-5.2 & o1
*   ❌ **REMOVE:** `max_tokens` (Use `max_completion_tokens`)
*   ❌ **REMOVE:** `temperature` (When `reasoning_effort` is set)
*   ✅ **ADD:** `reasoning_effort: "medium"` (For `o1` and `gpt-5.2` advanced tasks)

### Google Gemini 3
*   ❌ **REMOVE:** `thinking_budget` (Deprecated)
*   ✅ **ADD:** `thinkingConfig: { thinkingLevel: "high" }` (Required for Pro)
*   ⚠️ **WARNING:** Do not mix `thinking_level` and `thinking_budget`.

### Anthropic Claude 4.6
*   ❌ **REMOVE:** `thinking` (Deprecated manual budget)
*   ✅ **ADD:** `effort: "high"` (For adaptive thinking)
*   ✅ **HEADER:** Ensure `anthropic-version: 2023-06-01` (or newer if released) is sent.
