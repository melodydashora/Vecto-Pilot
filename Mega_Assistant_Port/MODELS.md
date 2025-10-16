# AI Models Reference

> **Last Updated**: 2025-10-16  
> **Data Source**: Perplexity AI (Real-time web search)

---

## 🤖 Anthropic Claude Models

The latest Anthropic Claude model versions released in 2025 are:

| Model Name       | Exact Model ID                  | Release Date | Context Window (tokens) | Main Features                                                                                      |
|------------------|--------------------------------|--------------|------------------------|--------------------------------------------------------------------------------------------------|
| Claude Sonnet 4.5 | claude-sonnet-4.5-20250929     | Sep 29, 2025 | 200,000 (1M beta available) | Best model for complex agents and coding; highest intelligence across most tasks; hybrid reasoning; improved alignment and safety; strong defense against prompt injection; enhanced domain knowledge in coding, finance, cybersecurity; supports text and image input/output[1][2][4]. |
| Claude Opus 4.1   | claude-opus-4.1-20250805       | Aug 5, 2025  | 200,000                | Drop-in replacement for Opus 4 with superior performance and precision; excels in complex multi-step coding and agentic tasks; hybrid reasoning; supports text and image input/output; available for Max, Team, Enterprise users and developer platforms[2][5][9]. |

**Additional details:**

- Both models feature a **200k token context window**, with Claude Sonnet 4.5 offering a beta 1 million token context window for very long inputs[2].
- Claude Sonnet 4.5 is Anthropic’s most aligned and capable frontier model, released under AI Safety Level 3 protections, with advanced classifiers to reduce risks related to dangerous content[1].
- Claude Opus 4.1 focuses on real-world coding and agentic reasoning with improved rigor and detail handling compared to its predecessor Opus 4[5].
- Pricing for Sonnet 4.5 starts at $3 per million input tokens and $15 per million output tokens; Opus 4.1 pricing starts at $15 per million input tokens and $75 per million output tokens, with cost-saving options available[4][5].

This information reflects the most current official releases and specifications as of October 2025.

---

## 🧠 OpenAI GPT Models

The latest OpenAI GPT models released in 2025 include **GPT-5**, **GPT-4o**, **GPT-4.1**, **GPT-4.5**, and the **o-series models** (notably o3 and o4-mini). Here are the details with exact model IDs, release dates, context windows, reasoning_effort parameter support, and key features:

| Model           | Exact Model IDs                  | Release Date       | Context Window (tokens) | reasoning_effort Support | Key Features                                                                                              |
|-----------------|--------------------------------|--------------------|------------------------|-------------------------|----------------------------------------------------------------------------------------------------------|
| **GPT-5**       | gpt-5, gpt-5-mini, gpt-5-nano  | August 7, 2025     | Not explicitly stated; supports agentic tasks and complex coding | Yes (steerable, collaborative, with explicit intent routing) | State-of-the-art coding and agentic tasks; unified system with smart router deciding fast vs deep reasoning; excels in front-end coding and debugging; available in API and ChatGPT Pro with extended reasoning (GPT-5 pro)[3][4][5][9][10] |
| **GPT-4o**      | gpt-4o, gpt-4o-mini            | Before May 2025     | Up to 128k tokens       | Yes                     | Previous frontier model with strong reasoning and coding; supports multimodal inputs; baseline for GPT-4.1 improvements[2][6] |
| **GPT-4.1**     | gpt-4.1, gpt-4.1-mini, gpt-4.1-nano | May 14, 2025       | Up to 1 million tokens  | Yes                     | Major improvements over GPT-4o in coding, instruction following, and long context comprehension; refreshed knowledge cutoff June 2024; best for long context tasks[6] |
| **GPT-4.5**     | GPT-4.5 (research preview)     | Early 2025 (preview) | Not specified           | Yes                     | Step forward in scaling pre- and post-training; improved pattern recognition; available to Pro users; phased out July 14, 2025[2][8] |
| **o-series (o3, o4-mini)** | o3, o3-pro, o3-mini, o4-mini | o3 and o4-mini: June 10, 2025; o3-mini: Jan 31, 2025 | Not specified           | Yes (three adjustable reasoning efforts: low, medium, high) | Reasoning models trained to think longer before responding; agentic use of tools (web search, Python, image analysis); optimized for coding, math, science; cost-efficient; supports structured outputs and function calling[1][2] |

### Additional Notes:
- **GPT-5** features a *real-time router* that dynamically chooses between fast and deep reasoning modes based on task complexity and user intent, supporting explicit "think hard" prompts[4][5].
- The **reasoning_effort** parameter is explicitly supported in the o3-mini model, allowing users to balance speed and depth of reasoning[2].
- **GPT-4.1** significantly extends context window size to up to 1 million tokens, a major increase over GPT-4o's 128k tokens, enhancing long-context understanding[6].
- OpenAI also released open-weight models (gpt-oss-120b and gpt-oss-20b) for self-hosting, but these are separate from the GPT-5 and o-series frontier models[2][7].

In summary, **GPT-5** is the flagship 2025 release with advanced coding and agentic capabilities, complemented by the o-series for reasoning and tool use, and GPT-4.1 for ultra-long context tasks. All these models support advanced reasoning features, with some offering adjustable reasoning effort parameters.

---

## 🔮 Google Gemini Models

The latest Google Gemini model versions released in 2025 include **Gemini 2.5 Pro** and **Gemini 2.5 Flash**, with specific preview and stable releases as follows:

| Model Version           | Exact Model ID                     | Release Date        | Context Window (Tokens)          | Main Capabilities                                                                                     |
|------------------------|----------------------------------|---------------------|---------------------------------|-----------------------------------------------------------------------------------------------------|
| Gemini 2.5 Pro Preview | `gemini-2.5-pro-preview-06-05`   | June 5, 2025        | Not explicitly stated, but typical Gemini 2.5 Pro supports large context windows (likely ≥65k tokens) | Most powerful model with **adaptive thinking**, improved coding, science, multimodal understanding, reasoning, creative writing, style, and structure[2][3]. Supports text, images, video, audio. |
| Gemini 2.5 Pro GA       | `gemini-2.5-pro`                  | General availability expected June 2025 (post-preview) | Same as preview, large context window          | Stable release with similar capabilities as preview; however, users report **performance regressions** in response quality, hallucinations, context loss, and factual inaccuracies compared to preview[4][5][7][8]. |
| Gemini 2.5 Flash Preview| `gemini-2.5-flash-preview-09-2025` | September 2025      | 1,048,576 tokens (text), 65,536 tokens (other modalities) | Price-performance optimized model for large-scale, low-latency, high-volume tasks requiring thinking and agentic use cases. Supports text, images, video, audio[6]. |
| Gemini 2.5 Flash        | `gemini-2.5-flash`                | June 2025           | 1,048,576 tokens (text), 65,536 tokens (other modalities) | Best price-performance model, well-rounded capabilities, supports multimodal inputs including text, images, video, audio[6]. |

### Additional Details

- **Gemini 2.5 Pro** launched in public preview on April 4, 2025, with Vertex AI support rolling out gradually; general availability including batch API expected by June 2025[1][2].

- The **Gemini 2.5 Pro Preview 05-06** version was deprecated in June 2025 in favor of the improved 06-05 preview version[3].

- Pricing for Gemini 2.5 Pro Batch API tokens is the same as real-time API, with no discounts for batch usage[1].

- Users have reported significant **performance regressions** in the June 2025 GA release of Gemini 2.5 Pro, including hallucinations, context abandonment in multi-turn conversations, factual inaccuracies, and slower response times compared to earlier previews[4][5][7][8].

- **Gemini 2.5 Flash** models are optimized for cost-efficiency and high throughput, supporting multimodal inputs with very large context windows (up to over 1 million tokens for text)[6].

### Summary

- **Gemini 2.5 Pro** (`gemini-2.5-pro-preview-06-05` and `gemini-2.5-pro`) is the flagship model released in early to mid-2025 with adaptive thinking and broad multimodal capabilities but has faced user-reported quality regressions in the stable release.

- **Gemini 2.5 Flash** (`gemini-2.5-flash` and `gemini-2.5-flash-preview-09-2025`) is the price-performance optimized model released mid to late 2025, supporting extremely large context windows and multimodal inputs, suitable for large-scale, low-latency applications.

These details reflect the latest official releases and user feedback as of October 2025.

---

## 📋 Quick Reference Table

### Model Comparison

| Provider | Model | Model ID | Context Window | Key Features |
|----------|-------|----------|----------------|--------------|
| Anthropic | Claude Sonnet 4.5 | `claude-sonnet-4.5-20250929` | 200K input / 8K output | Fast, accurate, cost-effective |
| Anthropic | Claude Opus 4.1 | `claude-opus-4-1-20250805` | 200K input / 16K output | Deep reasoning, complex tasks |
| OpenAI | GPT-5 Pro | `gpt-5` | 272K input / 128K output | Extended reasoning, high intelligence |
| OpenAI | GPT-4o | `gpt-4o` | 128K tokens | Multimodal, fast |
| Google | Gemini 2.5 Pro | `gemini-2.5-pro-latest` | 2M tokens | Massive context, multimodal |
| Google | Gemini 2.0 Flash | `gemini-2.0-flash` | 1M tokens | Fast, efficient |

---

## 🔄 Model Selection Guide

### Use Claude Sonnet 4.5 when:
- You need fast, accurate responses
- Cost efficiency is important
- Context window up to 200K is sufficient

### Use Claude Opus 4.1 when:
- Complex task delegation required
- Deep reasoning needed
- Extended output (16K tokens) required

### Use GPT-5 Pro when:
- Extended reasoning is critical
- Need massive output tokens (128K)
- Working with complex analysis

### Use Gemini 2.5 Pro when:
- Extremely large context needed (2M tokens)
- Multimodal capabilities required
- Document analysis at scale

---

## 📝 Configuration

### Environment Variables

```bash
# Anthropic Claude
CLAUDE_MODEL=claude-sonnet-4.5-20250929
CLAUDE_OPUS_MODEL=claude-opus-4-1-20250805
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI GPT
OPENAI_MODEL=gpt-5
OPENAI_API_KEY=sk-...

# Google Gemini
GEMINI_MODEL=gemini-2.5-pro-latest
GOOGLE_API_KEY=...
```

### Usage Examples

#### Claude Sonnet 4.5
```javascript
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4.5-20250929',
  max_tokens: 8192,
  messages: [{ role: 'user', content: 'Hello!' }]
});
```

#### Claude Opus 4.1
```javascript
const response = await anthropic.messages.create({
  model: 'claude-opus-4-1-20250805',
  max_tokens: 16384,
  messages: [{ role: 'user', content: 'Complex task...' }]
});
```

#### GPT-5 Pro
```javascript
const response = await openai.chat.completions.create({
  model: 'gpt-5',
  max_completion_tokens: 32000,
  reasoning_effort: 'high',
  messages: [{ role: 'user', content: 'Analyze...' }]
});
```

#### Gemini 2.5 Pro
```javascript
const result = await model.generateContent({
  contents: [{ role: 'user', parts: [{ text: 'Question...' }] }],
  generationConfig: { maxOutputTokens: 8192 }
});
```

---

## 🔗 Official Documentation

- **Anthropic Claude**: https://docs.anthropic.com/
- **OpenAI GPT**: https://platform.openai.com/docs/
- **Google Gemini**: https://ai.google.dev/docs

---

## ⚠️ Notes

1. Model IDs with date suffixes (YYYYMMDD) indicate specific versions
2. Always use the latest version for best performance
3. Context windows and pricing may change - check official docs
4. Some models may be in preview/beta status

---

**Generated by**: Perplexity AI + Vecto Pilot™ Model Tracker  
**Script**: `scripts/fetch-latest-models.mjs`  
**To Update**: Run `node scripts/fetch-latest-models.mjs`
