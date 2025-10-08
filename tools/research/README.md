# AI Model Research & Discovery Tool

## Purpose
This tool uses Perplexity AI to automatically research the latest flagship AI models and their parameters, ensuring your application stays updated with the newest model releases and API changes.

## Fixed Issues
- ✅ Removed problematic shebang that caused syntax errors
- ✅ Added dotenv/config for environment variable loading
- ✅ Updated to October 2025 timeframe
- ✅ Embedded known flagship models from README.md for verification:
  - **Claude Sonnet 4.5**: `claude-sonnet-4-5-20250929`
  - **OpenAI GPT-5**: `gpt-5` (uses `reasoning_effort`, NOT `temperature`)
  - **Google Gemini 2.5 Pro**: `gemini-2.5-pro`

## How to Run

### Prerequisites
1. Set `PERPLEXITY_API_KEY` in your `.env` file
2. Ensure you have Node.js 18+ installed

### Execute the Script
```bash
node tools/research/model-discovery.mjs
```

The script will:
1. Research current flagship models from OpenAI, Anthropic, Google, and Perplexity
2. Investigate parameter constraints (what's supported vs deprecated)
3. Identify deprecated models and their replacements
4. Generate a comprehensive JSON report with citations

## Output

### Generated Files
- **Location**: `tools/research/model-research-YYYY-MM-DD.json`
- **Format**: Structured JSON with research findings and citations

### Report Structure
```json
{
  "generated_at": "ISO timestamp",
  "research_date": "October 8, 2025",
  "providers": [
    {
      "provider": "OpenAI",
      "answer": "Detailed research findings...",
      "citations": ["source1", "source2"],
      "relatedQuestions": []
    }
  ],
  "parameter_constraints": {
    "answer": "GPT-5 parameter details...",
    "citations": []
  },
  "deprecated_models": {
    "answer": "Deprecated model list...",
    "citations": []
  },
  "recommendations": [
    {
      "priority": "HIGH",
      "item": "Action item",
      "detail": "Detailed explanation"
    }
  ]
}
```

## Using Research Results

### For SDK Updates
After research completes, update your server adapters:

1. **Review the JSON report** at `tools/research/model-research-YYYY-MM-DD.json`
2. **Update model adapters**:
   - `server/lib/adapters/anthropic-claude.js` → Claude model IDs
   - `server/lib/adapters/openai-gpt5.js` → GPT-5 config
   - `server/lib/adapters/google-gemini.js` → Gemini config
3. **Update environment variables** in `.env.example`:
   ```bash
   CLAUDE_MODEL=claude-sonnet-4-5-20250929
   OPENAI_MODEL=gpt-5
   GEMINI_MODEL=gemini-2.5-pro
   ```
4. **Update documentation**:
   - `docs/reference/LLM_MODELS_REFERENCE.md` → Model specs
   - `README.md` → Quick Start section

### For HTML/Frontend Updates
If building a client-side LLM interface:

1. **Extract model information** from the research JSON
2. **Update frontend model selectors**:
   ```typescript
   const MODELS = {
     claude: {
       id: 'claude-sonnet-4-5-20250929',
       name: 'Claude Sonnet 4.5',
       params: { max_tokens: 64000, temperature: 0.2 }
     },
     gpt5: {
       id: 'gpt-5',
       name: 'GPT-5',
       params: { reasoning_effort: 'medium' } // NO temperature!
     },
     gemini: {
       id: 'gemini-2.5-pro',
       name: 'Gemini 2.5 Pro',
       params: { max_output_tokens: 2048, temperature: 0.2 }
     }
   };
   ```
3. **Update API endpoints** in your fetch calls
4. **Handle parameter differences** (e.g., GPT-5's reasoning_effort vs temperature)

## Automated Workflow

### Ideal Schedule
Run this script monthly or when:
- New model releases are announced
- You encounter API errors about deprecated models
- Major version updates (GPT-4 → GPT-5, Claude 3 → Claude 4)

### Integration with CI/CD
```bash
# Add to package.json scripts
"scripts": {
  "research:models": "node tools/research/model-discovery.mjs",
  "update:models": "npm run research:models && echo 'Review tools/research/model-research-*.json'"
}
```

### Cron Job (Optional)
```bash
# Run monthly on the 1st at 3am
0 3 1 * * cd /path/to/project && node tools/research/model-discovery.mjs
```

## Key Model Facts (as of October 2025)

### OpenAI GPT-5
- ✅ **Model ID**: `gpt-5`
- ✅ **Supports**: `reasoning_effort` (minimal, low, medium, high)
- ❌ **Does NOT support**: `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`
- 📊 **Context**: 272K input / 128K output tokens

### Anthropic Claude Sonnet 4.5
- ✅ **Model ID**: `claude-sonnet-4-5-20250929`
- ✅ **API**: Raw HTTP (SDK doesn't recognize 4.5 yet)
- ✅ **Headers**: `x-api-key`, `anthropic-version: 2023-06-01`
- 📊 **Context**: 200K tokens (1M with beta header)

### Google Gemini 2.5 Pro
- ✅ **Model ID**: `gemini-2.5-pro`
- ✅ **Supports**: Standard temperature, max_tokens parameters
- ✅ **Endpoint**: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent`
- 📊 **Context**: 1M tokens

## Troubleshooting

### "PERPLEXITY_API_KEY not set"
```bash
# Add to .env
PERPLEXITY_API_KEY=your_key_here
```

### "Syntax Error: Unexpected token"
- ✅ **Fixed**: Removed shebang line, added dotenv/config
- Run as: `node tools/research/model-discovery.mjs` (not as executable)

### Script Times Out
- Normal behavior for comprehensive research (60+ seconds)
- Check `tools/research/` for the generated JSON file
- Perplexity is making 6 separate API calls with citations

### Empty or Invalid Results
- Check Perplexity API quotas and rate limits
- Verify your API key has search permissions
- Review the generated JSON for error messages

## Next Steps After Research

1. ✅ Review the generated JSON report
2. ✅ Cross-reference findings with official documentation
3. ✅ Update server/lib/adapters/* files
4. ✅ Update .env.example with new defaults
5. ✅ Update README.md model specifications
6. ✅ Test each model with tools/testing endpoints
7. ✅ Run `npm run dev` and verify no errors

## References
- Source: `tools/research/model-discovery.mjs`
- Template: `tools/research/MODEL_UPDATE_TEMPLATE.md`
- Main Config: `README.md` → "🤖 AI Models" section
