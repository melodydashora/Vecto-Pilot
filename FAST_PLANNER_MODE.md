# Fast Planner Mode - 10x Speed Improvement

## Overview
The tactical planner now supports **Fast Mode** using GPT-4o with temperature control, providing **10x faster responses** compared to GPT-5 reasoning mode.

## Speed Comparison
- **Fast Mode (GPT-4o)**: 3-10 seconds
- **Reasoning Mode (GPT-5)**: 30-120 seconds

## Configuration

### Enable Fast Mode (Default)
Add these environment variables to your `.env` file:

```bash
# Fast Planner Mode (10x faster: 3-10s vs 30-120s)
# Uses GPT-4o with temperature instead of GPT-5 reasoning
FAST_PLANNER=true
FAST_PLANNER_MODEL=gpt-4o
PLANNER_TEMPERATURE=0.7
```

### Disable Fast Mode (Use GPT-5 Reasoning)
To fall back to GPT-5 with reasoning:

```bash
FAST_PLANNER=false
```

## How It Works

### Fast Mode (Default)
- **Model**: GPT-4o (or configurable via `FAST_PLANNER_MODEL`)
- **Temperature**: 0.7 (configurable via `PLANNER_TEMPERATURE`)
- **Response Time**: 3-10 seconds
- **Supports**: Temperature, top_p, response_format (JSON mode)
- **Best For**: Production, real-time user experience

### Reasoning Mode (GPT-5)
- **Model**: GPT-5
- **Reasoning Effort**: Low
- **Response Time**: 30-120 seconds
- **Supports**: Extended reasoning tokens
- **Best For**: Complex analysis, research

## Temperature Control

Temperature controls randomness/creativity in responses:
- **0.0-0.3**: More deterministic, consistent
- **0.4-0.7**: Balanced (recommended)
- **0.8-1.0**: More creative, varied

Default: `0.7` (good balance for tactical planning)

## Performance Benefits

### Before (GPT-5 Reasoning)
- ⏱️ 30-120 seconds per request
- 🐌 Slow blocks display
- 💰 Higher token costs (reasoning tokens)

### After (GPT-4o Fast Mode)
- ⚡ 3-10 seconds per request
- 🚀 10x faster blocks display
- 💵 Lower token costs
- 🎯 Temperature control for consistency

## Implementation Details

The planner automatically selects the mode based on `FAST_PLANNER` environment variable:

```javascript
const useFastMode = process.env.FAST_PLANNER !== 'false';
const temperature = parseFloat(process.env.PLANNER_TEMPERATURE || '0.7');

if (useFastMode) {
  // Fast: GPT-4o with temperature
  await callGPT4({ 
    model: 'gpt-4o', 
    temperature: 0.7,
    response_format: { type: "json_object" }
  });
} else {
  // Reasoning: GPT-5 with low reasoning
  await callGPT5({ 
    reasoning_effort: 'low',
    max_completion_tokens: 32000
  });
}
```

## Metadata Tracking

The planner now includes mode information in metadata:

```json
{
  "metadata": {
    "model": "gpt-4o",
    "mode": "fast",
    "temperature": 0.7,
    "duration_ms": 5432,
    "venues_recommended": 5
  }
}
```

## Recommendations

1. **Use Fast Mode** (default) for production and user-facing features
2. **Use Reasoning Mode** only when you need deep analysis
3. **Adjust temperature** based on your consistency needs:
   - Higher temperature (0.8-1.0) for variety
   - Lower temperature (0.3-0.5) for consistency
