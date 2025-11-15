# Installation Guide

## For Extension Replit Apps

### Step 1: Create Extension App
1. In Replit, fork the React Extension or JavaScript Extension template
2. Your Extension Replit App opens with Extension Devtools visible

### Step 2: Copy Files
Copy all files from this package to your Extension App:
```bash
cp -r gpt5-agent-package/* /path/to/your/extension-app/
```

### Step 3: Install Dependencies
```bash
npm install
```

### Step 4: Set API Key
In Replit Secrets panel, add:
- Key: `OPENAI_API_KEY`
- Value: Your OpenAI API key

### Step 5: Build
```bash
npm run agent:build
```

### Step 6: Preview
1. Open Extension Devtools
2. Click "Load Locally"
3. Click "Preview" next to "GPT-5 Agent" tool

## For Regular Replit Apps (Server Integration)

If you want to use the agent logic in your existing server:

### Step 1: Copy Source Files
```bash
cp -r gpt5-agent-package/src/agent /path/to/your/project/src/
```

### Step 2: Install Dependencies
```bash
npm install openai
```

### Step 3: Import in Your Server
```javascript
import { runAgent } from './src/agent/core.js';

app.post('/api/agent/query', async (req, res) => {
  const result = await runAgent(req.body.prompt, {
    mode: 'dev',
    memory: [],
    thoughts: 'Analyzing request...'
  });
  res.json({ ok: true, result });
});
```

## Verification

After installation:

1. **Build Success**
   ```bash
   npm run agent:build
   # Should show: No errors
   ```

2. **Files Present**
   ```bash
   ls dist/
   # Should show: index.js, agent/
   ```

3. **Extension Loaded** (for Extension Apps)
   - Extension Devtools shows "GPT-5 Agent"
   - Preview tab opens without errors
   - Panel displays UI

## Troubleshooting

### Build Fails
- Check TypeScript version: `npm list typescript`
- Reinstall dependencies: `rm -rf node_modules && npm install`
- Verify tsconfig.agent.json is present

### Extension Not Found
- Verify extension.json is in project root
- Check "tools" array in extension.json
- Rebuild: `npm run agent:build`

### API Key Issues
- Verify OPENAI_API_KEY in Secrets panel
- Check spelling (case-sensitive)
- Test with: `echo $OPENAI_API_KEY`

### Browser Context Error
- Don't run `npm run agent:start` for extensions
- Use Extension Devtools → Load Locally → Preview
- Extensions run in browser, not Node.js
