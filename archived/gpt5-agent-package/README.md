# GPT-5 Replit Agent Extension

An autonomous GPT-5 agent with reasoning, memory, and workspace control for Replit.

## 📦 Package Contents

```
gpt5-agent-package/
├── extension.json              # Extension manifest
├── tsconfig.agent.json         # TypeScript configuration
├── package.json                # Dependencies and scripts
├── README.md                   # This file
├── src/
│   ├── index.ts               # Main entry point
│   ├── panel.html             # UI panel interface
│   └── agent/
│       ├── core.ts            # GPT-5 agent logic
│       ├── memory.ts          # Memory persistence
│       └── actions.ts         # Action handlers
└── docs/
    ├── AGENT_BUILD_COMPLETE.md         # Build guide
    ├── EXTENSION_ACTIVATION_GUIDE.md   # Activation instructions
    └── AGENT_SETUP_STATUS.md           # Setup reference
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install @replit/extensions openai ts-node typescript
```

Or add to your existing `package.json`:

```json
{
  "dependencies": {
    "@replit/extensions": "^1.10.0",
    "openai": "^5.23.2"
  },
  "devDependencies": {
    "ts-node": "^10.9.2",
    "typescript": "^5.6.3"
  },
  "scripts": {
    "agent:build": "tsc -p tsconfig.agent.json",
    "agent:start": "node dist/index.js",
    "agent:dev": "ts-node src/index.ts"
  }
}
```

### 2. Set Environment Variables

Create a `.env` file or set in Replit Secrets:

```bash
OPENAI_API_KEY=your_openai_api_key_here
```

### 3. Build the Extension

```bash
npm run agent:build
```

### 4. Activate in Replit

This is a **Replit Extension**, not a standalone Node.js app.

**Do NOT run `npm run agent:start`** - that will fail with "browser context" error.

Instead:

1. Open the **Extensions panel** (🧩 icon in left sidebar)
2. Go to **"Installed"** tab
3. Find **"GPT-5 Replit Agent"**
4. Click to open the panel
5. See the 🧠 GPT-5 Agent UI

## ✅ Build Verification

After running `npm run agent:build`, you should see:

```
dist/
├── index.js
└── agent/
    ├── core.js
    ├── memory.js
    └── actions.js
```

## 🎨 Extension Features

- **Browser-Based UI**: Chat interface with text input and message display
- **GPT-5 Integration**: Direct OpenAI API access with reasoning
- **File System Access**: Read/write workspace files via Replit fs API
- **Memory Persistence**: Store context via Replit data API
- **Terminal Commands**: Execute shell commands (logged only in current version)
- **Dark Theme**: Matches Replit IDE styling

## 🔧 Configuration

### extension.json

The manifest defines:
- Extension name and description
- Permissions (fs, terminal, process, repldb, net)
- Tools (UI panel)
- Settings (server mode)

### tsconfig.agent.json

TypeScript compiler settings:
- Target: ES2020
- Module: ES2020
- Output: `dist/`
- Includes: `src/**/*.ts`

## 📚 Documentation

See the `docs/` folder for detailed guides:

- **AGENT_BUILD_COMPLETE.md** - Complete build and setup guide
- **EXTENSION_ACTIVATION_GUIDE.md** - How to activate in Replit
- **AGENT_SETUP_STATUS.md** - Troubleshooting reference

## 🎯 How It Works

### Browser Context

Replit Extensions run in the browser (iframe), not as Node.js servers:

```typescript
// src/panel.html imports the API from CDN
import { init, messages, fs, data } from 'https://extensions.replit.com/api/v1/index.js';

// Initialize in browser context
await init();
```

### TypeScript Entry Point

```typescript
// src/index.ts
import { init, messages, fs, data } from "@replit/extensions";

export async function activate() {
  await init();
  // Extension ready!
}
```

### GPT-5 Agent Core

```typescript
// src/agent/core.ts
import { OpenAI } from "openai";

export async function runAgent(prompt, context) {
  const api = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await api.chat.completions.create({
    model: "gpt-5",
    messages: [/* ... */]
  });
  return completion.choices[0].message?.content;
}
```

## 🚨 Common Issues

### "Extension must be initialized in browser context"

**Problem**: Tried running with `node dist/index.js` or `npm run agent:start`

**Solution**: Extensions run in browser - activate through Extensions panel

### "Nothing is installed" in Extensions panel

**Problem**: This package is for **Extension Replit Apps**, not regular Repls

**Options**:
1. Fork a React/JS Extension template in Replit
2. Copy these files to that Extension App
3. Use "Load Locally" in Extension Devtools

### TypeScript build errors

**Problem**: Missing type definitions

**Solution**: 
```bash
npm install --save-dev @types/node typescript
npm run agent:build
```

## 🔄 Integration Options

### Option A: Standalone Extension

Use as-is in a dedicated Extension Replit App.

### Option B: Embed in Server

For server-side integration (like your Vecto Pilot MONO server):

```javascript
// Import agent logic directly
import { runAgent } from './src/agent/core.ts';

// Add API endpoint
app.post('/api/agent/query', async (req, res) => {
  const { prompt } = req.body;
  const result = await runAgent(prompt, { /* context */ });
  res.json({ ok: true, result });
});
```

### Option C: Background Service

Run agent as HTTP service that other apps can call:

```bash
# Start agent API
npm run agent:start

# Call from other services
curl http://localhost:PORT/agent/query -d '{"prompt":"..."}'
```

## 📝 License

MIT - Feel free to modify and use in your projects.

## 🤝 Contributing

This is a packaged extension. Modify as needed for your use case.

## 📞 Support

- Replit Extensions Docs: https://docs.replit.com/extensions
- OpenAI API Docs: https://platform.openai.com/docs
- Ask Forum: https://ask.replit.com/c/extensions
